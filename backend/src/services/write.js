import { randomUUID } from 'node:crypto';

export const nowIso = () => new Date().toISOString();

/**
 * Runs `fn(client)` inside a database transaction, committing on success and
 * rolling back on error.
 */
export const withTransaction = async (db, fn) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Stamps a new row with a sync uuid and updated_at. */
export const stampNew = (row) => ({
  ...row,
  uuid: row.uuid ?? randomUUID(),
  updated_at: row.updated_at ?? nowIso(),
});

/**
 * Soft-deletes a row (sets deleted_at + updated_at). Returns the number of
 * affected rows (0 if it was already deleted or does not exist).
 */
export const softDeleteRow = async (client, table, id) => {
  const result = await client.query(
    `UPDATE ${table} SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return result.rowCount;
};

/**
 * Updates a row by id (only where not soft-deleted), refreshing updated_at.
 */
export const updateRow = async (client, table, id, data) => {
  const cols = Object.keys(data);
  if (cols.length === 0) return;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values = [...Object.values(data), id];
  const result = await client.query(
    `UPDATE ${table} SET ${sets}, updated_at = now() WHERE id = $${values.length} AND deleted_at IS NULL`,
    values,
  );
  return result.rowCount;
};
