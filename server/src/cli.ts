import { backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config.js';
import { audit, id, one, openDatabase, run, transaction } from './db.js';
import { hashPassword, passwordSchema } from './auth.js';
import { iso, today } from './lib.js';
import { seedDemo } from './seed.js';
import { z } from 'zod';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const ctx = { config, db, now: () => new Date() };
try {
  const command = process.argv[2];
  if (command === 'migrate') {
    stdout.write('Database migrations applied successfully.\n');
  } else if (command === 'seed') {
    const accounts = await seedDemo(ctx);
    stdout.write(`Demo data created.\n${accounts.map(account => `${account.role}: ${account.email}`).join('\n')}\n`);
    if (!process.env.DEMO_PASSWORD) {
      stdout.write(`Generated demo password (save securely now; not stored in plaintext): ${accounts.password}\n`);
    }
  } else if (command === 'demo-init') {
    const accounts = await seedDemo(ctx, {
      allowProduction: true,
      password: process.env.DEMO_PASSWORD || undefined,
      domain: process.env.DEMO_EMAIL_DOMAIN || 'iiit-bh.ac.in'
    });
    stdout.write(`Production demonstration initialized on empty database.\n${accounts.map(account => `${account.role}: ${account.email}`).join('\n')}\n`);
    if (!process.env.DEMO_PASSWORD) {
      stdout.write(`Generated demo password (save securely now; not stored in plaintext): ${accounts.password}\n`);
    }
  } else if (command === 'admin') {
    const password = passwordSchema.parse(process.env.ADMIN_PASSWORD);
    const rl = createInterface({ input: stdin, output: stdout });
    let email: string;
    let name: string;
    try {
      email = z.email().max(254).parse(process.env.ADMIN_EMAIL ?? await rl.question('Administrator email: ')).toLowerCase();
      name = z.string().trim().min(1).max(100).parse(process.env.ADMIN_NAME ?? await rl.question('Administrator name: '));
    } finally { rl.close(); }
    const hash = await hashPassword(password);
    transaction(db, () => {
      if (one(db, 'SELECT id FROM users WHERE email=?', email)) throw new Error('That email already exists; no changes were made');
      if (one(db, "SELECT id FROM users WHERE role='ADMIN' AND active=1")) throw new Error('An active administrator already exists. Create additional accounts through the authenticated API');
      const userId = id();
      run(db, "INSERT INTO users (id,name,email,password_hash,role,joined_on,must_change_password,created_at) VALUES (?,?,?,?,'ADMIN',?,0,?)", userId, name, email, hash, today(ctx), iso(ctx));
      audit(db, null, 'ADMIN_BOOTSTRAPPED', 'USER', userId, {}, iso(ctx));
    });
    stdout.write('Administrator created.\n');
  } else if (command === 'backup') {
    mkdirSync(resolve('backups'), { recursive: true });
    const target = resolve('backups', `mess-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    if (existsSync(target)) throw new Error('Backup path already exists');
    await backup(db, target);
    stdout.write(`Consistent SQLite backup created: ${target}\n`);
  } else {
    throw new Error('Use migrate, seed, demo-init, admin or backup');
  }
} catch (error) {
  process.stderr.write(`${error instanceof z.ZodError ? 'Invalid input. Set ADMIN_PASSWORD to a password with 12–128 characters, upper and lowercase letters, and a number; verify email and name.' : error instanceof Error ? error.message : 'Command failed'}\n`);
  process.exitCode = 1;
} finally { db.close(); }
