import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { RequestHandler, Response } from 'express';
import type { Context, User } from './types.js';
import type { Api } from './api.js';
import { one, run, audit, transaction } from './db.js';
import { actor, ensure, iso, publicUser } from './lib.js';

const scrypt = promisify(scryptCallback);
const cookieName = 'mess_session';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const passwordSchema = z.string().min(12).max(128).regex(/[a-z]/, 'Include a lowercase letter').regex(/[A-Z]/, 'Include an uppercase letter').regex(/\d/, 'Include a number');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, expected] = hash.split(':');
  if (!salt || !expected) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  const stored = Buffer.from(expected, 'hex');
  return key.length === stored.length && timingSafeEqual(key, stored);
}
export function sessionMiddleware(ctx: Context): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[cookieName];
    if (typeof token === 'string' && token.length <= 128) {
      const session = one(ctx.db, 'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', digest(token), iso(ctx));
      if (session) {
        const user = one<User>(ctx.db, 'SELECT * FROM users WHERE id = ? AND active = 1', session.user_id);
        if (user) { req.user = user; req.session = { token_hash: session.token_hash, csrf: session.csrf }; }
      }
    }
    next();
  };
}
function clearCookie(ctx: Context, res: Response) {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: ctx.config.production, path: '/' });
}
export function authRoutes(api: Api) {
  const ctx = api.ctx;
  let dummyHash: Promise<string> | undefined;
  api.route({ method: 'post', path: '/auth/login', tag: 'Authentication', summary: 'Sign in and receive a session cookie and CSRF token', public: true,
    body: z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(128) }).strict()
  }, async ({ body, req, res }) => {
    const user = one(ctx.db, 'SELECT * FROM users WHERE email = ?', body.email);
    dummyHash ??= hashPassword(secret());
    const valid = await verifyPassword(body.password, user?.password_hash ?? await dummyHash);
    ensure(user && valid && user.active, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    const token = secret();
    const csrf = secret();
    const expires = new Date(ctx.now().valueOf() + 12 * 3600000).toISOString();
    const currentUser = transaction(ctx.db, () => {
      const current = one(ctx.db, 'SELECT * FROM users WHERE id=?', user.id);
      ensure(current && current.active && current.password_hash === user.password_hash, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      run(ctx.db, 'DELETE FROM sessions WHERE expires_at <= ?', iso(ctx));
      if (req.session) run(ctx.db, 'DELETE FROM sessions WHERE token_hash = ?', req.session.token_hash);
      run(ctx.db, 'INSERT INTO sessions VALUES (?, ?, ?, ?, ?)', digest(token), user.id, csrf, expires, iso(ctx));
      audit(ctx.db, user.id, 'LOGIN', 'USER', user.id, {}, iso(ctx));
      return current;
    });
    res.cookie(cookieName, token, { httpOnly: true, secure: ctx.config.production, sameSite: 'strict', path: '/', maxAge: 12 * 3600000 });
    return { user: publicUser(currentUser), csrfToken: csrf, expiresAt: expires };
  });
  api.route({ method: 'get', path: '/auth/me', tag: 'Authentication', summary: 'Current user and CSRF token', allowPasswordChange: true }, ({ req }) => ({ user: publicUser(actor(req)), csrfToken: req.session!.csrf }));
  api.route({ method: 'post', path: '/auth/logout', tag: 'Authentication', summary: 'Revoke the current session', allowPasswordChange: true }, ({ req, res }) => {
    run(ctx.db, 'DELETE FROM sessions WHERE token_hash = ?', req.session!.token_hash);
    clearCookie(ctx, res);
    return { signedOut: true };
  });
  api.route({ method: 'post', path: '/auth/password', tag: 'Authentication', summary: 'Change password and revoke every session', allowPasswordChange: true,
    body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict()
  }, async ({ req, body, res }) => {
    const user = one(ctx.db, 'SELECT * FROM users WHERE id = ?', actor(req).id)!;
    ensure(await verifyPassword(body.currentPassword, user.password_hash), 400, 'INCORRECT_PASSWORD', 'Current password is incorrect');
    ensure(body.currentPassword !== body.newPassword, 400, 'SAME_PASSWORD', 'Choose a different password');
    const hash = await hashPassword(body.newPassword);
    transaction(ctx.db, () => {
      ensure(one(ctx.db, 'SELECT password_hash FROM users WHERE id=?', user.id)!.password_hash === user.password_hash, 409, 'PASSWORD_CHANGED_RETRY', 'Your password changed during this request; sign in again');
      run(ctx.db, 'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hash, user.id);
      run(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', user.id);
      audit(ctx.db, user.id, 'PASSWORD_CHANGED', 'USER', user.id, {}, iso(ctx));
    });
    clearCookie(ctx, res);
    return { signInRequired: true };
  });
}
