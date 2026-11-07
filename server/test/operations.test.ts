import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, booked } from './helpers.js';
import { id, one, run } from '../src/db.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(() => { f.close(); });

async function stockItem() {
  const manager = await f.login('manager');
  const item = await manager.post('/inventory', { name: 'Rice', unit: 'GRAM', lowStockThreshold: 5000 }).expect(201);
  const supplier = await manager.post('/suppliers', { name: 'Campus provisions', contact: '1234567890' }).expect(201);
  const receipt = { kind: 'RECEIVE', quantity: 10000, totalCostPaise: 50000, supplierId: supplier.body.data.id, reference: 'PO-001', reason: 'Weekly delivery', idempotencyKey: id() };
  return { manager, itemId: item.body.data.id as string, receipt };
}
test('stock receipts and usage reconcile to an append-only ledger', async () => {
  const { manager, itemId, receipt } = await stockItem();
  const received = await manager.post(`/inventory/${itemId}/movements`, receipt).expect(201);
  assert.equal(received.body.data.item.stock, 10000);
  const staff = await f.login('staff');
  const used = await staff.post(`/inventory/${itemId}/movements`, { kind: 'CONSUME', quantity: -6000, reason: 'Lunch preparation', idempotencyKey: id() }).expect(201);
  assert.equal(used.body.data.item.stock, 4000);
  const low = await manager.get('/inventory?lowStock=true').expect(200);
  assert.equal(low.body.data.items.length, 1);
  assert.equal(one(f.db, 'SELECT sum(quantity) AS n FROM stock_movements')!.n, 4000);
  assert.throws(() => run(f.db, 'DELETE FROM stock_movements'), /immutable/);
});
test('stock retries are idempotent and receipt references cannot be duplicated per item', async () => {
  const { manager, itemId, receipt } = await stockItem();
  const first = await manager.post(`/inventory/${itemId}/movements`, receipt).expect(201);
  const replay = await manager.post(`/inventory/${itemId}/movements`, receipt).expect(201);
  assert.equal(first.body.data.movement.id, replay.body.data.movement.id);
  assert.equal(replay.body.data.item.stock, 10000);
  await manager.post(`/inventory/${itemId}/movements`, { ...receipt, quantity: 20000 }).expect(409);
  await manager.post(`/inventory/${itemId}/movements`, { ...receipt, idempotencyKey: id() }).expect(409);
  assert.equal(one(f.db, 'SELECT stock FROM inventory_items')!.stock, 10000);
});
test('negative stock and invalid movement signs roll back without orphan ledger records', async () => {
  const { manager, itemId, receipt } = await stockItem();
  await manager.post(`/inventory/${itemId}/movements`, { kind: 'CONSUME', quantity: -1, reason: 'No stock', idempotencyKey: id() }).expect(409);
  await manager.post(`/inventory/${itemId}/movements`, { ...receipt, quantity: -10 }).expect(400);
  await manager.post(`/inventory/${itemId}/movements`, { kind: 'WASTE', quantity: 10, reason: 'Wrong sign', idempotencyKey: id() }).expect(400);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM stock_movements')!.n, 0);
});
test('staff can log consumption but cannot alter stock counts or see procurement costs', async () => {
  const { manager, itemId, receipt } = await stockItem();
  await manager.post(`/inventory/${itemId}/movements`, receipt).expect(201);
  const staff = await f.login('staff');
  await staff.post(`/inventory/${itemId}/movements`, { kind: 'ADJUST', quantity: -1, reason: 'Count', idempotencyKey: id() }).expect(403);
  await staff.post(`/inventory/${itemId}/movements`, { ...receipt, idempotencyKey: id(), reference: 'OTHER' }).expect(403);
  const history = await staff.get(`/inventory/${itemId}/movements`).expect(200);
  assert.equal(history.body.data.items[0].total_cost_paise, undefined);
  const student = await f.login();
  await student.get('/inventory').expect(403);
});
test('procurement reports distinguish receipt costs from internal usage', async () => {
  const { manager, itemId, receipt } = await stockItem();
  await manager.post(`/inventory/${itemId}/movements`, receipt).expect(201);
  const report = await manager.get('/reports/billing?month=2026-11').expect(200);
  assert.equal(report.body.data.procurementCostPaise, 50000);
});
test('wastage can only be logged after service and must match attendance', async () => {
  const mealId = f.meal();
  const { booking } = await booked(f, mealId);
  const staff = await f.login('staff');
  const body = { preparedPortions: 10, leftoverPortions: 10, wasteGrams: 1000, note: 'Measured after service' };
  await staff.post(`/meals/${mealId}/waste`, body).expect(409);
  run(f.db, "UPDATE bookings SET status='ATTENDED', attended_at=? WHERE id=?", '2026-11-08T06:30:00.000Z', booking.id);
  f.setTime('2026-11-08T09:00:00Z');
  const refreshed = await f.login('staff');
  await refreshed.post(`/meals/${mealId}/waste`, body).expect(400);
  await refreshed.post(`/meals/${mealId}/waste`, { ...body, leftoverPortions: 9 }).expect(201);
  await refreshed.post(`/meals/${mealId}/waste`, { ...body, leftoverPortions: 9 }).expect(409);
});
test('operations reports count attendance, no-shows and dietary portions correctly', async () => {
  const mealId = f.meal();
  await booked(f, mealId);
  await booked(f, mealId, 'other');
  f.setTime('2026-11-08T09:00:00Z');
  const manager = await f.login('manager');
  const report = await manager.get('/reports/operations?from=2026-11-08&to=2026-11-08').expect(200);
  assert.equal(report.body.data.services[0].booked, 2);
  assert.equal(report.body.data.services[0].no_shows, 2);
  assert.equal(report.body.data.services[0].dietaryCounts[0].count, 2);
});
test('dashboards respect financial and personal access boundaries', async () => {
  const student = await f.login();
  const staff = await f.login('staff');
  const manager = await f.login('manager');
  const studentDash = await student.get('/dashboard').expect(200);
  assert.equal(studentDash.body.data.provisionalBillPaise, 0);
  assert.equal(studentDash.body.data.lowStockItems, undefined);
  const staffDash = await staff.get('/dashboard').expect(200);
  assert.equal(staffDash.body.data.overduePaise, undefined);
  const managerDash = await manager.get('/dashboard').expect(200);
  assert.equal(managerDash.body.data.activeResidents, 3);
});
test('complaints remain private between their owner and appropriate staff', async () => {
  const student = await f.login();
  const other = await f.login('other');
  const complaint = await student.post('/complaints', { category: 'HYGIENE', subject: 'Unclean table', description: 'Please clean table 4' }).expect(201);
  await other.get(`/complaints/${complaint.body.data.id}`).expect(403);
  const list = await other.get('/complaints').expect(200);
  assert.equal(list.body.data.items.length, 0);
  await other.post(`/complaints/${complaint.body.data.id}/replies`, { message: 'Not mine' }).expect(403);
  const staff = await f.login('staff');
  await staff.get(`/complaints/${complaint.body.data.id}`).expect(200);
  await staff.patch(`/complaints/${complaint.body.data.id}/status`, { status: 'IN_PROGRESS', assignedTo: f.ids.staff, note: 'Cleaning team assigned' }).expect(200);
  await staff.patch(`/complaints/${complaint.body.data.id}/status`, { status: 'RESOLVED', assignedTo: f.ids.staff, note: 'Cleaned' }).expect(200);
  await student.post(`/complaints/${complaint.body.data.id}/replies`, { message: 'Still dirty' }).expect(409);
  await student.post(`/complaints/${complaint.body.data.id}/reopen`, { reason: 'Still dirty' }).expect(200);
  const thread = await student.get(`/complaints/${complaint.body.data.id}`).expect(200);
  assert.equal(thread.body.data.replies.length, 3);
});
test('billing complaints are hidden from serving staff and cannot be assigned to them', async () => {
  const student = await f.login();
  const complaint = await student.post('/complaints', { category: 'BILLING', subject: 'Invoice question', description: 'Please check my payment' }).expect(201);
  const staff = await f.login('staff');
  await staff.get(`/complaints/${complaint.body.data.id}`).expect(403);
  const queue = await staff.get('/complaints').expect(200);
  assert.equal(queue.body.data.items.length, 0);
  const manager = await f.login('manager');
  await manager.patch(`/complaints/${complaint.body.data.id}/status`, { status: 'IN_PROGRESS', assignedTo: f.ids.staff, note: 'Assigning' }).expect(400);
});
test('feedback requires attendance, allows only one review and expires after the configured window', async () => {
  const mealId = f.meal();
  const { booking, client } = await booked(f, mealId);
  const body = { bookingId: booking.id, taste: 4, hygiene: 5, portion: 4, comment: 'Good dal' };
  await client.post('/feedback', body).expect(409);
  run(f.db, "UPDATE bookings SET status='ATTENDED', attended_at=? WHERE id=?", '2026-11-08T06:30:00.000Z', booking.id);
  f.setTime('2026-11-08T07:00:00Z');
  const student = await f.login();
  const other = await f.login('other');
  await other.post('/feedback', body).expect(403);
  await student.post('/feedback', body).expect(201);
  await student.post('/feedback', body).expect(409);
  f.setTime('2026-11-17T07:00:00Z');
  const late = await f.login();
  await late.post('/feedback', body).expect(409);
});
test('announcements expire and only managers can publish them', async () => {
  const manager = await f.login('manager');
  const student = await f.login();
  const body = { title: 'Menu update', body: 'Lunch begins at noon', priority: 'IMPORTANT', expiresAt: '2026-11-07T04:00:00Z' };
  await student.post('/announcements', body).expect(403);
  const created = await manager.post('/announcements', body).expect(201);
  const list = await student.get('/announcements').expect(200);
  assert.equal(list.body.data.length, 1);
  f.setTime('2026-11-07T04:00:00Z');
  const expired = await student.get('/announcements').expect(200);
  assert.equal(expired.body.data.length, 0);
  await manager.delete(`/announcements/${created.body.data.id}`).expect(200);
});
test('inventory thresholds, supplier pages and empty feature lists match the response contracts', async () => {
  const { manager, itemId } = await stockItem();
  await manager.patch(`/inventory/${itemId}`, { lowStockThreshold: 2000 }).expect(200);
  await manager.get('/suppliers').expect(200);
  await manager.get('/feedback').expect(200);
  await manager.get('/leaves').expect(200);
  await manager.get('/invoices').expect(200);
  const student = await f.login();
  await student.get('/feedback').expect(200);
  await student.get('/dashboard').expect(200);
});
