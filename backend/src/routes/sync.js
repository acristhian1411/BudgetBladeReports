import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { decryptNBBBackup } from '../services/backup.js';
import { applyChanges, getChangesSince } from '../services/sync.js';
import { requireScope } from '../middleware/requireScope.js';
import {
  DELETE_ORDER,
  INSERT_ORDER,
  TABLE_COLUMNS,
  FK_UUID_MAP,
} from '../db/tables.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Sync scopes. Empty by default (scope enforcement disabled until the auth app
// returns scopes on /api/user). Set these to enable scoped access control.
const SYNC_READ_SCOPE = (process.env.AUTH_SYNC_READ_SCOPE || '').trim();
const SYNC_WRITE_SCOPE = (process.env.AUTH_SYNC_WRITE_SCOPE || '').trim();

const IMPORT_CLIENT_ERROR_PATTERNS = [
  /Invalid \.nbb/i,
  /Decryption failed/i,
  /missing wrappedMasterKey/i,
  /Password is required/i,
  /not valid JSON/i,
  /Invalid backup payload/i,
];

const isClientImportError = (error) => {
  const message = error?.message || '';
  return IMPORT_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

// `users` holds the mobile's local credentials and is never imported into the
// shared server database.
const IMPORT_TABLES = INSERT_ORDER.filter((table) => table !== 'users');

/**
 * GET /api/sync?since=<ts>
 * Pulls incremental changes (all entities) since the given cursor.
 * `since=0` performs a full pull.
 */
router.get('/', requireScope(SYNC_READ_SCOPE), async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const { since } = req.query;
    const serverChanges = await getChangesSince(db, since ?? '0', req.userId);
    res.json({ serverChanges, syncedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sync
 * Pushes a batch of create/update/delete operations (mobile outbox).
 */
router.post('/', requireScope(SYNC_WRITE_SCOPE), async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const result = await applyChanges(db, req.body ?? {}, req.userId);
    res.json(result);
  } catch (error) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid sync payload',
        details: error.issues,
      });
    }
    next(error);
  }
});

/**
 * POST /api/sync/import
 * Imports encrypted .nbb backup file
 * Expects multipart form: file + password
 */
router.post('/import', upload.single('file'), async (req, res, next) => {
  const client = await req.app.locals.db.connect();
  let transactionStarted = false;

  try {
    const { password } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    console.log(`\n[SYNC] Starting backup import: ${file.originalname}`);

    // Step 1: Decrypt .nbb file
    console.log('[SYNC] Step 1: Decrypting .nbb file...');
    const fileContent = file.buffer.toString('utf-8');
    const backup = await decryptNBBBackup(fileContent, password);
    console.log('[SYNC] ✓ Decryption successful');

    // Step 2: Start transaction
    console.log('[SYNC] Step 2: Starting database transaction...');
    await client.query('BEGIN');
    transactionStarted = true;

    // Step 3: Clear only this user's data (in reverse dependency order).
    console.log('[SYNC] Step 3: Clearing existing data...');
    for (const tableName of DELETE_ORDER) {
      if (tableName === 'users') continue;
      await client.query(`DELETE FROM ${tableName} WHERE user_id = $1`, [req.userId]);
    }
    console.log('[SYNC] ✓ Data cleared');

    // Step 4: Insert new data (in dependency order). Mobile ids are local to
    // the backup, so they are re-generated server-side and every FK is remapped
    // through `idMaps` to keep users isolated.
    console.log('[SYNC] Step 4: Inserting backup data...');
    const rowCountByTable = {};
    const idMaps = Object.fromEntries(IMPORT_TABLES.map((table) => [table, new Map()]));
    const pendingParents = [];
    const now = new Date().toISOString();

    for (const tableName of IMPORT_TABLES) {
      const rows = Array.isArray(backup.tables?.[tableName])
        ? backup.tables[tableName]
        : [];
      const allowedColumns = (TABLE_COLUMNS[tableName] ?? []).filter((c) => c !== 'id');
      const fkMap = FK_UUID_MAP[tableName] ?? [];
      let inserted = 0;

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;

        const normalizedRow = {
          ...row,
          user_id: req.userId,
          uuid: row.uuid ?? randomUUID(),
          updated_at: row.updated_at ?? now,
        };
        // Mobile backups don't include is_bank; infer from account number.
        if (tableName === 'tills') {
          normalizedRow.is_bank = Boolean(String(row.account_number ?? '').trim());
        }

        const validColumns = allowedColumns.filter(
          (c) => Object.prototype.hasOwnProperty.call(normalizedRow, c),
        );
        for (const fk of fkMap) {
          if (Object.prototype.hasOwnProperty.call(row, fk.id) && !validColumns.includes(fk.id)) {
            validColumns.push(fk.id);
          }
        }
        for (const syncCol of ['user_id', 'uuid', 'updated_at']) {
          if (!validColumns.includes(syncCol)) validColumns.push(syncCol);
        }

        // Translate the mobile's local ids to this database's ids.
        for (const fk of fkMap) {
          if (fk.id === 'parent_transaction_id') continue;
          const oldId = row[fk.id];
          normalizedRow[fk.id] =
            oldId == null ? null : (idMaps[fk.ref]?.get(Number(oldId)) ?? null);
        }
        const oldParentId =
          tableName === 'transactions' ? row.parent_transaction_id : null;
        normalizedRow.parent_transaction_id = null;

        try {
          const placeholders = validColumns.map((_, i) => `$${i + 1}`).join(', ');
          const values = validColumns.map((c) => normalizedRow[c]);
          const result = await client.query(
            `INSERT INTO ${tableName} (${validColumns.join(', ')})
             VALUES (${placeholders})
             RETURNING id`,
            values,
          );
          const newId = result.rows[0].id;
          idMaps[tableName].set(Number(row.id), newId);
          if (oldParentId != null) {
            pendingParents.push({ newId, oldParentId: Number(oldParentId) });
          }
          inserted += 1;
        } catch (insertError) {
          console.warn(
            `Warning: Failed to insert row in ${tableName}:`,
            insertError.message,
          );
        }
      }

      rowCountByTable[tableName] = inserted;
      console.log(`  - ${tableName}: ${inserted} rows inserted`);
    }

    // Self-referencing FK: parent transactions may appear after their children.
    for (const { newId, oldParentId } of pendingParents) {
      const parentId = idMaps.transactions.get(oldParentId);
      if (parentId == null) continue;
      await client.query(
        `UPDATE transactions SET parent_transaction_id = $1
          WHERE id = $2 AND user_id = $3`,
        [parentId, newId, req.userId],
      );
    }

    // Step 5: Commit transaction
    console.log('[SYNC] Step 5: Committing transaction...');
    await client.query('COMMIT');
    console.log('[SYNC] ✓ Transaction committed');

    console.log('[SYNC] ✓ Import completed successfully\n');

    res.json({
      status: 'ok',
      message: 'Backup imported successfully',
      rowCountByTable,
      metadata: {
        exported_at: backup.exported_at,
        db_schema_version: backup.schema_version,
      },
    });
  } catch (error) {
    // Rollback on error
    try {
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError.message);
    }

    console.error('[SYNC] ✗ Import failed:', error.message);

    if (isClientImportError(error)) {
      error.status = 400;
    }

    next(error);
  } finally {
    client.release();
  }
});

export default router;
