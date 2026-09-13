import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { decryptNBBBackup } from '../services/backup.js';
import { applyChanges, getChangesSince } from '../services/sync.js';
import { requireScope } from '../middleware/requireScope.js';
import { DELETE_ORDER, INSERT_ORDER, TABLE_COLUMNS } from '../db/tables.js';

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

/**
 * GET /api/sync?since=<ts>
 * Pulls incremental changes (all entities) since the given cursor.
 * `since=0` performs a full pull.
 */
router.get('/', requireScope(SYNC_READ_SCOPE), async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const { since } = req.query;
    const serverChanges = await getChangesSince(db, since ?? '0');
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
    const result = await applyChanges(db, req.body ?? {});
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

    // Step 3: Delete existing data (in reverse dependency order)
    console.log('[SYNC] Step 3: Clearing existing data...');
    for (const tableName of DELETE_ORDER) {
      await client.query(`DELETE FROM ${tableName}`);
    }
    console.log('[SYNC] ✓ Data cleared');

    // Step 4: Insert new data (in dependency order)
    console.log('[SYNC] Step 4: Inserting backup data...');
    const rowCountByTable = {};

    for (const tableName of INSERT_ORDER) {
      const rows = Array.isArray(backup.tables?.[tableName])
        ? backup.tables[tableName]
        : [];
      const allowedColumns = TABLE_COLUMNS[tableName] ?? [];
      let inserted = 0;

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;

        const normalizedRow =
          tableName === 'tills'
            ? {
                ...row,
                // Mobile backups don't include is_bank; infer from account number.
                is_bank: Boolean(String(row.account_number ?? '').trim()),
              }
            : row;

        // Populate remote-sync identity columns for imported business rows.
        // `users` is excluded from sync (local password hash must not reach the server).
        if (tableName !== 'users') {
          normalizedRow.uuid = normalizedRow.uuid ?? randomUUID();
          normalizedRow.updated_at =
            normalizedRow.updated_at ?? new Date().toISOString();
        }

        const validColumns = allowedColumns.filter(
          (c) =>
            Object.prototype.hasOwnProperty.call(normalizedRow, c) &&
            normalizedRow[c] !== undefined,
        );

        if (tableName !== 'users') {
          for (const syncCol of ['uuid', 'updated_at']) {
            if (!validColumns.includes(syncCol)) validColumns.push(syncCol);
          }
        }

        if (validColumns.length === 0) continue;

        const placeholders = validColumns.map((_, i) => `$${i + 1}`).join(', ');
        const values = validColumns.map((c) => normalizedRow[c]);

        try {
          await client.query(
            `INSERT INTO ${tableName} (${validColumns.join(', ')}) VALUES (${placeholders})`,
            values,
          );
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

    // Step 5: Reset autoincrement sequences
    console.log('[SYNC] Step 5: Resetting sequences...');
    const AUTOINCREMENT_TABLES = [
      'tills',
      'categories',
      'entities',
      'credit_cards',
      'transactions',
      'scheduled_plans',
      'scheduled_occurrences',
      'credit_card_payment_items',
      'scheduled_payments_mapping',
    ];

    for (const tableName of AUTOINCREMENT_TABLES) {
      const maxRow = await client.query(
        `SELECT COALESCE(MAX(id), 0) AS max_id FROM ${tableName}`,
      );
      const maxId = Number(maxRow.rows[0]?.max_id ?? 0);

      // Keep serial sequence aligned to imported max id, if the table has one.
      if (Number.isFinite(maxId) && maxId > 0) {
        const sequenceResult = await client.query(
          'SELECT pg_get_serial_sequence($1, $2) AS sequence_name',
          [tableName, 'id'],
        );
        const sequenceName = sequenceResult.rows[0]?.sequence_name;

        if (sequenceName) {
          await client.query('SELECT setval($1::regclass, $2, true)', [
            sequenceName,
            maxId,
          ]);
        }
      }
    }
    console.log('[SYNC] ✓ Sequences reset');

    // Step 6: Commit transaction
    console.log('[SYNC] Step 6: Committing transaction...');
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
