import 'dotenv/config';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from './types.js';

export function loadConfig(): Config {
  const env = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_PATH: z.string().min(1).default('./data/mess.sqlite'),
    APP_ORIGIN: z.url().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info')
  }).parse(process.env);
  const origin = new URL(env.APP_ORIGIN);
  if (origin.origin !== env.APP_ORIGIN) throw new Error('APP_ORIGIN must be an origin without a trailing slash or path');
  if (env.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS');
  return {
    production: env.NODE_ENV === 'production', port: env.PORT, databasePath: env.DATABASE_PATH,
    appOrigin: env.APP_ORIGIN, trustProxy: env.TRUST_PROXY, logLevel: env.LOG_LEVEL,
    staticDir: resolve('dist/client')
  };
}
