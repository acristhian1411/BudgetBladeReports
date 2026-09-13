import { Pool } from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://laravel:secret@localhost:35432/budgetblade_test';

export const createPool = (url = TEST_DATABASE_URL) =>
  new Pool({ connectionString: url, max: 5 });

/**
 * Drops and recreates the public schema so each test starts from a clean slate
 * without needing to create/drop the whole database.
 */
export const resetTestDatabase = async (url = TEST_DATABASE_URL) => {
  const pool = createPool(url);
  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
};
