import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, password } from './helpers.js';
import { one, run } from '../src/db.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(() => { f.close(); });

test('health checks the database and adds security and request headers', async () => {
  const res = await request(f.app).get('/api/health').expect(200);
  assert.equal(res.body.data.status, 'ok');
  assert.ok(res.headers['x-request-id']);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-powered-by'], undefined);
});
test('protected routes reject anonymous requests with the standard error envelope', async () => {
  const res = await request(f.app).get('/api/v1/meals').expect(401);
  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  assert.ok(res.body.error.requestId);
});
test('login hides password hashes and uses an HttpOnly SameSite cookie', async () => {
  const res = await request(f.app).post('/api/v1/auth/login').send({ email: 'student@example.edu', password }).expect(200);
  assert.equal(res.body.data.user.password_hash, undefined);
  assert.ok(res.body.data.csrfToken);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const session = one(f.db, 'SELECT * FROM sessions')!;
  assert.ok(!cookie.includes(session.token_hash));
});
test('login returns the same generic failure for an unknown user and a wrong password', async () => {
  const unknown = await request(f.app).post('/api/v1/auth/login').send({ email: 'nobody@example.edu', password }).expect(401);
  const wrong = await request(f.app).post('/api/v1/auth/login').send({ email: 'student@example.edu', password: 'wrong' }).expect(401);
  assert.equal(unknown.body.error.message, wrong.body.error.message);
});
test('login failures are rate limited', async () => {
  for (let i = 0; i < 20; i++) await request(f.app).post('/api/v1/auth/login').send({ email: 'nobody@example.edu', password: 'wrong' }).expect(401);
  await request(f.app).post('/api/v1/auth/login').send({ email: 'nobody@example.edu', password: 'wrong' }).expect(429);
});
test('mutations require CSRF and reject a foreign Origin even with CSRF', async () => {
  const client = await f.login();
  await client.agent.post('/api/v1/complaints').send({ category: 'FOOD', subject: 'Cold food', description: 'Lunch is cold' }).expect(403);
  const res = await client.post('/complaints', { category: 'FOOD', subject: 'Cold food', description: 'Lunch is cold' }).set('Origin', 'https://evil.example').expect(403);
  assert.equal(res.body.error.code, 'INVALID_ORIGIN');
});
test('temporary passwords permit only identity, password change and logout', async () => {
  const client = await f.login('temporary');
  await client.get('/auth/me').expect(200);
  const res = await client.get('/meals').expect(403);
  assert.equal(res.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  await client.post('/auth/password', { currentPassword: password, newPassword: 'NewPassword2026!' }).expect(200);
  await client.get('/auth/me').expect(401);
  assert.equal(one(f.db, 'SELECT must_change_password FROM users WHERE id=?', f.ids.temporary!)!.must_change_password, 0);
});
test('changing a password revokes all sessions', async () => {
  const first = await f.login();
  const second = await f.login();
  await first.post('/auth/password', { currentPassword: password, newPassword: 'NewPassword2026!' }).expect(200);
  await second.get('/auth/me').expect(401);
});
test('expired and suspended sessions cannot be used', async () => {
  const client = await f.login();
  f.setTime('2026-11-08T03:00:00Z');
  await client.get('/auth/me').expect(401);
  const second = await f.login();
  run(f.db, 'UPDATE users SET active=0 WHERE id=?', f.ids.student!);
  await second.get('/auth/me').expect(401);
});
test('students cannot provision accounts or access audit logs', async () => {
  const client = await f.login();
  await client.post('/users', {}).expect(403);
  await client.get('/audit').expect(403);
});
test('admin provisioning enforces roll numbers, uniqueness and temporary passwords', async () => {
  const admin = await f.login('admin');
  await admin.post('/users', { name: 'New Student', email: 'new@example.edu', role: 'STUDENT', password }).expect(422);
  const body = { name: 'New Student', email: 'NEW@example.edu', role: 'STUDENT', password, rollNumber: 'B12399' };
  const res = await admin.post('/users', body).expect(201);
  assert.equal(res.body.data.email, 'new@example.edu');
  assert.equal(res.body.data.must_change_password, true);
  assert.equal(res.body.data.password_hash, undefined);
  await admin.post('/users', body).expect(409);
});
test('students cannot inject privileged profile fields', async () => {
  const client = await f.login();
  await client.patch('/users/me', { name: 'Someone', hostel: null, room: null, dietaryPreference: 'VEG', allergies: [], role: 'ADMIN' }).expect(422);
  assert.equal(one(f.db, 'SELECT role FROM users WHERE id=?', f.ids.student!)!.role, 'STUDENT');
});
test('admin access changes revoke sessions and cannot target self', async () => {
  const admin = await f.login('admin');
  const student = await f.login();
  await admin.patch(`/users/${f.ids.student}/access`, { active: false, role: 'STUDENT' }).expect(200);
  await student.get('/auth/me').expect(401);
  await admin.patch(`/users/${f.ids.admin}/access`, { active: false, role: 'ADMIN' }).expect(400);
});
test('unknown endpoints, invalid JSON, invalid UUIDs and oversized payloads are explicit errors', async () => {
  await request(f.app).get('/api/v1/does-not-exist').expect(404);
  await request(f.app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{broken').expect(400);
  const client = await f.login();
  await client.get('/bookings/not-a-uuid').expect(422);
  await client.post('/complaints', { description: 'a'.repeat(70000) }).expect(413);
});
test('OpenAPI is generated for every registered endpoint and documents cookie plus CSRF authentication', async () => {
  const res = await request(f.app).get('/api/openapi.json').expect(200);
  assert.equal(res.body.openapi, '3.1.0');
  assert.ok(Object.keys(res.body.paths).length >= 40);
  assert.ok(res.body.components.securitySchemes.csrfHeader);
  assert.ok(res.body.paths['/api/v1/invoices/{id}/payments'].post.requestBody);
  assert.ok(res.body.components.schemas.Invoice);
  assert.equal(res.body.paths['/api/v1/reports/billing/export'].get.responses['200'].content['text/csv'].schema.type, 'string');
});
test('directory filters, policy updates and audit pagination return their documented contracts', async () => {
  const admin = await f.login('admin');
  const directory = await admin.get('/users?role=STUDENT&search=student&limit=1').expect(200);
  assert.equal(directory.body.data.total, 1);
  assert.equal(directory.body.data.items[0].role, 'STUDENT');
  const literalWildcard = await admin.get('/users?search=%25').expect(200);
  assert.equal(literalWildcard.body.data.total, 0);
  await admin.patch('/settings', { bookingHorizonDays: 7, minimumLeaveDays: 1, feedbackWindowDays: 3 }).expect(200);
  const student = await f.login();
  const policy = await student.get('/settings').expect(200);
  assert.equal(policy.body.data.minimum_leave_days, 1);
  await student.post('/leaves', { startsOn: '2026-11-08', endsOn: '2026-11-08', reason: 'One day leave now allowed' }).expect(201);
  const audit = await admin.get('/audit?action=SETTINGS_CHANGED&limit=1').expect(200);
  assert.equal(audit.body.data.total, 1);
  assert.equal(audit.body.data.items[0].details.minimumLeaveDays, 1);
});
test('password reset revokes sessions and forces a change without exposing the new hash', async () => {
  const admin = await f.login('admin');
  const student = await f.login();
  await admin.post(`/users/${f.ids.student}/reset-password`, { temporaryPassword: 'ResetPassword2026!' }).expect(200);
  await student.get('/auth/me').expect(401);
  const login = await request(f.app).post('/api/v1/auth/login').send({ email: 'student@example.edu', password: 'ResetPassword2026!' }).expect(200);
  assert.equal(login.body.data.user.must_change_password, true);
  assert.equal(login.body.data.user.password_hash, undefined);
});
test('passwords preserve leading and trailing whitespace through login and password changes', async () => {
  const client = await f.login();
  const spaced = ' SpacePassword2026! ';
  await client.post('/auth/password', { currentPassword: password, newPassword: spaced }).expect(200);
  const spacedLogin = await f.login('student', spaced);
  await spacedLogin.post('/auth/password', { currentPassword: spaced, newPassword: password }).expect(200);
});
test('competing password changes cannot both replace the same password', async () => {
  const first = await f.login();
  const second = await f.login();
  const responses = await Promise.all([
    first.post('/auth/password', { currentPassword: password, newPassword: 'NewPassword2026!A' }),
    second.post('/auth/password', { currentPassword: password, newPassword: 'NewPassword2026!B' })
  ]);
  assert.equal(responses.filter(res => res.status === 200).length, 1);
  assert.ok(responses.every(res => [200, 400, 401, 409].includes(res.status)));
});
