import type { Context, Row } from '../types.js';
import { all, audit, id, one, run } from '../db.js';
import { addDays, ensure, find, iso, settings, today } from '../lib.js';

export function cancelBooking(ctx: Context, booking: Row, reason: string) {
  run(ctx.db, "UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ? WHERE id = ? AND status = 'CONFIRMED'", iso(ctx), reason, booking.id);
  run(ctx.db, "UPDATE extra_orders SET status = 'CANCELLED' WHERE booking_id = ? AND status = 'CONFIRMED'", booking.id);
  run(ctx.db, 'DELETE FROM meal_passes WHERE booking_id = ?', booking.id);
}
export function bookMeal(ctx: Context, userId: string, mealId: string) {
  const meal = find(ctx, 'meal_services', mealId);
  const user = find(ctx, 'users', userId);
  ensure(user.active && user.role === 'STUDENT', 400, 'NOT_A_RESIDENT', 'Only active students can book meals');
  ensure(meal.status === 'PUBLISHED', 409, 'MEAL_UNAVAILABLE', 'This meal is not available for booking');
  ensure(iso(ctx) < meal.cutoff_at, 409, 'CUTOFF_PASSED', 'The booking and cancellation cutoff has passed');
  ensure(meal.service_date >= user.joined_on, 400, 'BEFORE_ENROLMENT', 'Cannot book before your enrolment date');
  ensure(meal.service_date <= addDays(today(ctx), settings(ctx).booking_horizon_days), 400, 'OUTSIDE_BOOKING_HORIZON', 'This meal is outside the booking horizon');
  ensure(!one(ctx.db, "SELECT id FROM leave_requests WHERE user_id = ? AND status IN ('PENDING','APPROVED') AND starts_on <= ? AND ends_on >= ?", userId, meal.service_date, meal.service_date), 409, 'ON_LEAVE', 'Withdraw your leave request before booking a meal during leave');
  const existing = one(ctx.db, 'SELECT * FROM bookings WHERE user_id = ? AND meal_id = ?', userId, mealId);
  if (existing?.status === 'CONFIRMED') return existing;
  ensure(!existing || existing.status === 'CANCELLED', 409, 'ALREADY_ATTENDED', 'This meal has already been attended');
  const count = one(ctx.db, "SELECT count(*) AS n FROM bookings WHERE meal_id = ? AND status != 'CANCELLED'", mealId)!.n;
  ensure(count < meal.capacity, 409, 'MEAL_FULL', 'This meal has reached its capacity');
  const bookingId = existing?.id ?? id();
  if (existing) run(ctx.db, "UPDATE bookings SET status = 'CONFIRMED', price_paise = ?, created_at = ?, cancelled_at = NULL, cancellation_reason = NULL WHERE id = ?", meal.price_paise, iso(ctx), bookingId);
  else run(ctx.db, "INSERT INTO bookings (id,user_id,meal_id,status,price_paise,created_at) VALUES (?,?,?,'CONFIRMED',?,?)", bookingId, userId, mealId, meal.price_paise, iso(ctx));
  audit(ctx.db, userId, 'MEAL_BOOKED', 'BOOKING', bookingId, { mealId, pricePaise: meal.price_paise }, iso(ctx));
  return find(ctx, 'bookings', bookingId);
}
export function bookingDetails(ctx: Context, booking: Row) {
  return { ...booking, meal: find(ctx, 'meal_services', booking.meal_id), extras: all(ctx.db, 'SELECT o.*, e.name FROM extra_orders o JOIN extras e ON o.extra_id = e.id WHERE booking_id = ?', booking.id) };
}
