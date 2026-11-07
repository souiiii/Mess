import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { Context, Role } from './types.js';
import { actor, ensure, uuidSchema } from './lib.js';
import { responseContract } from './contracts.js';

extendZodWithOpenApi(z);
type Method = 'get' | 'post' | 'patch' | 'delete';
interface RouteOptions<B extends z.ZodType, Q extends z.ZodType> {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  roles?: Role[];
  public?: boolean;
  allowPasswordChange?: boolean;
  body?: B;
  query?: Q;
  status?: number;
}
export class Api {
  router = Router();
  registry = new OpenAPIRegistry();
  constructor(public ctx: Context) {
    this.registry.registerComponent('securitySchemes', 'sessionCookie', { type: 'apiKey', in: 'cookie', name: 'mess_session' });
    this.registry.registerComponent('securitySchemes', 'csrfHeader', { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' });
  }
  route<B extends z.ZodType = z.ZodUnknown, Q extends z.ZodType = z.ZodUnknown>(
    options: RouteOptions<B, Q>,
    handler: (input: { req: Request; res: Response; body: z.infer<B>; query: z.infer<Q>; params: Record<string, string> }) => unknown | Promise<unknown>
  ) {
    const names = [...options.path.matchAll(/:([a-zA-Z]+)/g)].map(match => match[1]!);
    const paramsSchema = names.length ? z.object(Object.fromEntries(names.map(name => [name, uuidSchema]))) : undefined;
    const status = options.status ?? 200;
    const csvResponse = options.path === '/reports/billing/export';
    const responseSchema = csvResponse ? undefined : responseContract(options.method, options.path);
    const error = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string() }) });
    this.registry.registerPath({
      method: options.method, path: `/api/v1${options.path.replace(/:([a-zA-Z]+)/g, '{$1}')}`,
      tags: [options.tag], summary: options.summary,
      description: [options.description, options.roles ? `Roles: ${options.roles.join(', ')}.` : options.public ? 'No authentication required.' : 'Any authenticated role.'].filter(Boolean).join(' '),
      security: options.public ? [] : options.method === 'get' ? [{ sessionCookie: [] }] : [{ sessionCookie: [], csrfHeader: [] }],
      request: {
        ...(paramsSchema ? { params: paramsSchema } : {}),
        ...(options.query ? { query: options.query as unknown as z.ZodObject } : {}),
        ...(options.body ? { body: { required: true, content: { 'application/json': { schema: options.body } } } } : {})
      },
      responses: {
        [status]: { description: csvResponse ? 'Spreadsheet-safe CSV ledger' : 'Successful result in the data envelope', content: csvResponse ? { 'text/csv': { schema: z.string() } } : { 'application/json': { schema: z.object({ data: responseSchema! }) } } },
        ...Object.fromEntries([400, 401, 403, 404, 409, 422, 429].map(code => [code, { description: ({ 400: 'Business rule or malformed request', 401: 'Authentication required', 403: 'Insufficient permission or invalid CSRF token', 404: 'Record not found', 409: 'State or uniqueness conflict', 422: 'Validation failed', 429: 'Rate limit exceeded' } as Record<number, string>)[code]!, content: { 'application/json': { schema: error } } }]))
      }
    });
    this.router[options.method](options.path, async (req, res) => {
      if (!options.public) {
        ensure(req.user, 401, 'UNAUTHENTICATED', 'Sign in to continue');
        if (!options.allowPasswordChange) ensure(!actor(req).must_change_password, 403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before continuing');
        if (options.roles) ensure(options.roles.includes(actor(req).role), 403, 'FORBIDDEN', 'Your role cannot perform this action');
        if (options.method !== 'get') ensure(req.get('x-csrf-token') === req.session?.csrf, 403, 'INVALID_CSRF', 'A valid CSRF token is required');
      }
      const body = options.body ? options.body.parse(req.body) : undefined;
      const query = options.query ? options.query.parse(req.query) : req.query;
      const params = paramsSchema ? paramsSchema.parse(req.params) : {};
      const result = await handler({ req, res, body: body as z.infer<B>, query: query as z.infer<Q>, params });
      if (!res.headersSent) res.status(status).json({ data: result });
    });
  }
  document() {
    return new OpenApiGeneratorV31(this.registry.definitions).generateDocument({
      openapi: '3.1.0', info: { title: 'IIIT Bhubaneswar Mess API', version: '1.0.0', description: 'Cookie sessions with CSRF protection. Monetary amounts are integer INR paise. Calendar dates use Asia/Kolkata; timestamps use UTC ISO 8601. See docs/API.md for response shapes and workflows.' },
      servers: [{ url: '/' }]
    });
  }
}
export const management: Role[] = ['MANAGER', 'ADMIN'];
export const operations: Role[] = ['STAFF', 'MANAGER', 'ADMIN'];
