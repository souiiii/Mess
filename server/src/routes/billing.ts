import { z } from 'zod';
import type { Api } from '../api.js';
import { management } from '../api.js';
import { all, audit, id, one, run, transaction } from '../db.js';
import { actor, dateSchema, ensure, find, iso, money, monthSchema, owned, pageSchema, pagination, text, uuidSchema } from '../lib.js';
import { invoicePreview, invoiceView, issueInvoice } from '../services/billing.js';

export function billingRoutes(api: Api) {
  const ctx = api.ctx;
  api.route({ method: 'get', path: '/billing/preview', tag: 'Billing', summary: 'Preview a month using locked booking and extra prices', query: z.object({ month: monthSchema, userId: uuidSchema.optional() }) }, ({ req, query }) => {
    const userId = query.userId ?? actor(req).id;
    owned(req, userId);
    return invoicePreview(ctx, userId, query.month);
  });
  api.route({ method: 'post', path: '/invoices', tag: 'Billing', summary: 'Issue an immutable invoice for a closed month; duplicate requests return the existing invoice', roles: management, status: 201, body: z.object({ userId: uuidSchema, month: monthSchema, dueOn: dateSchema }).strict() }, ({ req, body }) => transaction(ctx.db, () => issueInvoice(ctx, body.userId, body.month, body.dueOn, actor(req).id)));
  api.route({ method: 'post', path: '/invoices/bulk', tag: 'Billing', summary: 'Atomically issue a closed-month invoice for up to 100 students', roles: management, status: 201, body: z.object({ userIds: z.array(uuidSchema).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'User IDs must be unique'), month: monthSchema, dueOn: dateSchema }).strict() }, ({ req, body }) => transaction(ctx.db, () => body.userIds.map(userId => issueInvoice(ctx, userId, body.month, body.dueOn, actor(req).id))));
  api.route({ method: 'get', path: '/invoices', tag: 'Billing', summary: 'List your invoices, or the management billing ledger', query: pageSchema.extend({ month: monthSchema.optional(), userId: uuidSchema.optional() }) }, ({ req, query }) => {
    const { page, limit, offset } = pagination(query);
    const userId = query.userId ?? (management.includes(actor(req).role) ? null : actor(req).id);
    if (userId) owned(req, userId);
    const where = 'WHERE (? IS NULL OR i.user_id=?) AND (? IS NULL OR i.month=?)';
    const binds = [userId, userId, query.month ?? null, query.month ?? null];
    return { items: all(ctx.db, `SELECT i.*, u.name, u.roll_number FROM invoices i JOIN users u ON i.user_id=u.id ${where} ORDER BY i.month DESC, i.id LIMIT ? OFFSET ?`, ...binds, limit, offset).map(invoice => invoiceView(ctx, invoice, false)), total: one(ctx.db, `SELECT count(*) AS n FROM invoices i ${where}`, ...binds)!.n, page, limit };
  });
  api.route({ method: 'get', path: '/invoices/:id', tag: 'Billing', summary: 'Read invoice line items and verified payment records' }, ({ req, params }) => {
    const invoice = find(ctx, 'invoices', params.id!);
    owned(req, invoice.user_id);
    return invoiceView(ctx, invoice);
  });
  api.route({ method: 'post', path: '/invoices/:id/payments', tag: 'Billing', summary: 'Record a verified manual payment with an idempotency key', description: 'This records a payment verified by management. It does not transfer money or verify a UPI transaction automatically.', roles: management, status: 201,
    body: z.object({ amountPaise: money.refine(value => value > 0), method: z.enum(['CASH','BANK_TRANSFER','UPI']), reference: text(100), idempotencyKey: z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/) }).strict()
  }, ({ req, params, body }) => transaction(ctx.db, () => {
    const invoice = find(ctx, 'invoices', params.id!);
    const existing = one(ctx.db, 'SELECT * FROM payments WHERE idempotency_key=?', body.idempotencyKey);
    if (existing) {
      ensure(existing.invoice_id === invoice.id && existing.amount_paise === body.amountPaise && existing.reference === body.reference && existing.method === body.method, 409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used for a different payment');
      return { payment: existing, invoice: invoiceView(ctx, invoice) };
    }
    const view = invoiceView(ctx, invoice);
    ensure(body.amountPaise <= view.outstanding_paise, 409, 'OVERPAYMENT', 'The payment exceeds the outstanding balance');
    const paymentId = id();
    run(ctx.db, 'INSERT INTO payments VALUES (?,?,?,?,?,?,?,?)', paymentId, invoice.id, body.amountPaise, body.method, body.reference, body.idempotencyKey, actor(req).id, iso(ctx));
    audit(ctx.db, actor(req).id, 'PAYMENT_RECORDED', 'PAYMENT', paymentId, { invoiceId: invoice.id, amountPaise: body.amountPaise, method: body.method }, iso(ctx));
    return { payment: find(ctx, 'payments', paymentId), invoice: invoiceView(ctx, invoice) };
  }));
}
