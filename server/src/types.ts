import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export type Role = 'STUDENT' | 'STAFF' | 'MANAGER' | 'ADMIN';
export type Row = Record<string, any>;
export type Bind = SQLInputValue;
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  roll_number: string | null;
  hostel: string | null;
  room: string | null;
  dietary_preference: string;
  allergies: string;
  joined_on: string;
  active: number;
  must_change_password: number;
  created_at: string;
}
export interface Context {
  db: DatabaseSync;
  now: () => Date;
  config: Config;
}
export interface Config {
  production: boolean;
  port: number;
  databasePath: string;
  appOrigin: string;
  trustProxy: number;
  logLevel: string;
  staticDir: string;
  paymentsMode: 'FAKE' | 'MANUAL';
}
declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: { token_hash: string; csrf: string };
      requestId: string;
    }
  }
}
