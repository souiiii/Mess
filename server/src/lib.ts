import { z } from 'zod';
import type { Request } from 'express';
import type { Context, Row, User } from './types.js';
import { one } from './db.js';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export function ensure(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const timestampSchema = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const uuidSchema = z.uuid();
export const text = (max = 1000) => z.string().trim().min(1).max(max);
export const money = z.number().int().min(0).max(100_000_000);
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
export function pagination(query: unknown) {
  const { page, limit } = pageSchema.parse(query);
  return { page, limit, offset: (page - 1) * limit };
}
export const iso = (ctx: Context) => ctx.now().toISOString();
export function localDate(date: Date): string {
  return new Date(date.valueOf() + 330 * 60_000).toISOString().slice(0, 10);
}
export const today = (ctx: Context) => localDate(ctx.now());
export function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).valueOf() + days * 86400000).toISOString().slice(0, 10);
}
export function dayCount(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}
export function monthRange(month: string) {
  const start = `${month}-01`;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: next.toISOString().slice(0, 10) };
}
export const actor = (req: Request) => req.user as User;
export function find(ctx: Context, table: string, value: string): Row {
  const row = one(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, value);
  ensure(row, 404, 'NOT_FOUND', 'Record not found');
  return row;
}
export function owned(req: Request, userId: string, allowStaff = false) {
  ensure(actor(req).id === userId || ['ADMIN', 'MANAGER', ...(allowStaff ? ['STAFF'] : [])].includes(actor(req).role), 403, 'FORBIDDEN', 'You cannot access this record');
}
export function publicUser(row: Row | User) {
  const { password_hash, ...safe } = row as Row;
  return { ...safe, allergies: JSON.parse(safe.allergies), active: Boolean(safe.active), must_change_password: Boolean(safe.must_change_password) };
}
export const settings = (ctx: Context) => one(ctx.db, 'SELECT * FROM settings WHERE id = 1')!;
export function dateRange(query: unknown, ctx: Context, maxDays = 93) {
  const range = z.object({ from: dateSchema.default(today(ctx)), to: dateSchema.default(addDays(today(ctx), 7)) }).parse(query);
  ensure(range.from <= range.to && dayCount(range.from, range.to) <= maxDays, 400, 'INVALID_DATE_RANGE', `Choose an ordered date range of at most ${maxDays} days`);
  return range;
}
