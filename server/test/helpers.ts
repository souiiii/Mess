import request, { type Test } from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { id, openDatabase, run } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import type { Config, Role } from '../src/types.js';
import { responseContract } from '../src/contracts.js';

export const password = 'SecureTest2026!';
const passwordHash = hashPassword(password);
export async function fixture() {
  let clock = new Date('2026-11-07T03:00:00.000Z');
  const db = openDatabase(':memory:');
  const hash = await passwordHash;
  const config: Config = { production: false, port: 4000, databasePath: ':memory:', appOrigin: 'http://localhost:5173', logLevel: 'silent', trustProxy: 0, staticDir: '/nonexistent', paymentsMode: 'MANUAL' };
  const ctx = { db, config, now: () => clock };
  const ids: Record<string, string> = {};
  for (const [key, role] of Object.entries({ admin: 'ADMIN', manager: 'MANAGER', staff: 'STAFF', student: 'STUDENT', other: 'STUDENT', temporary: 'STUDENT' } as Record<string, Role>)) {
    ids[key] = id();
    run(db, 'INSERT INTO users (id,name,email,password_hash,role,roll_number,joined_on,must_change_password,created_at) VALUES (?,?,?,?,?,?,?,?,?)', ids[key]!, `${key} User`, `${key}@example.edu`, hash, role, role === 'STUDENT' ? `B-${key}` : null, '2026-09-01', Number(key === 'temporary'), clock.toISOString());
  }
  const app = createApp(ctx);
  function checked(method: string, path: string, test: Test) {
    return test.expect(response => {
      if (response.status < 200 || response.status >= 300 || path.startsWith('/reports/billing/export')) return;
      const route = path.split('?')[0]!.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
      responseContract(method, route).parse(response.body.data);
    });
  }
  async function login(who = 'student', loginPassword = password) {
    const agent = request.agent(app);
    const response = await agent.post('/api/v1/auth/login').send({ email: `${who}@example.edu`, password: loginPassword });
    if (response.status !== 200) throw new Error(JSON.stringify(response.body));
    responseContract('post', '/auth/login').parse(response.body.data);
    const csrf = response.body.data.csrfToken as string;
    return { agent, csrf, get: (path: string) => checked('get', path, agent.get(`/api/v1${path}`)), post: (path: string, body?: object) => checked('post', path, agent.post(`/api/v1${path}`).set('X-CSRF-Token', csrf).send(body)), patch: (path: string, body: object) => checked('patch', path, agent.patch(`/api/v1${path}`).set('X-CSRF-Token', csrf).send(body)), delete: (path: string) => checked('delete', path, agent.delete(`/api/v1${path}`).set('X-CSRF-Token', csrf)) };
  }
  function meal(overrides: Record<string, unknown> = {}) {
    const mealId = id();
    const row = { date: '2026-11-08', type: 'LUNCH', title: 'Rice and dal', price: 6000, capacity: 2, starts: '2026-11-08T06:30:00.000Z', ends: '2026-11-08T08:30:00.000Z', cutoff: '2026-11-08T03:30:00.000Z', status: 'PUBLISHED', ...overrides };
    run(db, 'INSERT INTO meal_services VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', mealId, String(row.date), String(row.type), String(row.title), '["Rice","Dal"]', '[]', 'VEG', Number(row.price), Number(row.capacity), String(row.starts), String(row.ends), String(row.cutoff), String(row.status), ids.admin!, clock.toISOString());
    return mealId;
  }
  return { db, ctx, config, app, ids, login, meal, setTime: (value: string) => { clock = new Date(value); }, close: () => db.close() };
}
export async function booked(f: Awaited<ReturnType<typeof fixture>>, mealId: string, who = 'student') {
  const client = await f.login(who);
  const response = await client.post('/bookings', { mealId });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return { client, booking: response.body.data };
}
export function staticFixture() {
  const path = mkdtempSync(join(tmpdir(), 'mess-static-'));
  return { path, close: () => rmSync(path, { recursive: true, force: true }) };
}
