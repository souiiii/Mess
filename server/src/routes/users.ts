import { z } from 'zod';
import type { Api } from '../api.js';
import { management } from '../api.js';
import { all, audit, id, one, run, transaction } from '../db.js';
import { actor, dateSchema, ensure, find, iso, pageSchema, pagination, publicUser, settings, text, today } from '../lib.js';
import { hashPassword, passwordSchema } from '../auth.js';

export const userCreateSchema = z.object({
  name: text(100), email: z.email().max(254).transform(value => value.toLowerCase()), password: passwordSchema,
  role: z.enum(['STUDENT', 'STAFF', 'MANAGER', 'ADMIN']), rollNumber: text(30).optional(),
  hostel: text(50).optional(), room: text(20).optional(), joinedOn: dateSchema.optional()
}).strict().refine(value => value.role !== 'STUDENT' || value.rollNumber, { message: 'Students require a roll number', path: ['rollNumber'] });
export function userRoutes(api: Api) {
  const ctx = api.ctx;
  api.route({ method: 'post', path: '/users', tag: 'Users', summary: 'Provision a student or staff account with a temporary password', roles: ['ADMIN'], body: userCreateSchema, status: 201 }, async ({ req, body }) => {
    const hash = await hashPassword(body.password);
    return transaction(ctx.db, () => {
      const userId = id();
      run(ctx.db, `INSERT INTO users (id,name,email,password_hash,role,roll_number,hostel,room,joined_on,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, userId, body.name, body.email, hash, body.role, body.rollNumber ?? null, body.hostel ?? null, body.room ?? null, body.joinedOn ?? today(ctx), iso(ctx));
      audit(ctx.db, actor(req).id, 'USER_CREATED', 'USER', userId, { role: body.role }, iso(ctx));
      return publicUser(find(ctx, 'users', userId));
    });
  });
  api.route({ method: 'get', path: '/users', tag: 'Users', summary: 'Search the resident and staff directory', roles: management,
    query: pageSchema.extend({ search: z.string().max(100).default(''), role: z.enum(['STUDENT', 'STAFF', 'MANAGER', 'ADMIN']).optional(), active: z.enum(['true', 'false']).optional() })
  }, ({ query }) => {
    const { page, limit, offset } = pagination(query);
    const where = "WHERE (name LIKE ? ESCAPE '\' OR email LIKE ? ESCAPE '\' OR roll_number LIKE ? ESCAPE '\') AND (? IS NULL OR role = ?) AND (? IS NULL OR active = ?)";
    const search = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const active = query.active === undefined ? null : query.active === 'true' ? 1 : 0;
    const binds = [search, search, search, query.role ?? null, query.role ?? null, active, active];
    return { items: all(ctx.db, `SELECT * FROM users ${where} ORDER BY name, id LIMIT ? OFFSET ?`, ...binds, limit, offset).map(publicUser), total: one(ctx.db, `SELECT count(*) AS n FROM users ${where}`, ...binds)!.n, page, limit };
  });
  api.route({ method: 'patch', path: '/users/me', tag: 'Users', summary: 'Update your room and dietary information',
    body: z.object({ name: text(100), hostel: text(50).nullable(), room: text(20).nullable(), dietaryPreference: z.enum(['VEG','NON_VEG','VEGAN']), allergies: z.array(text(50)).max(20) }).strict()
  }, ({ req, body }) => transaction(ctx.db, () => {
    run(ctx.db, 'UPDATE users SET name = ?, hostel = ?, room = ?, dietary_preference = ?, allergies = ? WHERE id = ?', body.name, body.hostel, body.room, body.dietaryPreference, JSON.stringify(body.allergies), actor(req).id);
    audit(ctx.db, actor(req).id, 'PROFILE_UPDATED', 'USER', actor(req).id, {}, iso(ctx));
    return publicUser(find(ctx, 'users', actor(req).id));
  }));
  api.route({ method: 'patch', path: '/users/:id/access', tag: 'Users', summary: 'Change role or suspend access; revoke existing sessions', roles: ['ADMIN'],
    body: z.object({ active: z.boolean(), role: z.enum(['STUDENT','STAFF','MANAGER','ADMIN']) }).strict()
  }, ({ req, body, params }) => transaction(ctx.db, () => {
    const user = find(ctx, 'users', params.id!);
    ensure(params.id !== actor(req).id, 400, 'SELF_ACCESS_CHANGE', 'Ask another administrator to change your own access');
    ensure(body.role !== 'STUDENT' || user.roll_number, 400, 'ROLL_REQUIRED', 'A student must have a roll number');
    if (user.role === 'ADMIN' && (!body.active || body.role !== 'ADMIN')) ensure(one(ctx.db, "SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND active = 1")!.n > 1, 409, 'LAST_ADMIN', 'Keep at least one active administrator');
    const booked = one(ctx.db, `SELECT count(*) AS n FROM bookings b JOIN meal_services m ON b.meal_id = m.id WHERE b.user_id = ? AND b.status = 'CONFIRMED' AND m.ends_at > ?`, user.id, iso(ctx))!.n;
    ensure((body.active && body.role === 'STUDENT') || booked === 0, 409, 'ACTIVE_BOOKINGS', 'Cancel upcoming bookings before suspending or changing this student role');
    run(ctx.db, 'UPDATE users SET active = ?, role = ? WHERE id = ?', Number(body.active), body.role, user.id);
    run(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', user.id);
    audit(ctx.db, actor(req).id, 'ACCESS_CHANGED', 'USER', user.id, body, iso(ctx));
    return publicUser(find(ctx, 'users', user.id));
  }));
  api.route({ method: 'post', path: '/users/:id/reset-password', tag: 'Users', summary: 'Set a temporary password and revoke all sessions', roles: ['ADMIN'], body: z.object({ temporaryPassword: passwordSchema }).strict() }, async ({ req, body, params }) => {
    find(ctx, 'users', params.id!);
    ensure(params.id !== actor(req).id, 400, 'USE_PASSWORD_CHANGE', 'Use the password change endpoint for your own password');
    const hash = await hashPassword(body.temporaryPassword);
    return transaction(ctx.db, () => {
      run(ctx.db, 'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', hash, params.id!);
      run(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', params.id!);
      audit(ctx.db, actor(req).id, 'PASSWORD_RESET', 'USER', params.id!, {}, iso(ctx));
      return { reset: true };
    });
  });
  api.route({ method: 'get', path: '/settings', tag: 'Settings', summary: 'Read mess policy settings' }, () => settings(ctx));
  api.route({ method: 'patch', path: '/settings', tag: 'Settings', summary: 'Configure booking horizon, minimum leave and feedback window', roles: ['ADMIN'], body: z.object({ bookingHorizonDays: z.number().int().min(1).max(60), minimumLeaveDays: z.number().int().min(1).max(30), feedbackWindowDays: z.number().int().min(1).max(30) }).strict() }, ({ req, body }) => transaction(ctx.db, () => {
    run(ctx.db, 'UPDATE settings SET booking_horizon_days = ?, minimum_leave_days = ?, feedback_window_days = ?, updated_at = ? WHERE id = 1', body.bookingHorizonDays, body.minimumLeaveDays, body.feedbackWindowDays, iso(ctx));
    audit(ctx.db, actor(req).id, 'SETTINGS_CHANGED', 'SETTINGS', '1', body, iso(ctx));
    return settings(ctx);
  }));
  api.route({ method: 'get', path: '/audit', tag: 'Audit', summary: 'Read the append-only audit trail', roles: ['ADMIN'], query: pageSchema.extend({ action: text(60).optional() }) }, ({ query }) => {
    const { page, limit, offset } = pagination(query);
    return { items: all(ctx.db, 'SELECT a.*, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON a.actor_id = u.id WHERE (? IS NULL OR action = ?) ORDER BY created_at DESC, a.id LIMIT ? OFFSET ?', query.action ?? null, query.action ?? null, limit, offset).map(row => ({ ...row, details: JSON.parse(row.details) })), total: one(ctx.db, 'SELECT count(*) AS n FROM audit_logs WHERE (? IS NULL OR action = ?)', query.action ?? null, query.action ?? null)!.n, page, limit };
  });
}
