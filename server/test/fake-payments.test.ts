import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, booked } from './helpers.js';
import { id, one } from '../src/db.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); f.config.paymentsMode = 'FAKE'; });
afterEach(() => { f.close(); });
async function bill() {
  await booked(f, f.meal());
  f.setTime('2026-12-01T01:00:00Z');
  const manager = await f.login('manager');
  const invoice = await manager.post('/invoices', { userId: f.ids.student, month: '2026-11', dueOn: '2026-12-10' }).expect(201);
  return { invoice: invoice.body.data, manager, student: await f.login() };
}
test('successful fake payments settle an invoice and clearly identify that no money moved', async () => {
  const { invoice, student } = await bill();
  const response = await student.post(`/invoices/${invoice.id}/fake-payment`, { amountPaise: 6000, outcome: 'SUCCESS', idempotencyKey: id() }).expect(201);
  assert.equal(response.body.data.simulated, true);
  assert.equal(response.body.data.moneyMoved, false);
  assert.equal(response.body.data.invoice.status, 'PAID');
  assert.equal(response.body.data.invoice.payments_mode, 'FAKE');
  assert.equal(response.body.data.invoice.payments[0].method, 'FAKE');
  assert.match(response.body.data.invoice.payments[0].reference, /^FAKE-/);
});
test('failed fake payments record an attempt and leave the balance unchanged', async () => {
  const { invoice, student } = await bill();
  const body = { amountPaise: 6000, outcome: 'FAILURE', idempotencyKey: id() };
  const response = await student.post(`/invoices/${invoice.id}/fake-payment`, body).expect(201);
  assert.equal(response.body.data.attempt.outcome, 'FAILURE');
  assert.equal(response.body.data.invoice.outstanding_paise, 6000);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM payments')!.n, 0);
  const replay = await student.post(`/invoices/${invoice.id}/fake-payment`, body).expect(201);
  assert.equal(replay.body.data.attempt.id, response.body.data.attempt.id);
  await student.post(`/invoices/${invoice.id}/fake-payment`, { ...body, outcome: 'SUCCESS' }).expect(409);
});
test('fake payments preserve idempotency, partial settlement and overpayment protection', async () => {
  const { invoice, student } = await bill();
  const body = { amountPaise: 4000, outcome: 'SUCCESS', idempotencyKey: id() };
  const first = await student.post(`/invoices/${invoice.id}/fake-payment`, body).expect(201);
  const repeated = await student.post(`/invoices/${invoice.id}/fake-payment`, body).expect(201);
  assert.equal(first.body.data.attempt.id, repeated.body.data.attempt.id);
  assert.equal(repeated.body.data.invoice.status, 'PARTIALLY_PAID');
  await student.post(`/invoices/${invoice.id}/fake-payment`, { ...body, idempotencyKey: id() }).expect(409);
  assert.equal(one(f.db, 'SELECT sum(amount_paise) AS n FROM payments')!.n, 4000);
});
test('students cannot simulate someone else’s payment and fake mode rejects manual collection', async () => {
  const { invoice, manager } = await bill();
  const other = await f.login('other');
  await other.post(`/invoices/${invoice.id}/fake-payment`, { amountPaise: 6000, outcome: 'SUCCESS', idempotencyKey: id() }).expect(403);
  await manager.post(`/invoices/${invoice.id}/payments`, { amountPaise: 6000, method: 'CASH', reference: 'cash', idempotencyKey: id() }).expect(409);
});
test('manual mode disables fake payment endpoints', async () => {
  const { invoice, student } = await bill();
  f.config.paymentsMode = 'MANUAL';
  await student.post(`/invoices/${invoice.id}/fake-payment`, { amountPaise: 6000, outcome: 'SUCCESS', idempotencyKey: id() }).expect(409);
});
test('reports separate simulated collections from verified collections', async () => {
  const { invoice, student, manager } = await bill();
  await student.post(`/invoices/${invoice.id}/fake-payment`, { amountPaise: 6000, outcome: 'SUCCESS', idempotencyKey: id() }).expect(201);
  const report = await manager.get('/reports/billing?month=2026-11').expect(200);
  assert.equal(report.body.data.simulatedCollectionsPaise, 6000);
  assert.equal(report.body.data.verifiedCollectionsPaise, 0);
  assert.equal(report.body.data.outstandingPaise, 0);
  const cashPeriod = await manager.get('/reports/billing?month=2026-12').expect(200);
  assert.equal(cashPeriod.body.data.cashReceivedDuringMonthPaise, 0);
  assert.equal(cashPeriod.body.data.simulatedReceivedDuringMonthPaise, 6000);
  const exported = await manager.get('/reports/billing/export?month=2026-11').expect(200);
  assert.match(exported.text, /simulated_paid_paise/);
  assert.match(exported.text, /FAKE/);
});
test('attempt history includes failures, is paginated and remains private', async () => {
  const { invoice, student, manager } = await bill();
  await student.post(`/invoices/${invoice.id}/fake-payment`, { amountPaise: 6000, outcome: 'FAILURE', idempotencyKey: id() }).expect(201);
  await student.post(`/invoices/${invoice.id}/fake-payment`, { amountPaise: 6000, outcome: 'SUCCESS', idempotencyKey: id() }).expect(201);
  const history = await student.get(`/invoices/${invoice.id}/payment-attempts?limit=1`).expect(200);
  assert.equal(history.body.data.total, 2);
  assert.equal(history.body.data.items.length, 1);
  await manager.get(`/invoices/${invoice.id}/payment-attempts`).expect(200);
  const other = await f.login('other');
  await other.get(`/invoices/${invoice.id}/payment-attempts`).expect(403);
});
