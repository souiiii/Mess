import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrations } from './migrations.js';
import type { Bind, Row } from './types.js';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;');
  for (const migration of migrations) {
    transaction(db, () => {
      if (!one(db, 'SELECT version FROM schema_migrations WHERE version = ?', migration.version)) {
        db.exec(migration.sql);
        run(db, 'INSERT INTO settings (id, updated_at) VALUES (1, ?)', new Date().toISOString());
        run(db, 'INSERT INTO schema_migrations VALUES (?, ?)', migration.version, new Date().toISOString());
      }
    });
  }
  return db;
}
export const id = () => randomUUID();
export function one<T = Row>(db: DatabaseSync, sql: string, ...params: Bind[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function all<T = Row>(db: DatabaseSync, sql: string, ...params: Bind[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(db: DatabaseSync, sql: string, ...params: Bind[]) {
  return db.prepare(sql).run(...params);
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function audit(db: DatabaseSync, actor: string | null, action: string, entity: string, entityId: string, details: unknown, now: string) {
  run(db, 'INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?)', id(), actor, action, entity, entityId, JSON.stringify(details), now);
}
