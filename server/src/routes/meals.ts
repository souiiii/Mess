import { z } from 'zod';
import type { Api } from '../api.js';
import { management, operations } from '../api.js';
import { all, audit, id, one, run, transaction } from '../db.js';
import { actor, addDays, dateRange, dateSchema, ensure, find, iso, localDate, money, owned, pageSchema, pagination, text, timestampSchema, today, uuidSchema } from '../lib.js';
import { bookMeal, bookingDetails, cancelBooking } from '../services/bookings.js';
import { digest, secret } from '../auth.js';

const mealSchema = z.object({
  serviceDate: dateSchema, mealType: z.enum(['BREAKFAST','LUNCH','SNACKS','DINNER']), title: text(100),
  menu: z.array(text(100)).min(1).max(30), allergens: z.array(text(50)).max(20),
  dietaryType: z.enum(['VEG','NON_VEG','VEGAN','MIXED']), pricePaise: money,
  capacity: z.number().int().min(1).max(10000), startsAt: timestampSchema, endsAt: timestampSchema, cutoffAt: timestampSchema
}).strict();
const rangeQuery = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });
function mealView(row: Record<string, any>) {
  return { ...row, menu: JSON.parse(row.menu), allergens: JSON.parse(row.allergens) };
}
export function mealRoutes(api: Api) {
  const ctx = api.ctx;
  api.route({ method: 'post', path: '/meals', tag: 'Meals', summary: 'Create a draft dated meal with menu, capacity and cutoff', roles: management, body: mealSchema, status: 201 }, ({ req, body }) => transaction(ctx.db, () => {
    ensure(body.cutoffAt > iso(ctx) && body.cutoffAt < body.startsAt && body.startsAt < body.endsAt, 400, 'INVALID_MEAL_TIMES', 'Set a future cutoff before the service starts and an end after the start');
    ensure(localDate(new Date(body.startsAt)) === body.serviceDate && localDate(new Date(body.endsAt)) === body.serviceDate, 400, 'DATE_MISMATCH', 'Service start and end must fall on the service date in Asia/Kolkata');
    ensure(body.serviceDate <= addDays(today(ctx), 366), 400, 'DATE_TOO_FAR', 'Schedule meals at most a year ahead');
    const mealId = id();
    run(ctx.db, `INSERT INTO meal_services VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?)`, mealId, body.serviceDate, body.mealType, body.title, JSON.stringify(body.menu), JSON.stringify(body.allergens), body.dietaryType, body.pricePaise, body.capacity, body.startsAt, body.endsAt, body.cutoffAt, actor(req).id, iso(ctx));
    audit(ctx.db, actor(req).id, 'MEAL_CREATED', 'MEAL', mealId, {}, iso(ctx));
    return mealView(find(ctx, 'meal_services', mealId));
  }));
  api.route({ method: 'patch', path: '/meals/:id', tag: 'Meals', summary: 'Edit a draft meal before publishing it', roles: management, body: mealSchema }, ({ req, params, body }) => transaction(ctx.db, () => {
    const meal = find(ctx, 'meal_services', params.id!);
    ensure(meal.status === 'DRAFT', 409, 'MEAL_LOCKED', 'Published meals are locked; cancel and announce a replacement if necessary');
    ensure(body.cutoffAt > iso(ctx) && body.cutoffAt < body.startsAt && body.startsAt < body.endsAt, 400, 'INVALID_MEAL_TIMES', 'Set a future cutoff before service starts and an end after the start');
    ensure(localDate(new Date(body.startsAt)) === body.serviceDate && localDate(new Date(body.endsAt)) === body.serviceDate && body.serviceDate <= addDays(today(ctx), 366), 400, 'DATE_MISMATCH', 'Choose a valid service date within one year');
    run(ctx.db, 'UPDATE meal_services SET service_date=?, meal_type=?, title=?, menu=?, allergens=?, dietary_type=?, price_paise=?, capacity=?, starts_at=?, ends_at=?, cutoff_at=? WHERE id=?', body.serviceDate, body.mealType, body.title, JSON.stringify(body.menu), JSON.stringify(body.allergens), body.dietaryType, body.pricePaise, body.capacity, body.startsAt, body.endsAt, body.cutoffAt, meal.id);
    audit(ctx.db, actor(req).id, 'MEAL_UPDATED', 'MEAL', meal.id, {}, iso(ctx));
    return mealView(find(ctx, 'meal_services', meal.id));
  }));
  api.route({ method: 'post', path: '/meals/:id/publish', tag: 'Meals', summary: 'Publish a draft for student bookings', roles: management }, ({ req, params }) => transaction(ctx.db, () => {
    const meal = find(ctx, 'meal_services', params.id!);
    ensure(meal.status === 'DRAFT' && iso(ctx) < meal.cutoff_at, 409, 'CANNOT_PUBLISH', 'Only drafts with a future cutoff can be published');
    run(ctx.db, "UPDATE meal_services SET status='PUBLISHED' WHERE id=?", meal.id);
    audit(ctx.db, actor(req).id, 'MEAL_PUBLISHED', 'MEAL', meal.id, {}, iso(ctx));
    return mealView(find(ctx, 'meal_services', meal.id));
  }));
  api.route({ method: 'post', path: '/meals/:id/cancel', tag: 'Meals', summary: 'Cancel an upcoming meal and remove every booking and extra charge', roles: management, body: z.object({ reason: text(500) }).strict() }, ({ req, params, body }) => transaction(ctx.db, () => {
    const meal = find(ctx, 'meal_services', params.id!);
    ensure(meal.status !== 'CANCELLED' && iso(ctx) < meal.starts_at, 409, 'CANNOT_CANCEL_SERVICE', 'Only an upcoming, uncancelled meal can be cancelled');
    const bookings = all(ctx.db, "SELECT * FROM bookings WHERE meal_id=? AND status='CONFIRMED'", meal.id);
    for (const booking of bookings) cancelBooking(ctx, booking, body.reason);
    run(ctx.db, "UPDATE meal_services SET status='CANCELLED' WHERE id=?", meal.id);
    audit(ctx.db, actor(req).id, 'MEAL_CANCELLED', 'MEAL', meal.id, { reason: body.reason, bookingsCancelled: bookings.length }, iso(ctx));
    return { ...mealView(find(ctx, 'meal_services', meal.id)), bookingsCancelled: bookings.length };
  }));
  api.route({ method: 'get', path: '/meals', tag: 'Meals', summary: 'Date-range menus with capacity, extras and your booking', query: rangeQuery }, ({ req, query }) => {
    const { from, to } = dateRange(query, ctx);
    const student = actor(req).role === 'STUDENT';
    const rows = all(ctx.db, `SELECT m.*, (SELECT count(*) FROM bookings b WHERE b.meal_id=m.id AND b.status!='CANCELLED') AS booked_count, (SELECT count(*) FROM bookings b WHERE b.meal_id=m.id AND b.status='ATTENDED') AS attended_count, b.id AS my_booking_id, b.status AS my_booking_status FROM meal_services m LEFT JOIN bookings b ON b.meal_id=m.id AND b.user_id=? WHERE service_date BETWEEN ? AND ? AND (?=0 OR m.status!='DRAFT') ORDER BY starts_at`, actor(req).id, from, to, Number(student));
    const extras = all(ctx.db, `SELECT e.*, e.capacity-COALESCE((SELECT sum(quantity) FROM extra_orders o WHERE o.extra_id=e.id AND o.status!='CANCELLED'),0) AS available FROM extras e JOIN meal_services m ON e.meal_id=m.id WHERE m.service_date BETWEEN ? AND ?`, from, to);
    return rows.map(row => ({ ...mealView(row), available: row.capacity - row.booked_count, extras: extras.filter(extra => extra.meal_id === row.id).map(extra => ({ ...extra, allergens: JSON.parse(extra.allergens) })) }));
  });
  api.route({ method: 'post', path: '/meals/:id/extras', tag: 'Extras', summary: 'Offer a limited-quantity extra for a meal', roles: management, status: 201,
    body: z.object({ name: text(80), pricePaise: money.refine(value => value > 0), capacity: z.number().int().min(1).max(10000), allergens: z.array(text(50)).max(20) }).strict()
  }, ({ req, params, body }) => transaction(ctx.db, () => {
    const meal = find(ctx, 'meal_services', params.id!);
    ensure(meal.status !== 'CANCELLED' && iso(ctx) < meal.cutoff_at, 409, 'CUTOFF_PASSED', 'Extras can only be added before the cutoff');
    const extraId = id();
    run(ctx.db, 'INSERT INTO extras VALUES (?,?,?,?,?,?)', extraId, meal.id, body.name, body.pricePaise, body.capacity, JSON.stringify(body.allergens));
    audit(ctx.db, actor(req).id, 'EXTRA_CREATED', 'EXTRA', extraId, {}, iso(ctx));
    const extra = find(ctx, 'extras', extraId);
    return { ...extra, allergens: JSON.parse(extra.allergens) };
  }));
  api.route({ method: 'post', path: '/bookings', tag: 'Bookings', summary: 'Book a meal; repeat requests return the same booking', roles: ['STUDENT'], body: z.object({ mealId: uuidSchema }).strict(), status: 201 }, ({ req, body }) => transaction(ctx.db, () => bookMeal(ctx, actor(req).id, body.mealId)));
  api.route({ method: 'post', path: '/bookings/bulk', tag: 'Bookings', summary: 'Atomically book up to 28 meals', roles: ['STUDENT'], body: z.object({ mealIds: z.array(uuidSchema).min(1).max(28).refine(ids => new Set(ids).size === ids.length, 'Meal IDs must be unique') }).strict(), status: 201 }, ({ req, body }) => transaction(ctx.db, () => body.mealIds.map(mealId => bookMeal(ctx, actor(req).id, mealId))));
  api.route({ method: 'get', path: '/bookings', tag: 'Bookings', summary: 'List your bookings; managers can filter by user or meal',
    query: pageSchema.extend({ from: dateSchema.optional(), to: dateSchema.optional(), userId: uuidSchema.optional(), mealId: uuidSchema.optional(), status: z.enum(['CONFIRMED','CANCELLED','ATTENDED']).optional() })
  }, ({ req, query }) => {
    const { from, to } = dateRange(query, ctx);
    const { page, limit, offset } = pagination(query);
    const userId = query.userId ?? (['MANAGER','ADMIN','STAFF'].includes(actor(req).role) ? null : actor(req).id);
    if (userId) owned(req, userId, true);
    const where = 'WHERE m.service_date BETWEEN ? AND ? AND (? IS NULL OR b.user_id=?) AND (? IS NULL OR b.meal_id=?) AND (? IS NULL OR b.status=?)';
    const binds = [from, to, userId, userId, query.mealId ?? null, query.mealId ?? null, query.status ?? null, query.status ?? null];
    return { items: all(ctx.db, `SELECT b.*, m.service_date, m.meal_type, m.title, m.starts_at, m.ends_at, m.cutoff_at, u.name, u.roll_number FROM bookings b JOIN meal_services m ON b.meal_id=m.id JOIN users u ON b.user_id=u.id ${where} ORDER BY m.starts_at, b.id LIMIT ? OFFSET ?`, ...binds, limit, offset), total: one(ctx.db, `SELECT count(*) AS n FROM bookings b JOIN meal_services m ON b.meal_id=m.id ${where}`, ...binds)!.n, page, limit };
  });
  api.route({ method: 'get', path: '/bookings/:id', tag: 'Bookings', summary: 'Read a booking and its extras' }, ({ req, params }) => {
    const booking = find(ctx, 'bookings', params.id!);
    owned(req, booking.user_id, true);
    const detail = bookingDetails(ctx, booking);
    return { ...detail, meal: mealView(detail.meal) };
  });
  api.route({ method: 'post', path: '/bookings/:id/cancel', tag: 'Bookings', summary: 'Cancel your booking and extras before cutoff', roles: ['STUDENT'], body: z.object({ reason: text(500) }).strict() }, ({ req, params, body }) => transaction(ctx.db, () => {
    const booking = find(ctx, 'bookings', params.id!);
    ensure(booking.user_id === actor(req).id, 403, 'FORBIDDEN', 'You can only cancel your own bookings');
    const meal = find(ctx, 'meal_services', booking.meal_id);
    ensure(booking.status === 'CONFIRMED' && iso(ctx) < meal.cutoff_at, 409, 'CANNOT_CANCEL', 'Only confirmed bookings before cutoff can be cancelled');
    cancelBooking(ctx, booking, body.reason);
    audit(ctx.db, actor(req).id, 'BOOKING_CANCELLED', 'BOOKING', booking.id, { reason: body.reason }, iso(ctx));
    return find(ctx, 'bookings', booking.id);
  }));
  api.route({ method: 'post', path: '/bookings/:id/extras', tag: 'Extras', summary: 'Reserve an extra with stock and locked pricing', roles: ['STUDENT'],
    body: z.object({ extraId: uuidSchema, quantity: z.number().int().min(1).max(10) }).strict(), status: 201
  }, ({ req, params, body }) => transaction(ctx.db, () => {
    const booking = find(ctx, 'bookings', params.id!);
    ensure(booking.user_id === actor(req).id, 403, 'FORBIDDEN', 'You can only order extras for your own booking');
    const meal = find(ctx, 'meal_services', booking.meal_id);
    ensure(booking.status === 'CONFIRMED' && iso(ctx) < meal.cutoff_at, 409, 'CUTOFF_PASSED', 'Extras require a confirmed booking before cutoff');
    const extra = find(ctx, 'extras', body.extraId);
    ensure(extra.meal_id === booking.meal_id, 400, 'EXTRA_MEAL_MISMATCH', 'Choose an extra for this meal');
    const existing = one(ctx.db, 'SELECT * FROM extra_orders WHERE booking_id=? AND extra_id=?', booking.id, extra.id);
    if (existing && existing.status === 'CONFIRMED') {
      ensure(existing.quantity === body.quantity, 409, 'EXTRA_ALREADY_ORDERED', 'Cancel your existing extra before changing its quantity');
      return existing;
    }
    const reserved = one(ctx.db, "SELECT COALESCE(sum(quantity),0) AS n FROM extra_orders WHERE extra_id=? AND status!='CANCELLED'", extra.id)!.n;
    ensure(reserved + body.quantity <= extra.capacity, 409, 'EXTRA_SOLD_OUT', 'There is not enough of this extra available');
    const orderId = existing?.id ?? id();
    if (existing) run(ctx.db, "UPDATE extra_orders SET status='CONFIRMED', quantity=?, unit_price_paise=?, created_at=? WHERE id=?", body.quantity, extra.price_paise, iso(ctx), orderId);
    else run(ctx.db, "INSERT INTO extra_orders VALUES (?,?,?,?,?,'CONFIRMED',?)", orderId, booking.id, extra.id, body.quantity, extra.price_paise, iso(ctx));
    audit(ctx.db, actor(req).id, 'EXTRA_ORDERED', 'EXTRA_ORDER', orderId, { quantity: body.quantity }, iso(ctx));
    return find(ctx, 'extra_orders', orderId);
  }));
  api.route({ method: 'post', path: '/extra-orders/:id/cancel', tag: 'Extras', summary: 'Cancel an extra before the meal cutoff', roles: ['STUDENT'] }, ({ req, params }) => transaction(ctx.db, () => {
    const order = find(ctx, 'extra_orders', params.id!);
    const booking = find(ctx, 'bookings', order.booking_id);
    const meal = find(ctx, 'meal_services', booking.meal_id);
    ensure(booking.user_id === actor(req).id, 403, 'FORBIDDEN', 'You can only cancel your own extras');
    ensure(order.status === 'CONFIRMED' && iso(ctx) < meal.cutoff_at, 409, 'CANNOT_CANCEL', 'Only confirmed extras before cutoff can be cancelled');
    run(ctx.db, "UPDATE extra_orders SET status='CANCELLED' WHERE id=?", order.id);
    audit(ctx.db, actor(req).id, 'EXTRA_CANCELLED', 'EXTRA_ORDER', order.id, {}, iso(ctx));
    return find(ctx, 'extra_orders', order.id);
  }));
  api.route({ method: 'post', path: '/bookings/:id/pass', tag: 'Attendance', summary: 'Issue a single-use meal pass valid for 120 seconds', roles: ['STUDENT'] }, ({ req, params }) => transaction(ctx.db, () => {
    const booking = find(ctx, 'bookings', params.id!);
    ensure(booking.user_id === actor(req).id, 403, 'FORBIDDEN', 'You can only issue your own meal pass');
    const meal = find(ctx, 'meal_services', booking.meal_id);
    ensure(booking.status === 'CONFIRMED' && meal.status === 'PUBLISHED', 409, 'INVALID_BOOKING', 'This booking cannot be used for attendance');
    ensure(ctx.now().valueOf() >= Date.parse(meal.starts_at) - 15 * 60000 && iso(ctx) < meal.ends_at, 409, 'OUTSIDE_SERVICE_WINDOW', 'Meal passes are available from 15 minutes before service until service ends');
    run(ctx.db, 'DELETE FROM meal_passes WHERE booking_id=? OR expires_at<=?', booking.id, iso(ctx));
    const token = secret();
    const expiresAt = new Date(Math.min(ctx.now().valueOf() + 120000, Date.parse(meal.ends_at))).toISOString();
    run(ctx.db, 'INSERT INTO meal_passes VALUES (?,?,?,NULL)', digest(token), booking.id, expiresAt);
    return { token, expiresAt, bookingId: booking.id };
  }));
  api.route({ method: 'post', path: '/attendance/scan', tag: 'Attendance', summary: 'Redeem a meal pass once and fulfil reserved extras', roles: operations, body: z.object({ token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/) }).strict() }, ({ req, body }) => transaction(ctx.db, () => {
    const pass = one(ctx.db, 'SELECT * FROM meal_passes WHERE token_hash=?', digest(body.token));
    ensure(pass && !pass.used_at && pass.expires_at > iso(ctx), 409, 'INVALID_PASS', 'This pass is invalid, expired or already used');
    const booking = find(ctx, 'bookings', pass.booking_id);
    const meal = find(ctx, 'meal_services', booking.meal_id);
    const user = find(ctx, 'users', booking.user_id);
    ensure(user.active && user.role === 'STUDENT' && booking.status === 'CONFIRMED' && meal.status === 'PUBLISHED', 409, 'INVALID_BOOKING', 'This booking cannot be used for attendance');
    ensure(iso(ctx) >= meal.starts_at && iso(ctx) < meal.ends_at, 409, 'OUTSIDE_SERVICE_WINDOW', 'Attendance can only be recorded during service');
    run(ctx.db, 'UPDATE meal_passes SET used_at=? WHERE token_hash=?', iso(ctx), pass.token_hash);
    run(ctx.db, "UPDATE bookings SET status='ATTENDED', attended_at=?, attended_by=? WHERE id=?", iso(ctx), actor(req).id, booking.id);
    run(ctx.db, "UPDATE extra_orders SET status='FULFILLED' WHERE booking_id=? AND status='CONFIRMED'", booking.id);
    audit(ctx.db, actor(req).id, 'ATTENDANCE_RECORDED', 'BOOKING', booking.id, {}, iso(ctx));
    return { bookingId: booking.id, student: { name: user.name, rollNumber: user.roll_number, hostel: user.hostel }, meal: { type: meal.meal_type, date: meal.service_date }, extras: all(ctx.db, "SELECT e.name, o.quantity FROM extra_orders o JOIN extras e ON o.extra_id=e.id WHERE booking_id=? AND status='FULFILLED'", booking.id), attendedAt: iso(ctx) };
  }));
}
