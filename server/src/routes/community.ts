import { z } from 'zod';
import type { Api } from '../api.js';
import { management, operations } from '../api.js';
import { all, audit, id, one, run, transaction } from '../db.js';
import { actor, ensure, find, iso, owned, pageSchema, pagination, settings, text, timestampSchema, uuidSchema } from '../lib.js';

export function communityRoutes(api: Api) {
  const ctx = api.ctx;
  api.route({ method: 'post', path: '/feedback', tag: 'Feedback', summary: 'Rate a meal you actually attended', roles: ['STUDENT'], status: 201,
    body: z.object({ bookingId: uuidSchema, taste: z.number().int().min(1).max(5), hygiene: z.number().int().min(1).max(5), portion: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).default('') }).strict()
  }, ({ req, body }) => transaction(ctx.db, () => {
    const booking = find(ctx, 'bookings', body.bookingId);
    ensure(booking.user_id === actor(req).id, 403, 'FORBIDDEN', 'You can only rate your own meal');
    ensure(booking.status === 'ATTENDED', 409, 'ATTENDANCE_REQUIRED', 'Attend a meal before leaving feedback');
    const meal = find(ctx, 'meal_services', booking.meal_id);
    ensure(ctx.now().valueOf() <= Date.parse(meal.ends_at) + settings(ctx).feedback_window_days * 86400000, 409, 'FEEDBACK_WINDOW_CLOSED', 'The feedback window for this meal has closed');
    const feedbackId = id();
    run(ctx.db, 'INSERT INTO feedback VALUES (?,?,?,?,?,?,?)', feedbackId, booking.id, body.taste, body.hygiene, body.portion, body.comment, iso(ctx));
    audit(ctx.db, actor(req).id, 'FEEDBACK_SUBMITTED', 'FEEDBACK', feedbackId, {}, iso(ctx));
    return find(ctx, 'feedback', feedbackId);
  }));
  api.route({ method: 'get', path: '/feedback', tag: 'Feedback', summary: 'Read your feedback, or management meal ratings', query: pageSchema.extend({ mealId: uuidSchema.optional() }) }, ({ req, query }) => {
    const { page, limit, offset } = pagination(query);
    const userId = management.includes(actor(req).role) ? null : actor(req).id;
    const where = 'WHERE (? IS NULL OR b.user_id=?) AND (? IS NULL OR b.meal_id=?)';
    const binds = [userId, userId, query.mealId ?? null, query.mealId ?? null];
    return { items: all(ctx.db, `SELECT f.*, m.service_date, m.meal_type, m.title FROM feedback f JOIN bookings b ON f.booking_id=b.id JOIN meal_services m ON b.meal_id=m.id ${where} ORDER BY f.created_at DESC, f.id LIMIT ? OFFSET ?`, ...binds, limit, offset), total: one(ctx.db, `SELECT count(*) AS n FROM feedback f JOIN bookings b ON f.booking_id=b.id ${where}`, ...binds)!.n, page, limit };
  });
  api.route({ method: 'post', path: '/complaints', tag: 'Complaints', summary: 'Raise a private complaint or billing query', status: 201,
    body: z.object({ category: z.enum(['FOOD','HYGIENE','SERVICE','BILLING','OTHER']), subject: text(150), description: text(5000) }).strict()
  }, ({ req, body }) => transaction(ctx.db, () => {
    const complaintId = id();
    run(ctx.db, "INSERT INTO complaints VALUES (?,?,?,?,?,'OPEN',NULL,?,?)", complaintId, actor(req).id, body.category, body.subject, body.description, iso(ctx), iso(ctx));
    audit(ctx.db, actor(req).id, 'COMPLAINT_CREATED', 'COMPLAINT', complaintId, { category: body.category }, iso(ctx));
    return find(ctx, 'complaints', complaintId);
  }));
  api.route({ method: 'get', path: '/complaints', tag: 'Complaints', summary: 'Your private complaints, or staff resolution queue', query: pageSchema.extend({ status: z.enum(['OPEN','IN_PROGRESS','RESOLVED']).optional(), category: z.enum(['FOOD','HYGIENE','SERVICE','BILLING','OTHER']).optional() }) }, ({ req, query }) => {
    const { page, limit, offset } = pagination(query);
    const userId = actor(req).role === 'STUDENT' ? actor(req).id : null;
    const restrictBilling = actor(req).role === 'STAFF' ? 1 : 0;
    const where = "WHERE (? IS NULL OR user_id=?) AND (? IS NULL OR status=?) AND (? IS NULL OR category=?) AND (?=0 OR category!='BILLING')";
    const binds = [userId, userId, query.status ?? null, query.status ?? null, query.category ?? null, query.category ?? null, restrictBilling];
    return { items: all(ctx.db, `SELECT * FROM complaints ${where} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`, ...binds, limit, offset), total: one(ctx.db, `SELECT count(*) AS n FROM complaints ${where}`, ...binds)!.n, page, limit };
  });
  const checkAccess = (req: Parameters<typeof actor>[0], complaint: Record<string, any>) => {
    owned(req, complaint.user_id, true);
    ensure(actor(req).role !== 'STAFF' || complaint.category !== 'BILLING' || complaint.user_id === actor(req).id, 403, 'FORBIDDEN', 'Billing complaints require management access');
  };
  api.route({ method: 'get', path: '/complaints/:id', tag: 'Complaints', summary: 'Read a complaint and its conversation' }, ({ req, params }) => {
    const complaint = find(ctx, 'complaints', params.id!);
    checkAccess(req, complaint);
    return { ...complaint, replies: all(ctx.db, 'SELECT r.*, u.name AS author_name, u.role AS author_role FROM complaint_replies r JOIN users u ON r.author_id=u.id WHERE complaint_id=? ORDER BY r.created_at, r.id', complaint.id) };
  });
  api.route({ method: 'post', path: '/complaints/:id/replies', tag: 'Complaints', summary: 'Reply to a complaint', status: 201, body: z.object({ message: text(5000) }).strict() }, ({ req, params, body }) => transaction(ctx.db, () => {
    const complaint = find(ctx, 'complaints', params.id!);
    checkAccess(req, complaint);
    ensure(complaint.status !== 'RESOLVED', 409, 'COMPLAINT_RESOLVED', 'Reopen the complaint before adding another reply');
    const replyId = id();
    run(ctx.db, 'INSERT INTO complaint_replies VALUES (?,?,?,?,?)', replyId, complaint.id, actor(req).id, body.message, iso(ctx));
    run(ctx.db, 'UPDATE complaints SET updated_at=? WHERE id=?', iso(ctx), complaint.id);
    audit(ctx.db, actor(req).id, 'COMPLAINT_REPLIED', 'COMPLAINT', complaint.id, {}, iso(ctx));
    return find(ctx, 'complaint_replies', replyId);
  }));
  api.route({ method: 'patch', path: '/complaints/:id/status', tag: 'Complaints', summary: 'Assign a complaint or advance its resolution status', roles: operations,
    body: z.object({ status: z.enum(['OPEN','IN_PROGRESS','RESOLVED']), assignedTo: uuidSchema.nullable(), note: text(2000) }).strict()
  }, ({ req, params, body }) => transaction(ctx.db, () => {
    const complaint = find(ctx, 'complaints', params.id!);
    checkAccess(req, complaint);
    const transitions: Record<string, string[]> = { OPEN: ['IN_PROGRESS','RESOLVED'], IN_PROGRESS: ['OPEN','RESOLVED'], RESOLVED: ['OPEN'] };
    ensure(body.status === complaint.status || transitions[complaint.status]!.includes(body.status), 409, 'INVALID_TRANSITION', 'This complaint status transition is not allowed');
    if (body.assignedTo) {
      const assignee = find(ctx, 'users', body.assignedTo);
      ensure(assignee.active && operations.includes(assignee.role), 400, 'INVALID_ASSIGNEE', 'Assign the complaint to an active staff member or manager');
      ensure(complaint.category !== 'BILLING' || management.includes(assignee.role), 400, 'INVALID_ASSIGNEE', 'Billing complaints must be assigned to management');
    }
    run(ctx.db, 'UPDATE complaints SET status=?, assigned_to=?, updated_at=? WHERE id=?', body.status, body.assignedTo, iso(ctx), complaint.id);
    run(ctx.db, 'INSERT INTO complaint_replies VALUES (?,?,?,?,?)', id(), complaint.id, actor(req).id, body.note, iso(ctx));
    audit(ctx.db, actor(req).id, 'COMPLAINT_STATUS_CHANGED', 'COMPLAINT', complaint.id, { status: body.status, assignedTo: body.assignedTo }, iso(ctx));
    return find(ctx, 'complaints', complaint.id);
  }));
  api.route({ method: 'post', path: '/complaints/:id/reopen', tag: 'Complaints', summary: 'Reopen your resolved complaint if the issue remains', body: z.object({ reason: text(2000) }).strict() }, ({ req, params, body }) => transaction(ctx.db, () => {
    const complaint = find(ctx, 'complaints', params.id!);
    ensure(complaint.user_id === actor(req).id, 403, 'FORBIDDEN', 'Only the complaint owner can use this action');
    ensure(complaint.status === 'RESOLVED', 409, 'COMPLAINT_NOT_RESOLVED', 'Only resolved complaints can be reopened');
    run(ctx.db, "UPDATE complaints SET status='OPEN', updated_at=? WHERE id=?", iso(ctx), complaint.id);
    run(ctx.db, 'INSERT INTO complaint_replies VALUES (?,?,?,?,?)', id(), complaint.id, actor(req).id, body.reason, iso(ctx));
    audit(ctx.db, actor(req).id, 'COMPLAINT_REOPENED', 'COMPLAINT', complaint.id, {}, iso(ctx));
    return find(ctx, 'complaints', complaint.id);
  }));
  api.route({ method: 'get', path: '/announcements', tag: 'Announcements', summary: 'Read current mess notices' }, () => all(ctx.db, "SELECT a.id, a.title, a.body, a.priority, a.expires_at, a.created_at, u.name AS author_name FROM announcements a JOIN users u ON a.created_by=u.id WHERE a.expires_at>? ORDER BY CASE a.priority WHEN 'IMPORTANT' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 100", iso(ctx)));
  api.route({ method: 'post', path: '/announcements', tag: 'Announcements', summary: 'Publish a mess notice', roles: management, status: 201,
    body: z.object({ title: text(150), body: text(5000), priority: z.enum(['NORMAL','IMPORTANT']), expiresAt: timestampSchema }).strict()
  }, ({ req, body }) => transaction(ctx.db, () => {
    ensure(body.expiresAt > iso(ctx), 400, 'INVALID_EXPIRY', 'The notice must expire in the future');
    const noticeId = id();
    run(ctx.db, 'INSERT INTO announcements VALUES (?,?,?,?,?,?,?)', noticeId, body.title, body.body, body.priority, body.expiresAt, actor(req).id, iso(ctx));
    audit(ctx.db, actor(req).id, 'ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT', noticeId, {}, iso(ctx));
    return find(ctx, 'announcements', noticeId);
  }));
  api.route({ method: 'delete', path: '/announcements/:id', tag: 'Announcements', summary: 'Withdraw a mess notice', roles: management }, ({ req, params }) => transaction(ctx.db, () => {
    find(ctx, 'announcements', params.id!);
    run(ctx.db, 'DELETE FROM announcements WHERE id=?', params.id!);
    audit(ctx.db, actor(req).id, 'ANNOUNCEMENT_WITHDRAWN', 'ANNOUNCEMENT', params.id!, {}, iso(ctx));
    return { withdrawn: true };
  }));
}
