import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { backup } from 'node:sqlite';
import { fixture, staticFixture } from './helpers.js';
import { createApp } from '../src/app.js';
import { id, one, openDatabase, run, transaction } from '../src/db.js';
import { csv } from '../src/routes/reports.js';
import { localDate, monthRange } from '../src/lib.js';
import { seedDemo } from '../src/seed.js';

test('production serves React routes while API errors remain JSON and missing assets remain 404', async () => {
  const f = await fixture();
  const dir = staticFixture();
  try {
    writeFileSync(join(dir.path, 'index.html'), '<html><body>React shell</body></html>');
    mkdirSync(join(dir.path, 'assets'));
    writeFileSync(join(dir.path, 'assets', 'app.js'), 'window.ready = true;');
    const app = createApp({ ...f.ctx, config: { ...f.config, production: true, staticDir: dir.path, appOrigin: 'https://mess.example.edu' } });
    const page = await request(app).get('/student/billing').set('Accept', 'text/html').expect(200);
    assert.match(page.text, /React shell/);
    await request(app).get('/api/v1/unknown').expect('Content-Type', /json/).expect(404);
    await request(app).get('/assets/missing.js').expect(404);
    const asset = await request(app).get('/assets/app.js').expect(200);
    assert.match(String(asset.headers['cache-control']), /immutable/);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'student@example.edu', password: 'SecureTest2026!' }).expect(200);
    assert.match(String(login.headers['set-cookie']), /Secure/);
  } finally { f.close(); dir.close(); }
});
test('production refuses startup without a built React application', async () => {
  const f = await fixture();
  try { assert.throws(() => createApp({ ...f.ctx, config: { ...f.config, production: true } }), /React build missing/); }
  finally { f.close(); }
});
test('Swagger explorer and its static assets are served without inline JavaScript', async () => {
  const f = await fixture();
  try {
    const page = await request(f.app).get('/api/docs').expect(200);
    assert.match(page.text, /src="\/api\/docs\/init.js"/);
    assert.ok(!/<script>/.test(page.text));
    await request(f.app).get('/api/docs/init.js').expect('Content-Type', /javascript/).expect(200);
    await request(f.app).get('/api/docs/assets/swagger-ui.css').expect(200);
    await request(f.app).get('/api/docs/assets/swagger-ui-bundle.js').expect(200);
  } finally { f.close(); }
});
test('migrations are repeatable, data persists and consistent backups can be restored', async () => {
  const dir = staticFixture();
  const path = join(dir.path, 'data.sqlite');
  let db = openDatabase(path);
  try {
    run(db, 'INSERT INTO suppliers VALUES (?,?,?,?)', id(), 'Persistent supplier', 'Contact', new Date().toISOString());
    await backup(db, join(dir.path, 'backup.sqlite'));
    db.close();
    db = openDatabase(path);
    assert.equal(one(db, 'SELECT name FROM suppliers')!.name, 'Persistent supplier');
    assert.equal(one(db, 'SELECT count(*) AS n FROM schema_migrations')!.n, 1);
    const restored = openDatabase(join(dir.path, 'backup.sqlite'));
    assert.equal(one(restored, 'PRAGMA integrity_check')!.integrity_check, 'ok');
    assert.equal(one(restored, 'SELECT count(*) AS n FROM suppliers')!.n, 1);
    restored.close();
  } finally { db.close(); dir.close(); }
});
test('failed transactions roll back all writes and foreign keys are enforced', () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(() => transaction(db, () => {
      run(db, 'INSERT INTO suppliers VALUES (?,?,?,?)', id(), 'Rollback', 'Contact', '2026-11-07T03:00:00Z');
      throw new Error('Rollback test');
    }));
    assert.equal(one(db, 'SELECT count(*) AS n FROM suppliers')!.n, 0);
    assert.throws(() => run(db, 'INSERT INTO sessions VALUES (?,?,?,?,?)', 'hash', id(), 'csrf', 'future', 'now'), /FOREIGN KEY/);
  } finally { db.close(); }
});
test('IST dates and month rollover are independent of the server timezone', () => {
  assert.equal(localDate(new Date('2026-11-07T20:00:00Z')), '2026-11-08');
  assert.deepEqual(monthRange('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
});
test('CSV escapes quotes, newlines and spreadsheet formulas', () => {
  const output = csv([{ name: '=HYPERLINK("bad")', note: 'a\nb' }], ['name','note']);
  assert.ok(output.includes("'="));
  assert.ok(output.includes('""bad""'));
  assert.ok(output.includes('"a\nb"'));
});
test('demo seed is transactional, refuses an occupied database and is forbidden in production', async () => {
  const f = await fixture();
  const db = openDatabase(':memory:');
  try {
    const ctx = { ...f.ctx, db };
    const accounts = await seedDemo(ctx);
    assert.equal(accounts.length, 5);
    assert.ok(one(db, 'SELECT count(*) AS n FROM meal_services')!.n >= 28);
    assert.equal(one(db, 'SELECT count(*) AS n FROM stock_movements')!.n, 3);
    await assert.rejects(() => seedDemo(ctx), /empty database/);
    await assert.rejects(() => seedDemo({ ...ctx, config: { ...ctx.config, production: true } }), /disabled in production/);
    const prodDb = openDatabase(':memory:');
    try {
      const prodAccounts = await seedDemo({ ...ctx, db: prodDb, config: { ...ctx.config, production: true } }, { allowProduction: true, domain: 'iiit-bh.ac.in' });
      assert.equal(prodAccounts.length, 5);
      assert.ok(prodAccounts.every(a => a.email.endsWith('@iiit-bh.ac.in')));
      assert.ok(prodAccounts.password && prodAccounts.password.length >= 12);
    } finally { prodDb.close(); }
  } finally { db.close(); f.close(); }
});
