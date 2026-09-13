import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { resetTestDatabase, createPool } from '../test-utils/db.js';

let app;
let server;
let baseUrl;
let dbPool;

before(async () => {
  await resetTestDatabase();
  ({ default: app } = await import('../src/index.js'));
  dbPool = createPool();
  app.locals.db = dbPool;
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await dbPool.end();
});

test('GET /api/health returns 200 without auth', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'ok');
  assert.equal(typeof body.version, 'string');
  assert.ok(body.timestamp);
});

test('GET /api/health returns 503 when db is down', async () => {
  const deadPool = new Pool({
    connectionString: 'postgres://x:x@127.0.0.1:1/none',
    connectionTimeoutMillis: 300,
  });
  app.locals.db = deadPool;

  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 503);

    const body = await res.json();
    assert.equal(body.status, 'error');
    assert.equal(body.db, 'error');
  } finally {
    app.locals.db = dbPool;
    await deadPool.end();
  }
});
