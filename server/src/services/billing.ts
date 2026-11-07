import type { Context, Row } from '../types.js';
import { all, audit, id, one, run } from '../db.js';
import { ensure, find, iso, monthRange, today } from '../lib.js';

export function invoicePreview(ctx: Context, userId: string, month: string) {
  const user = find(ctx, 'users', userId);
  ensure(user.roll_number, 400, 'NOT_A_STUDENT', 'Invoices are only issued for current or former student accounts');
  const { start, end } = monthRange(month);
  const meals = all(ctx.db, `SELECT b.id AS sourceId, 'MEAL' AS sourceType, m.service_date || ' ' || m.meal_type || ' — ' || m.title AS description, 1 AS quantity, b.price_paise AS unitPricePaise FROM bookings b JOIN meal_services m ON b.meal_id=m.id WHERE b.user_id=? AND b.status!='CANCELLED' AND m.status='PUBLISHED' AND m.service_date>=? AND m.service_date<? ORDER BY m.starts_at`, userId, start, end);
  const extras = all(ctx.db, `SELECT o.id AS sourceId, 'EXTRA' AS sourceType, m.service_date || ' ' || e.name AS description, o.quantity, o.unit_price_paise AS unitPricePaise FROM extra_orders o JOIN bookings b ON o.booking_id=b.id JOIN extras e ON o.extra_id=e.id JOIN meal_services m ON b.meal_id=m.id WHERE b.user_id=? AND o.status!='CANCELLED' AND b.status!='CANCELLED' AND m.status='PUBLISHED' AND m.service_date>=? AND m.service_date<? ORDER BY m.starts_at`, userId, start, end);
  const lines = [...meals, ...extras];
  return { userId, month, lines, totalPaise: lines.reduce((sum, line) => sum + line.quantity * line.unitPricePaise, 0), provisional: end > today(ctx) };
}
export function invoiceView(ctx: Context, invoice: Row, withLines = true) {
  const paid = one(ctx.db, 'SELECT COALESCE(sum(amount_paise),0) AS n FROM payments WHERE invoice_id=?', invoice.id)!.n;
  const outstanding = invoice.total_paise - paid;
  return { ...invoice, payments_mode: ctx.config.paymentsMode, paid_paise: paid, outstanding_paise: outstanding, status: outstanding === 0 ? 'PAID' : invoice.due_on < today(ctx) ? 'OVERDUE' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID', ...(withLines ? { lines: all(ctx.db, 'SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY description, id', invoice.id), payments: all(ctx.db, 'SELECT id, amount_paise, method, reference, created_at FROM payments WHERE invoice_id=? ORDER BY created_at', invoice.id) } : {}) };
}
export function issueInvoice(ctx: Context, userId: string, month: string, dueOn: string, actorId: string) {
  const range = monthRange(month);
  ensure(range.end <= today(ctx), 400, 'MONTH_NOT_CLOSED', 'Final invoices can only be issued after the billing month closes');
  ensure(dueOn >= today(ctx), 400, 'INVALID_DUE_DATE', 'The due date cannot be in the past');
  const existing = one(ctx.db, 'SELECT * FROM invoices WHERE user_id=? AND month=?', userId, month);
  if (existing) return invoiceView(ctx, existing);
  const preview = invoicePreview(ctx, userId, month);
  const invoiceId = id();
  run(ctx.db, 'INSERT INTO invoices VALUES (?,?,?,?,?,?,?)', invoiceId, userId, month, preview.totalPaise, actorId, iso(ctx), dueOn);
  for (const line of preview.lines) run(ctx.db, 'INSERT INTO invoice_lines VALUES (?,?,?,?,?,?,?)', id(), invoiceId, line.sourceType, line.sourceId, line.description, line.quantity, line.unitPricePaise);
  audit(ctx.db, actorId, 'INVOICE_ISSUED', 'INVOICE', invoiceId, { userId, month, totalPaise: preview.totalPaise }, iso(ctx));
  return invoiceView(ctx, find(ctx, 'invoices', invoiceId));
}
