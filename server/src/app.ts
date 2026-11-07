import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import type { Context } from './types.js';
import { Api } from './api.js';
import { ApiError, ensure, iso } from './lib.js';
import { one } from './db.js';
import { authRoutes, sessionMiddleware } from './auth.js';
import { userRoutes } from './routes/users.js';
import { mealRoutes } from './routes/meals.js';
import { leaveRoutes } from './routes/leaves.js';
import { billingRoutes } from './routes/billing.js';
import { communityRoutes } from './routes/community.js';
import { inventoryRoutes } from './routes/inventory.js';
import { reportRoutes } from './routes/reports.js';

export function createApp(ctx: Context) {
  const app = express();
  const logger = pino({ level: ctx.config.logLevel });
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.config.trustProxy);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-ID', req.requestId);
    next();
  });
  app.use(pinoHttp({ logger, serializers: { req: req => ({ id: req.raw.requestId, method: req.method, path: String(req.url).split('?')[0] }), res: res => ({ statusCode: res.statusCode }), err: err => ({ type: err.type, message: 'Request failed' }) } }));
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'connect-src': ["'self'"], 'img-src': ["'self'", 'data:'] } }, strictTransportSecurity: ctx.config.production ? undefined : false }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const rateError = (req: express.Request, res: express.Response) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests; try again later', requestId: req.requestId } });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, handler: rateError }));
  app.use('/api/v1/auth/login', rateLimit({ windowMs: 15 * 60000, limit: 20, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false, handler: rateError }));
  app.use('/api/v1/auth/password', rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, handler: rateError }));
  app.use('/api', (req, _res, next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      ensure(!origin || origin === ctx.config.appOrigin, 403, 'INVALID_ORIGIN', 'This origin is not allowed');
      ensure(req.get('sec-fetch-site') !== 'cross-site', 403, 'CROSS_SITE_REQUEST', 'Cross-site mutations are not allowed');
    }
    next();
  });
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use(cookieParser());
  app.use(sessionMiddleware(ctx));
  const api = new Api(ctx);
  authRoutes(api);
  userRoutes(api);
  mealRoutes(api);
  leaveRoutes(api);
  billingRoutes(api);
  communityRoutes(api);
  inventoryRoutes(api);
  reportRoutes(api);
  app.get('/api/health', (_req, res) => {
    one(ctx.db, 'SELECT 1');
    res.json({ data: { status: 'ok', service: 'iiit-mess-api', timestamp: iso(ctx) } });
  });
  const spec = api.document();
  app.get('/api/openapi.json', (_req, res) => res.json(spec));
  app.use('/api/v1', api.router);
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'ENDPOINT_NOT_FOUND', 'API endpoint not found')));
  const index = join(ctx.config.staticDir, 'index.html');
  if (ctx.config.production) {
    ensure(existsSync(index), 500, 'BUILD_REQUIRED', 'React build missing. Run npm run build before npm start in production');
    app.use('/assets', express.static(join(ctx.config.staticDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false, dotfiles: 'deny' }));
    app.use(express.static(ctx.config.staticDir, { index: false, maxAge: 0, dotfiles: 'deny' }));
    app.get('/{*path}', (req, res, next) => {
      if (!req.accepts('html') || /\.[a-zA-Z0-9]+$/.test(req.path)) return next();
      res.set('Cache-Control', 'no-cache').sendFile(index);
    });
  }
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Resource not found')));
  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (error instanceof ZodError) return res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Check the submitted fields', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })), requestId: req.requestId } });
    if (error instanceof ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}), requestId: req.requestId } });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId: req.requestId } });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 64 KB', requestId: req.requestId } });
    if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with these unique values already exists', requestId: req.requestId } });
    if (error.code === 'ERR_SQLITE_ERROR' && /database is locked|database is busy/.test(error.message)) return res.status(503).set('Retry-After', '1').json({ error: { code: 'DATABASE_BUSY', message: 'Please retry in a moment', requestId: req.requestId } });
    if (error.status === 404) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: req.requestId } });
    logger.error({ requestId: req.requestId, errorType: error.name, code: error.code }, 'Unhandled request error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: req.requestId } });
  };
  app.use(errorHandler);
  return app;
}
