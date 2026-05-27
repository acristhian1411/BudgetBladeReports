import express from 'express';
import multer from 'multer';
import { decryptNBBBackup } from '../services/backup.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Deletion and insertion order for atomic transactions
const DELETE_ORDER = [
  'credit_card_payment_items',
  'scheduled_payments_mapping',
  'scheduled_occurrences',
  'scheduled_plans',
  'transactions',
  'credit_cards',
  'entities',
  'categories',
  'tills',
  'users',
];

const INSERT_ORDER = [
  'users',
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

const TABLE_COLUMNS = {
  users: [
    'id',
    'password',
    'password_salt',
    'password_iterations',
    'password_algorithm',
    'failed_attempts',
    'locked_until',
  ],
  tills: ['id', 'name', 'account_number', 'is_bank'],
  categories: ['id', 'name', 'type'],
  entities: ['id', 'name', 'type', 'contact'],
  credit_cards: ['id', 'till_id', 'name', 'credit_limit'],
  transactions: [
    'id',
    'till_id',
    'amount',
    'type',
    'description',
    'transfer_id',
    'transaction_date',
    'category_id',
    'payment_method',
    'credit_card_id',
    'affects_balance',
    'parent_transaction_id',
  ],
  scheduled_plans: [
    'id',
    'category_id',
    'entity_id',
    'till_id',
    'title',
    'base_amount',
    'total_installments',
    'start_date',
    'type',
  ],
  scheduled_occurrences: [
    'id',
    'plan_id',
    'installment_number',
    'due_date',
    'type',
    'amount',
    'remaining_amount',
    'status',
    'transaction_id',
  ],
  credit_card_payment_items: [
    'id',
    'credit_card_id',
    'purchase_transaction_id',
    'payment_transaction_id',
    'amount_paid',
  ],
  scheduled_payments_mapping: [
    'id',
    'occurrence_id',
    'transaction_id',
    'amount_paid',
    'payment_date',
  ],
};

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

        const validColumns = allowedColumns.filter(
          (c) =>
            Object.prototype.hasOwnProperty.call(normalizedRow, c) &&
            normalizedRow[c] !== undefined,
        );

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
