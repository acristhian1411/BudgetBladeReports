import { Pool } from 'pg';
import { ensureUserCategories } from '../src/db/defaults.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://laravel:secret@localhost:35432/budgetblade_test';

export const TEST_USER_ID = 'test-user';

/**
 * Stand-in for `requireAuth` in route tests: gives the request an owner
 * without calling the external auth server.
 */
export const withTestUser = (req, _res, next) => {
  req.userId = TEST_USER_ID;
  next();
};

export const withUser = (userId) => (req, _res, next) => {
  req.userId = userId;
  next();
};

/** Seeds the default per-user category catalog for route tests. */
export const seedTestCategories = (pool, userId = TEST_USER_ID) =>
  ensureUserCategories(pool, userId);

const getDbName = (url) => new URL(url).pathname.replace(/^\//, '');

const getAdminUrl = (url) => {
  const u = new URL(url);
  u.pathname = '/postgres';
  return u.toString();
};

/**
 * Creates the test database if it does not exist yet (connects to the
 * `postgres` maintenance database on the same host). Requires CREATEDB.
 */
export const ensureTestDatabase = async (url = TEST_DATABASE_URL) => {
  const dbName = getDbName(url);
  const admin = new Pool({ connectionString: getAdminUrl(url) });
  try {
    const res = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (res.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }
};

export const createPool = (url = TEST_DATABASE_URL) =>
  new Pool({ connectionString: url, max: 5 });

/**
 * Drops and recreates the public schema so each test starts from a clean slate
 * without needing to create/drop the whole database.
 */
export const resetTestDatabase = async (url = TEST_DATABASE_URL) => {
  await ensureTestDatabase(url);
  const pool = createPool(url);
  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
};
