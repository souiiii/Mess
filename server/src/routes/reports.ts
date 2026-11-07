import { z } from 'zod';
import type { Api } from '../api.js';
import { management, operations } from '../api.js';
import type { Context, Row } from '../types.js';
import { all, one } from '../db.js';
import { actor, dateRange, dateSchema, iso, monthRange, monthSchema, today } from '../lib.js';
import { invoicePreview } from '../services/billing.js';

function operationReport(ctx: Context, from: string, to: string): Row[] {
  const meals = all(ctx.db, `SELECT m.id, m.service_date, m.meal_type, m.title, m.capacity, m.starts_at, m.ends_at,
    (SELECT count(*) FROM bookings b WHERE b.meal_id=m.id AND b.status!='CANCELLED') AS booked,
    (SELECT count(*) FROM bookings b WHERE b.meal_id=m.id AND b.status='ATTENDED') AS attended,
    (SELECT count(*) FROM bookings b WHERE b.meal_id=m.id AND b.status='CANCELLED') AS cancelled,
    (SELECT COALESCE(sum(o.quantity),0) FROM extra_orders o JOIN bookings b ON o.booking_id=b.id WHERE b.meal_id=m.id AND o.status!='CANCELLED') AS extras_reserved,
    (SELECT count(*) FROM leave_requests l JOIN users u ON l.user_id=u.id WHERE l.status='APPROVED' AND l.starts_on<=m.service_date AND l.ends_on>=m.service_date AND u.active=1) AS residents_on_leave,
    w.prepared_portions, w.leftover_portions, w.waste_grams,
    (SELECT round(avg(f.taste),2) FROM feedback f JOIN bookings b ON f.booking_id=b.id WHERE b.meal_id=m.id) AS taste_rating,
    (SELECT round(avg(f.hygiene),2) FROM feedback f JOIN bookings b ON f.booking_id=b.id WHERE b.meal_id=m.id) AS hygiene_rating,
    (SELECT round(avg(f.portion),2) FROM feedback f JOIN bookings b ON f.booking_id=b.id WHERE b.meal_id=m.id) AS portion_rating,
    (SELECT count(*) FROM feedback f JOIN bookings b ON f.booking_id=b.id WHERE b.meal_id=m.id) AS feedback_count
    FROM meal_services m LEFT JOIN service_waste w ON w.meal_id=m.id WHERE m.service_date BETWEEN ? AND ? AND m.status='PUBLISHED' ORDER BY m.starts_at`, from, to);
  return meals.map(meal => ({ ...meal, no_shows: meal.ends_at <= iso(ctx) ? meal.booked - meal.attended : null, attendance_percent: meal.booked ? Math.round(meal.attended * 10000 / meal.booked) / 100 : 0 }));
}
export function csv(rows: Record<string, unknown>[], columns: string[]) {
  const escape = (value: unknown) => {
    let str = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [columns.map(escape).join(','), ...rows.map(row => columns.map(col => escape(row[col])).join(','))].join('\r\n');
}
export function reportRoutes(api: Api) {
  const ctx = api.ctx;
  api.route({ method: 'get', path: '/dashboard', tag: 'Dashboard', summary: 'Role-aware overview of bookings, operations and pending work' }, ({ req }) => {
    const user = actor(req);
    const date = today(ctx);
    const now = iso(ctx);
    if (user.role === 'STUDENT') {
      const outstanding = one(ctx.db, `SELECT COALESCE(sum(i.total_paise - COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.invoice_id=i.id),0)),0) AS n FROM invoices i WHERE i.user_id=?`, user.id)!.n;
      return { role: user.role, date, billingMonth: date.slice(0, 7), provisionalBillPaise: invoicePreview(ctx, user.id, date.slice(0, 7)).totalPaise, outstandingPaise: outstanding,
        upcomingBookings: all(ctx.db, "SELECT b.id, b.price_paise, m.service_date, m.meal_type, m.title, m.menu, m.starts_at, m.ends_at, m.cutoff_at FROM bookings b JOIN meal_services m ON b.meal_id=m.id WHERE b.user_id=? AND b.status='CONFIRMED' AND m.ends_at>? ORDER BY m.starts_at LIMIT 12", user.id, now).map(row => ({ ...row, menu: JSON.parse(row.menu) })),
        pendingLeaves: one(ctx.db, "SELECT count(*) AS n FROM leave_requests WHERE user_id=? AND status='PENDING'", user.id)!.n,
        openComplaints: one(ctx.db, "SELECT count(*) AS n FROM complaints WHERE user_id=? AND status!='RESOLVED'", user.id)!.n
      };
    }
    return { role: user.role, date, services: operationReport(ctx, date, date),
      lowStockItems: all(ctx.db, 'SELECT * FROM inventory_items WHERE stock<=low_stock_threshold ORDER BY name LIMIT 20'),
      openComplaints: one(ctx.db, "SELECT count(*) AS n FROM complaints WHERE status!='RESOLVED' AND (?=0 OR category!='BILLING')", Number(user.role === 'STAFF'))!.n,
      ...(management.includes(user.role) ? {
        activeResidents: one(ctx.db, "SELECT count(*) AS n FROM users WHERE role='STUDENT' AND active=1")!.n,
        pendingLeaves: one(ctx.db, "SELECT count(*) AS n FROM leave_requests WHERE status='PENDING'")!.n,
        overduePaise: one(ctx.db, 'SELECT COALESCE(sum(i.total_paise - COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.invoice_id=i.id),0)),0) AS n FROM invoices i WHERE i.due_on<?', date)!.n
      } : {})
    };
  });
  api.route({ method: 'get', path: '/reports/operations', tag: 'Reports', summary: 'Headcounts, attendance, no-shows, feedback and food waste by meal', roles: operations, query: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }) }, ({ query }) => {
    const { from, to } = dateRange(query, ctx);
    const services = operationReport(ctx, from, to);
    const diets = all(ctx.db, "SELECT m.id AS meal_id, u.dietary_preference, count(*) AS count FROM bookings b JOIN users u ON b.user_id=u.id JOIN meal_services m ON b.meal_id=m.id WHERE m.service_date BETWEEN ? AND ? AND b.status!='CANCELLED' GROUP BY m.id,u.dietary_preference", from, to);
    const extras = all(ctx.db, "SELECT e.meal_id, e.name, sum(o.quantity) AS quantity FROM extra_orders o JOIN extras e ON o.extra_id=e.id JOIN meal_services m ON e.meal_id=m.id WHERE m.service_date BETWEEN ? AND ? AND o.status!='CANCELLED' GROUP BY e.id", from, to);
    return { from, to, services: services.map(service => ({ ...service, dietaryCounts: diets.filter(diet => diet.meal_id === service.id), extras: extras.filter(extra => extra.meal_id === service.id) })) };
  });
  api.route({ method: 'get', path: '/reports/billing', tag: 'Reports', summary: 'Monthly billed revenue, verified collections, procurement and outstanding balances', roles: management, query: z.object({ month: monthSchema }) }, ({ query }) => {
    const { start, end } = monthRange(query.month);
    return {
      month: query.month,
      invoiceCount: one(ctx.db, 'SELECT count(*) AS n FROM invoices WHERE month=?', query.month)!.n,
      billedPaise: one(ctx.db, 'SELECT COALESCE(sum(total_paise),0) AS n FROM invoices WHERE month=?', query.month)!.n,
      collectedForInvoicesPaise: one(ctx.db, 'SELECT COALESCE(sum(p.amount_paise),0) AS n FROM payments p JOIN invoices i ON p.invoice_id=i.id WHERE i.month=?', query.month)!.n,
      cashReceivedDuringMonthPaise: one(ctx.db, "SELECT COALESCE(sum(amount_paise),0) AS n FROM payments WHERE date(created_at,'+5 hours','+30 minutes')>=? AND date(created_at,'+5 hours','+30 minutes')<?", start, end)!.n,
      procurementCostPaise: one(ctx.db, "SELECT COALESCE(sum(total_cost_paise),0) AS n FROM stock_movements WHERE kind='RECEIVE' AND date(created_at,'+5 hours','+30 minutes')>=? AND date(created_at,'+5 hours','+30 minutes')<?", start, end)!.n,
      outstandingPaise: one(ctx.db, 'SELECT COALESCE(sum(i.total_paise - COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.invoice_id=i.id),0)),0) AS n FROM invoices i WHERE i.month=?', query.month)!.n
    };
  });
  api.route({ method: 'get', path: '/reports/billing/export', tag: 'Reports', summary: 'Download the monthly invoice ledger as a spreadsheet-safe CSV', roles: management, query: z.object({ month: monthSchema }) }, ({ query, res }) => {
    const rows = all(ctx.db, `SELECT i.id AS invoice_id, u.name, u.roll_number, i.month, i.total_paise, COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.invoice_id=i.id),0) AS paid_paise, i.total_paise-COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.invoice_id=i.id),0) AS outstanding_paise, i.due_on FROM invoices i JOIN users u ON i.user_id=u.id WHERE month=? ORDER BY u.roll_number LIMIT 10000`, query.month);
    res.type('text/csv').attachment(`mess-billing-${query.month}.csv`).send(csv(rows, ['invoice_id','name','roll_number','month','total_paise','paid_paise','outstanding_paise','due_on']));
  });
}
