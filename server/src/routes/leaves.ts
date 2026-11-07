import { z } from 'zod';
import type { Api } from '../api.js';
import { management } from '../api.js';
import { all, audit, id, one, run, transaction } from '../db.js';
import { actor, dateSchema, dayCount, ensure, find, iso, owned, pageSchema, pagination, settings, text, today, uuidSchema } from '../lib.js';
import { cancelBooking } from '../services/bookings.js';

export function leaveRoutes(api: Api) {
  const ctx = api.ctx;
  api.route({ method: 'post', path: '/leaves', tag: 'Leave', summary: 'Request leave; pending requests block new bookings for those dates', roles: ['STUDENT'], status: 201,
    body: z.object({ startsOn: dateSchema, endsOn: dateSchema, reason: text(1000) }).strict()
  }, ({ req, body }) => transaction(ctx.db, () => {
    ensure(body.startsOn > today(ctx) && body.startsOn <= body.endsOn, 400, 'INVALID_LEAVE_DATES', 'Leave must start after today and end on or after its start');
    ensure(dayCount(body.startsOn, body.endsOn) >= settings(ctx).minimum_leave_days && dayCount(body.startsOn, body.endsOn) <= 90, 400, 'INVALID_LEAVE_DURATION', `Leave must cover ${settings(ctx).minimum_leave_days} to 90 days`);
    ensure(!one(ctx.db, "SELECT id FROM leave_requests WHERE user_id=? AND status IN ('PENDING','APPROVED') AND starts_on<=? AND ends_on>=?", actor(req).id, body.endsOn, body.startsOn), 409, 'OVERLAPPING_LEAVE', 'An existing pending or approved leave overlaps these dates');
    const locked = one(ctx.db, "SELECT b.id FROM bookings b JOIN meal_services m ON b.meal_id=m.id WHERE b.user_id=? AND m.service_date BETWEEN ? AND ? AND b.status!='CANCELLED' AND m.cutoff_at<=?", actor(req).id, body.startsOn, body.endsOn, iso(ctx));
    ensure(!locked, 409, 'LEAVE_CUTOFF_PASSED', 'A booked meal in this range is already past its cancellation cutoff');
    const leaveId = id();
    run(ctx.db, "INSERT INTO leave_requests (id,user_id,starts_on,ends_on,reason,status,created_at) VALUES (?,?,?,?,?,'PENDING',?)", leaveId, actor(req).id, body.startsOn, body.endsOn, body.reason, iso(ctx));
    audit(ctx.db, actor(req).id, 'LEAVE_REQUESTED', 'LEAVE', leaveId, { startsOn: body.startsOn, endsOn: body.endsOn }, iso(ctx));
    return find(ctx, 'leave_requests', leaveId);
  }));
  api.route({ method: 'get', path: '/leaves', tag: 'Leave', summary: 'Your leave requests, or the management approval queue', query: pageSchema.extend({ userId: uuidSchema.optional(), status: z.enum(['PENDING','APPROVED','REJECTED','WITHDRAWN']).optional() }) }, ({ req, query }) => {
    const { page, limit, offset } = pagination(query);
    const userId = query.userId ?? (management.includes(actor(req).role) ? null : actor(req).id);
    if (userId) owned(req, userId);
    const binds = [userId, userId, query.status ?? null, query.status ?? null];
    const where = 'WHERE (? IS NULL OR l.user_id=?) AND (? IS NULL OR l.status=?)';
    return { items: all(ctx.db, `SELECT l.*, u.name, u.roll_number FROM leave_requests l JOIN users u ON l.user_id=u.id ${where} ORDER BY created_at DESC, l.id LIMIT ? OFFSET ?`, ...binds, limit, offset), total: one(ctx.db, `SELECT count(*) AS n FROM leave_requests l ${where}`, ...binds)!.n, page, limit };
  });
  api.route({ method: 'post', path: '/leaves/:id/review', tag: 'Leave', summary: 'Approve eligible leave and atomically cancel booked meals and extras', roles: management,
    body: z.object({ decision: z.enum(['APPROVED','REJECTED']), note: text(1000) }).strict()
  }, ({ req, body, params }) => transaction(ctx.db, () => {
    const leave = find(ctx, 'leave_requests', params.id!);
    ensure(leave.status === 'PENDING', 409, 'LEAVE_ALREADY_REVIEWED', 'Only pending leave can be reviewed');
    let cancelledBookings = 0;
    let avoidedChargesPaise = 0;
    if (body.decision === 'APPROVED') {
      ensure(leave.starts_on > today(ctx), 409, 'LEAVE_ALREADY_STARTED', 'Leave must be approved before its start date');
      const bookings = all(ctx.db, "SELECT b.*, m.cutoff_at FROM bookings b JOIN meal_services m ON b.meal_id=m.id WHERE b.user_id=? AND m.service_date BETWEEN ? AND ? AND b.status!='CANCELLED'", leave.user_id, leave.starts_on, leave.ends_on);
      ensure(bookings.every(booking => booking.status === 'CONFIRMED' && booking.cutoff_at > iso(ctx)), 409, 'LEAVE_CUTOFF_PASSED', 'A booked meal has passed its cancellation cutoff; reject the request instead');
      for (const booking of bookings) {
        avoidedChargesPaise += booking.price_paise + one(ctx.db, "SELECT COALESCE(sum(quantity*unit_price_paise),0) AS n FROM extra_orders WHERE booking_id=? AND status='CONFIRMED'", booking.id)!.n;
        cancelBooking(ctx, booking, `Approved leave ${leave.id}`);
        cancelledBookings++;
      }
    }
    run(ctx.db, 'UPDATE leave_requests SET status=?, reviewed_by=?, review_note=?, reviewed_at=? WHERE id=?', body.decision, actor(req).id, body.note, iso(ctx), leave.id);
    audit(ctx.db, actor(req).id, `LEAVE_${body.decision}`, 'LEAVE', leave.id, { cancelledBookings, avoidedChargesPaise, note: body.note }, iso(ctx));
    return { ...find(ctx, 'leave_requests', leave.id), cancelledBookings, avoidedChargesPaise };
  }));
  api.route({ method: 'post', path: '/leaves/:id/withdraw', tag: 'Leave', summary: 'Withdraw your pending or future approved leave; meals must be rebooked explicitly', roles: ['STUDENT'] }, ({ req, params }) => transaction(ctx.db, () => {
    const leave = find(ctx, 'leave_requests', params.id!);
    ensure(leave.user_id === actor(req).id, 403, 'FORBIDDEN', 'You can only withdraw your own leave');
    ensure(['PENDING','APPROVED'].includes(leave.status) && leave.starts_on > today(ctx), 409, 'CANNOT_WITHDRAW_LEAVE', 'Only pending or approved leave that has not started can be withdrawn');
    run(ctx.db, "UPDATE leave_requests SET status='WITHDRAWN' WHERE id=?", leave.id);
    audit(ctx.db, actor(req).id, 'LEAVE_WITHDRAWN', 'LEAVE', leave.id, {}, iso(ctx));
    return find(ctx, 'leave_requests', leave.id);
  }));
}
