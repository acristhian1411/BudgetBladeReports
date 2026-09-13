import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase } from '../src/db/migrate.js';
import { SYNC_TABLES } from '../src/db/tables.js';
import { resetTestDatabase, createPool } from '../test-utils/db.js';

let pool;

before(async () => {
  pool = createPool();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetTestDatabase();
});

test('migrateDatabase adds sync columns to every sync table', async () => {
  await migrateDatabase(pool);

  for (const table of SYNC_TABLES) {
    const res = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = $1
          AND column_name IN ('uuid', 'updated_at', 'deleted_at', 'device_id')`,
      [table],
    );
    assert.equal(
      res.rowCount,
      4,
      `${table}: expected uuid/updated_at/deleted_at/device_id columns`,
    );
  }
});

test('migrateDatabase backfills uuid and updated_at for legacy rows', async () => {
  await migrateDatabase(pool);

  // Simulate a row that predates the sync columns.
  await pool.query(`INSERT INTO tills (name) VALUES ($1)`, ['Legacy till']);
  await pool.query(`UPDATE tills SET uuid = NULL, updated_at = NULL WHERE name = $1`, [
    'Legacy till',
  ]);

  // Re-running the migration must backfill uuid + updated_at.
  await migrateDatabase(pool);

  const row = await pool.query(
    `SELECT uuid, updated_at FROM tills WHERE name = $1`,
    ['Legacy till'],
  );
  assert.ok(row.rows[0]?.uuid, 'uuid should be backfilled');
  assert.ok(row.rows[0]?.updated_at, 'updated_at should be backfilled');
});

test('migrateDatabase is idempotent and creates unique uuid indexes', async () => {
  await migrateDatabase(pool);
  await migrateDatabase(pool);
  await migrateDatabase(pool);

  for (const table of SYNC_TABLES) {
    const res = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
      [`idx_${table}_uuid`],
    );
    assert.equal(res.rowCount, 1, `${table}: missing unique uuid index`);
  }
});

test('migrateDatabase seeds default categories', async () => {
  await migrateDatabase(pool);
  const res = await pool.query(`SELECT COUNT(*)::int AS count FROM categories`);
  assert.ok(res.rows[0].count > 0, 'categories should be seeded');
});
