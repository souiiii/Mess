import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, booked } from './helpers.js';
import { id, one, run } from '../src/db.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(() => { f.close(); });

test('approved leave cancels eligible bookings and extras atomically without issuing fake credits', async () => {
  const mealId = f.meal();
  const { booking, client } = await booked(f, mealId);
  const extraId = id();
  run(f.db, 'INSERT INTO extras VALUES (?,?,?,?,?,?)', extraId, mealId, 'Curd', 1500, 10, '[]');
  await client.post(`/bookings/${booking.id}/extras`, { extraId, quantity: 2 }).expect(201);
  const leave = await client.post('/leaves', { startsOn: '2026-11-08', endsOn: '2026-11-09', reason: 'Travelling home' }).expect(201);
  const manager = await f.login('manager');
  const approval = await manager.post(`/leaves/${leave.body.data.id}/review`, { decision: 'APPROVED', note: 'Approved' }).expect(200);
  assert.equal(approval.body.data.cancelledBookings, 1);
  assert.equal(approval.body.data.avoidedChargesPaise, 9000);
  assert.equal(one(f.db, 'SELECT status FROM extra_orders')!.status, 'CANCELLED');
  const bill = await client.get('/billing/preview?month=2026-11').expect(200);
  assert.equal(bill.body.data.totalPaise, 0);
  await client.post('/bookings', { mealId }).expect(409);
});
test('pending leave blocks bookings and overlap; withdrawal enables rebooking', async () => {
  const student = await f.login();
  const leave = await student.post('/leaves', { startsOn: '2026-11-08', endsOn: '2026-11-09', reason: 'Away' }).expect(201);
  await student.post('/leaves', { startsOn: '2026-11-09', endsOn: '2026-11-11', reason: 'Overlapping' }).expect(409);
  const mealId = f.meal();
  await student.post('/bookings', { mealId }).expect(409);
  await student.post(`/leaves/${leave.body.data.id}/withdraw`).expect(200);
  await student.post('/bookings', { mealId }).expect(201);
});
test('leave duration and ownership are enforced', async () => {
  const student = await f.login();
  await student.post('/leaves', { startsOn: '2026-11-08', endsOn: '2026-11-08', reason: 'Too short' }).expect(400);
  await student.post('/leaves', { startsOn: '2026-11-07', endsOn: '2026-11-09', reason: 'Already starts today' }).expect(400);
  const leave = await student.post('/leaves', { startsOn: '2026-11-08', endsOn: '2026-11-09', reason: 'Away' }).expect(201);
  const other = await f.login('other');
  await other.post(`/leaves/${leave.body.data.id}/withdraw`).expect(403);
  await other.get(`/leaves?userId=${f.ids.student}`).expect(403);
});
test('approving after any cancellation cutoff fails without cancelling eligible meals', async () => {
  const first = f.meal({ cutoff: '2026-11-07T04:00:00.000Z' });
  const second = f.meal({ type: 'DINNER' });
  const student = await f.login();
  await student.post('/bookings/bulk', { mealIds: [first, second] }).expect(201);
  const leave = await student.post('/leaves', { startsOn: '2026-11-08', endsOn: '2026-11-09', reason: 'Away' }).expect(201);
  f.setTime('2026-11-07T04:00:00Z');
  const manager = await f.login('manager');
  await manager.post(`/leaves/${leave.body.data.id}/review`, { decision: 'APPROVED', note: 'Late' }).expect(409);
  assert.equal(one(f.db, "SELECT count(*) AS n FROM bookings WHERE status='CONFIRMED'")!.n, 2);
  assert.equal(one(f.db, 'SELECT status FROM leave_requests')!.status, 'PENDING');
  await manager.post(`/leaves/${leave.body.data.id}/review`, { decision: 'REJECTED', note: 'Cutoff has passed' }).expect(200);
});
test('invoice totals include locked meal and extra prices and exclude cancellations', async () => {
  const mealId = f.meal();
  const { booking, client } = await booked(f, mealId);
  const extraId = id();
  run(f.db, 'INSERT INTO extras VALUES (?,?,?,?,?,?)', extraId, mealId, 'Curd', 1500, 10, '[]');
  await client.post(`/bookings/${booking.id}/extras`, { extraId, quantity: 2 }).expect(201);
  run(f.db, 'UPDATE extras SET price_paise=9999 WHERE id=?', extraId);
  const cancelMeal = f.meal({ type: 'DINNER' });
  const cancelled = await client.post('/bookings', { mealId: cancelMeal }).expect(201);
  await client.post(`/bookings/${cancelled.body.data.id}/cancel`, { reason: 'Away' }).expect(200);
  const preview = await client.get('/billing/preview?month=2026-11').expect(200);
  assert.equal(preview.body.data.totalPaise, 9000);
  assert.equal(preview.body.data.provisional, true);
  f.setTime('2026-12-01T01:00:00Z');
  const manager = await f.login('manager');
  const invoice = await manager.post('/invoices', { userId: f.ids.student, month: '2026-11', dueOn: '2026-12-10' }).expect(201);
  assert.equal(invoice.body.data.total_paise, 9000);
  assert.equal(invoice.body.data.lines.length, 2);
  const again = await manager.post('/invoices', { userId: f.ids.student, month: '2026-11', dueOn: '2026-12-10' }).expect(201);
  assert.equal(again.body.data.id, invoice.body.data.id);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM invoices')!.n, 1);
});
test('invoices cannot be issued for an open month or a past due date', async () => {
  const manager = await f.login('manager');
  await manager.post('/invoices', { userId: f.ids.student, month: '2026-11', dueOn: '2026-12-10' }).expect(400);
  await manager.post('/invoices', { userId: f.ids.student, month: '2026-10', dueOn: '2026-11-01' }).expect(400);
});
async function invoiceWithBalance() {
  await booked(f, f.meal());
  f.setTime('2026-12-01T01:00:00Z');
  const manager = await f.login('manager');
  const invoice = await manager.post('/invoices', { userId: f.ids.student, month: '2026-11', dueOn: '2026-12-10' }).expect(201);
  return { manager, invoice: invoice.body.data };
}
test('verified payments support partial settlement, idempotent replay and overpayment prevention', async () => {
  const { manager, invoice } = await invoiceWithBalance();
  const body = { amountPaise: 2000, method: 'UPI', reference: 'BANK-123456', idempotencyKey: id() };
  const partial = await manager.post(`/invoices/${invoice.id}/payments`, body).expect(201);
  assert.equal(partial.body.data.invoice.status, 'PARTIALLY_PAID');
  assert.equal(partial.body.data.invoice.outstanding_paise, 4000);
  const repeat = await manager.post(`/invoices/${invoice.id}/payments`, body).expect(201);
  assert.equal(repeat.body.data.payment.id, partial.body.data.payment.id);
  await manager.post(`/invoices/${invoice.id}/payments`, { ...body, amountPaise: 1000 }).expect(409);
  await manager.post(`/invoices/${invoice.id}/payments`, { ...body, idempotencyKey: id(), reference: 'BANK-over', amountPaise: 5000 }).expect(409);
  const settled = await manager.post(`/invoices/${invoice.id}/payments`, { ...body, idempotencyKey: id(), reference: 'BANK-final', amountPaise: 4000 }).expect(201);
  assert.equal(settled.body.data.invoice.status, 'PAID');
  assert.equal(one(f.db, 'SELECT sum(amount_paise) AS n FROM payments')!.n, 6000);
});
test('a payment reference cannot be reused and competing payments cannot overpay', async () => {
  const { manager, invoice } = await invoiceWithBalance();
  const body = { amountPaise: 4000, method: 'CASH', reference: 'RECEIPT-1', idempotencyKey: id() };
  const responses = await Promise.all([manager.post(`/invoices/${invoice.id}/payments`, body), manager.post(`/invoices/${invoice.id}/payments`, { ...body, reference: 'RECEIPT-2', idempotencyKey: id() })]);
  assert.deepEqual(responses.map(res => res.status).sort(), [201, 409]);
  await manager.post(`/invoices/${invoice.id}/payments`, { ...body, amountPaise: 1000, idempotencyKey: id() }).expect(409);
});
test('billing details remain private and staff cannot record payments', async () => {
  const { invoice } = await invoiceWithBalance();
  const owner = await f.login();
  const other = await f.login('other');
  const staff = await f.login('staff');
  await owner.get(`/invoices/${invoice.id}`).expect(200);
  await other.get(`/invoices/${invoice.id}`).expect(403);
  await other.get(`/billing/preview?month=2026-11&userId=${f.ids.student}`).expect(403);
  await staff.get(`/invoices/${invoice.id}`).expect(403);
  await staff.post(`/invoices/${invoice.id}/payments`, {}).expect(403);
});
test('issued invoices, lines, payments and audit records cannot be edited or deleted', async () => {
  const { manager, invoice } = await invoiceWithBalance();
  await manager.post(`/invoices/${invoice.id}/payments`, { amountPaise: 1000, method: 'CASH', reference: 'receipt', idempotencyKey: id() }).expect(201);
  for (const table of ['invoices','invoice_lines','payments','audit_logs']) {
    assert.throws(() => run(f.db, `DELETE FROM ${table}`), /immutable/);
  }
  assert.throws(() => run(f.db, 'UPDATE invoices SET total_paise=1'), /immutable/);
});
test('invoice status turns overdue and management reports reconcile balances', async () => {
  const { invoice } = await invoiceWithBalance();
  f.setTime('2026-12-11T01:00:00Z');
  const manager = await f.login('manager');
  const detail = await manager.get(`/invoices/${invoice.id}`).expect(200);
  assert.equal(detail.body.data.status, 'OVERDUE');
  const report = await manager.get('/reports/billing?month=2026-11').expect(200);
  assert.equal(report.body.data.billedPaise, 6000);
  assert.equal(report.body.data.outstandingPaise, 6000);
  const exportRes = await manager.get('/reports/billing/export?month=2026-11').expect(200);
  assert.match(String(exportRes.headers['content-type']), /text\/csv/);
  assert.match(exportRes.text, /6000/);
});
