import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, booked } from './helpers.js';
import { id, one, run } from '../src/db.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(() => { f.close(); });

test('management can draft and publish a dated meal; students cannot see drafts', async () => {
  const manager = await f.login('manager');
  const student = await f.login();
  const body = { serviceDate: '2026-11-08', mealType: 'LUNCH', title: 'Odia thali', menu: ['Rice','Dalma'], allergens: [], dietaryType: 'VEG', pricePaise: 6000, capacity: 200, startsAt: '2026-11-08T12:00:00+05:30', endsAt: '2026-11-08T14:00:00+05:30', cutoffAt: '2026-11-08T09:00:00+05:30' };
  const meal = await manager.post('/meals', body).expect(201);
  assert.equal(meal.body.data.status, 'DRAFT');
  const list = await student.get('/meals').expect(200);
  assert.equal(list.body.data.length, 0);
  await student.post('/bookings', { mealId: meal.body.data.id }).expect(409);
  await manager.patch(`/meals/${meal.body.data.id}`, { ...body, capacity: 300 }).expect(200);
  await manager.post(`/meals/${meal.body.data.id}/publish`).expect(200);
  await manager.patch(`/meals/${meal.body.data.id}`, body).expect(409);
  const published = await student.get('/meals').expect(200);
  assert.equal(published.body.data[0].capacity, 300);
});
test('booking is idempotent and the capacity constraint survives competing requests', async () => {
  const mealId = f.meal({ capacity: 1 });
  const first = await f.login();
  const second = await f.login('other');
  const results = await Promise.all([first.post('/bookings', { mealId }), second.post('/bookings', { mealId })]);
  assert.deepEqual(results.map(res => res.status).sort(), [201, 409]);
  const winner = results[0]!.status === 201 ? first : second;
  const again = await winner.post('/bookings', { mealId }).expect(201);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM bookings')!.n, 1);
  assert.equal(again.body.data.price_paise, 6000);
});
test('bulk bookings roll back completely if any meal is full', async () => {
  const first = f.meal();
  const full = f.meal({ type: 'DINNER', capacity: 1 });
  await booked(f, full, 'other');
  const student = await f.login();
  await student.post('/bookings/bulk', { mealIds: [first, full] }).expect(409);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM bookings WHERE user_id=?', f.ids.student!)!.n, 0);
});
test('cancelling releases capacity and a cancelled booking can be rebooked', async () => {
  const mealId = f.meal({ capacity: 1 });
  const { client, booking } = await booked(f, mealId);
  await client.post(`/bookings/${booking.id}/cancel`, { reason: 'Away' }).expect(200);
  const response = await client.post('/bookings', { mealId }).expect(201);
  assert.equal(response.body.data.id, booking.id);
  assert.equal(response.body.data.cancelled_at, null);
});
test('the cutoff is exclusive for booking and cancellation', async () => {
  const mealId = f.meal();
  const { client, booking } = await booked(f, mealId);
  f.setTime('2026-11-08T03:30:00Z');
  const renewed = await f.login();
  await renewed.post(`/bookings/${booking.id}/cancel`, { reason: 'Late' }).expect(409);
  const other = await f.login('other');
  await other.post('/bookings', { mealId }).expect(409);
});
test('students cannot read or cancel another student booking', async () => {
  const { booking } = await booked(f, f.meal(), 'other');
  const student = await f.login();
  await student.get(`/bookings/${booking.id}`).expect(403);
  await student.post(`/bookings/${booking.id}/cancel`, { reason: 'Not mine' }).expect(403);
  await student.get(`/bookings?userId=${f.ids.other}`).expect(403);
});
test('horizon and calendar date validation reject invalid requests', async () => {
  const mealId = f.meal({ date: '2026-12-08', starts: '2026-12-08T06:30:00Z', ends: '2026-12-08T08:30:00Z', cutoff: '2026-12-08T03:30:00Z' });
  const student = await f.login();
  await student.post('/bookings', { mealId }).expect(400);
  await student.get('/meals?from=2026-02-30&to=2026-03-01').expect(422);
  await student.get('/meals?from=2026-11-09&to=2026-11-08').expect(400);
});
test('extras reserve capacity, require a matching meal and cancel with the booking', async () => {
  const mealId = f.meal();
  const manager = await f.login('manager');
  const extra = await manager.post(`/meals/${mealId}/extras`, { name: 'Curd', pricePaise: 1500, capacity: 1, allergens: ['Milk'] }).expect(201);
  const first = await booked(f, mealId);
  const second = await booked(f, mealId, 'other');
  await first.client.post(`/bookings/${first.booking.id}/extras`, { extraId: extra.body.data.id, quantity: 1 }).expect(201);
  await second.client.post(`/bookings/${second.booking.id}/extras`, { extraId: extra.body.data.id, quantity: 1 }).expect(409);
  await first.client.post(`/bookings/${first.booking.id}/cancel`, { reason: 'Away' }).expect(200);
  await second.client.post(`/bookings/${second.booking.id}/extras`, { extraId: extra.body.data.id, quantity: 1 }).expect(201);
  const mismatch = id();
  const anotherMeal = f.meal({ type: 'DINNER' });
  run(f.db, 'INSERT INTO extras VALUES (?,?,?,?,?,?)', mismatch, anotherMeal, 'Egg', 1000, 1, '[]');
  await second.client.post(`/bookings/${second.booking.id}/extras`, { extraId: mismatch, quantity: 1 }).expect(400);
});
test('service cancellation cancels all bookings and their charges', async () => {
  const mealId = f.meal();
  const { booking } = await booked(f, mealId);
  const manager = await f.login('manager');
  await manager.post(`/meals/${mealId}/cancel`, { reason: 'Kitchen maintenance' }).expect(200);
  assert.equal(one(f.db, 'SELECT status FROM bookings WHERE id=?', booking.id)!.status, 'CANCELLED');
  const student = await f.login();
  const bill = await student.get('/billing/preview?month=2026-11').expect(200);
  assert.equal(bill.body.data.totalPaise, 0);
});
test('a pass is single-use, window-bound and attendance fulfils extras', async () => {
  const mealId = f.meal();
  const { booking, client } = await booked(f, mealId);
  const extraId = id();
  run(f.db, 'INSERT INTO extras VALUES (?,?,?,?,?,?)', extraId, mealId, 'Curd', 1500, 10, '[]');
  await client.post(`/bookings/${booking.id}/extras`, { extraId, quantity: 2 }).expect(201);
  f.setTime('2026-11-08T06:30:00Z');
  const student = await f.login();
  const pass = await student.post(`/bookings/${booking.id}/pass`).expect(200);
  const staff = await f.login('staff');
  const scan = await staff.post('/attendance/scan', { token: pass.body.data.token }).expect(200);
  assert.equal(scan.body.data.extras[0].quantity, 2);
  await staff.post('/attendance/scan', { token: pass.body.data.token }).expect(409);
  assert.equal(one(f.db, 'SELECT status FROM bookings WHERE id=?', booking.id)!.status, 'ATTENDED');
  await student.post('/attendance/scan', { token: pass.body.data.token }).expect(403);
});
test('passes expire after two minutes and regenerating one invalidates the previous pass', async () => {
  const { booking } = await booked(f, f.meal());
  f.setTime('2026-11-08T06:30:00Z');
  const student = await f.login();
  const staff = await f.login('staff');
  const first = await student.post(`/bookings/${booking.id}/pass`).expect(200);
  const second = await student.post(`/bookings/${booking.id}/pass`).expect(200);
  await staff.post('/attendance/scan', { token: first.body.data.token }).expect(409);
  f.setTime('2026-11-08T06:32:00Z');
  await staff.post('/attendance/scan', { token: second.body.data.token }).expect(409);
});
test('early or late scans fail without consuming the pass', async () => {
  const { booking } = await booked(f, f.meal());
  const early = await f.login();
  await early.post(`/bookings/${booking.id}/pass`).expect(409);
  f.setTime('2026-11-08T06:29:00Z');
  const student = await f.login();
  const staff = await f.login('staff');
  const pass = await student.post(`/bookings/${booking.id}/pass`).expect(200);
  await staff.post('/attendance/scan', { token: pass.body.data.token }).expect(409);
  f.setTime('2026-11-08T06:30:00Z');
  await staff.post('/attendance/scan', { token: pass.body.data.token }).expect(200);
});
test('booking lists and detail responses include menu arrays and match role access', async () => {
  const { client, booking } = await booked(f, f.meal());
  const detail = await client.get(`/bookings/${booking.id}`).expect(200);
  assert.deepEqual(detail.body.data.meal.menu, ['Rice','Dal']);
  const own = await client.get('/bookings?from=2026-11-08&to=2026-11-08').expect(200);
  assert.equal(own.body.data.total, 1);
  const staff = await f.login('staff');
  const roster = await staff.get('/bookings?from=2026-11-08&to=2026-11-08').expect(200);
  assert.equal(roster.body.data.items[0].roll_number, 'B-student');
});
