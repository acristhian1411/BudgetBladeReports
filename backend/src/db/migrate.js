import { randomUUID } from 'node:crypto';
import { SYNC_TABLES } from './tables.js';

/**
 * Database migration: Creates all tables matching mobile SQLite schema
 * Runs on backend startup
 */

export const migrateDatabase = async (pool) => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        password TEXT,
        password_salt TEXT,
        password_iterations INTEGER,
        password_algorithm TEXT,
        failed_attempts INTEGER DEFAULT 0,
        locked_until BIGINT
      );

      -- Tills (accounts/wallets)
      CREATE TABLE IF NOT EXISTS tills (
        id SERIAL PRIMARY KEY,
        name TEXT,
        account_number TEXT
      );

      -- Categories
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('income', 'expense'))
      );

      -- Entities (clients/providers)
      CREATE TABLE IF NOT EXISTS entities (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('client', 'provider', 'both')),
        contact TEXT
      );

      -- Credit cards (linked to a till)
      CREATE TABLE IF NOT EXISTS credit_cards (
        id SERIAL PRIMARY KEY,
        till_id INTEGER NOT NULL REFERENCES tills(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        credit_limit NUMERIC(15, 2) NOT NULL DEFAULT 0
      );

      -- Transactions
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        till_id INTEGER REFERENCES tills(id) ON DELETE SET NULL,
        amount NUMERIC(15, 2),
        type TEXT,
        description TEXT,
        transfer_id TEXT,
        transaction_date TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        payment_method TEXT,
        credit_card_id INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL,
        affects_balance INTEGER DEFAULT 1,
        parent_transaction_id INTEGER
      );

      -- Scheduled plans
      CREATE TABLE IF NOT EXISTS scheduled_plans (
        id SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
        till_id INTEGER REFERENCES tills(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        base_amount NUMERIC(15, 2),
        total_installments INTEGER,
        start_date TEXT NOT NULL,
        type TEXT
      );

      -- Scheduled occurrences
      CREATE TABLE IF NOT EXISTS scheduled_occurrences (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES scheduled_plans(id) ON DELETE CASCADE,
        installment_number INTEGER,
        due_date TEXT NOT NULL,
        type TEXT NOT NULL,
        amount NUMERIC(15, 2),
        remaining_amount NUMERIC(15, 2),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'partially_paid', 'processed', 'overdue')),
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
      );

      -- Partial payment mapping (occurrence ↔ transaction)
      CREATE TABLE IF NOT EXISTS scheduled_payments_mapping (
        id SERIAL PRIMARY KEY,
        occurrence_id INTEGER NOT NULL REFERENCES scheduled_occurrences(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        amount_paid NUMERIC(15, 2) NOT NULL,
        payment_date TEXT NOT NULL
      );

      -- Credit card payment items (purchase ↔ payment transaction)
      CREATE TABLE IF NOT EXISTS credit_card_payment_items (
        id SERIAL PRIMARY KEY,
        credit_card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
        purchase_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        payment_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        amount_paid NUMERIC(15, 2) NOT NULL
      );

      -- Create indices for common queries
      CREATE INDEX IF NOT EXISTS idx_transactions_till_id ON transactions(till_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_scheduled_plans_till_id ON scheduled_plans(till_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_plans_entity_id ON scheduled_plans(entity_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_occurrences_plan_id ON scheduled_occurrences(plan_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_occurrences_due_date ON scheduled_occurrences(due_date);
      CREATE INDEX IF NOT EXISTS idx_credit_card_payment_items_card ON credit_card_payment_items(credit_card_id);
      CREATE INDEX IF NOT EXISTS idx_credit_card_payment_items_purchase ON credit_card_payment_items(purchase_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_credit_card_payment_items_payment ON credit_card_payment_items(payment_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_payments_mapping_occurrence ON scheduled_payments_mapping(occurrence_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_payments_mapping_transaction ON scheduled_payments_mapping(transaction_id);
    `);

    // -----------------------------------------------------------------------
    // Incremental migrations (safe to run on existing databases)
    // -----------------------------------------------------------------------

    // tills: is_bank column
    await client.query(`
      ALTER TABLE tills ADD COLUMN IF NOT EXISTS is_bank BOOLEAN DEFAULT FALSE;
    `);

    // credit_cards table (for existing DBs that predate this schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_cards (
        id SERIAL PRIMARY KEY,
        till_id INTEGER NOT NULL REFERENCES tills(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        credit_limit NUMERIC(15, 2) NOT NULL DEFAULT 0
      );
    `);

    // transactions: new columns added in v4
    await client.query(`
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS credit_card_id INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS affects_balance INTEGER DEFAULT 1;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS parent_transaction_id INTEGER;
    `);

    // Backfill affects_balance for pre-existing rows
    await client.query(`
      UPDATE transactions SET affects_balance = 1 WHERE affects_balance IS NULL;
    `);

    // scheduled_plans: type column added in v5
    await client.query(`
      ALTER TABLE scheduled_plans ADD COLUMN IF NOT EXISTS type TEXT;
    `);

    // scheduled_occurrences: remaining_amount column added in v3
    await client.query(`
      ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15, 2);
    `);

    // Update scheduled_occurrences status CHECK to include 'partially_paid' (v3)
    // The constraint is named scheduled_occurrences_status_check by PostgreSQL convention
    await client.query(`
      ALTER TABLE scheduled_occurrences
        DROP CONSTRAINT IF EXISTS scheduled_occurrences_status_check;
      ALTER TABLE scheduled_occurrences
        ADD CONSTRAINT scheduled_occurrences_status_check
        CHECK(status IN ('pending', 'partially_paid', 'processed', 'overdue'));
    `);

    // scheduled_payments_mapping table (v3)
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_payments_mapping (
        id SERIAL PRIMARY KEY,
        occurrence_id INTEGER NOT NULL REFERENCES scheduled_occurrences(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        amount_paid NUMERIC(15, 2) NOT NULL,
        payment_date TEXT NOT NULL
      );
    `);

    // credit_card_payment_items table (v4)
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_card_payment_items (
        id SERIAL PRIMARY KEY,
        credit_card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
        purchase_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        payment_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        amount_paid NUMERIC(15, 2) NOT NULL
      );
    `);

    // New indices (idempotent)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_affects_balance ON transactions(affects_balance);
      CREATE INDEX IF NOT EXISTS idx_transactions_credit_card ON transactions(credit_card_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_payment_method ON transactions(payment_method);
      CREATE INDEX IF NOT EXISTS idx_credit_card_payment_items_card ON credit_card_payment_items(credit_card_id);
      CREATE INDEX IF NOT EXISTS idx_credit_card_payment_items_purchase ON credit_card_payment_items(purchase_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_credit_card_payment_items_payment ON credit_card_payment_items(payment_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_payments_mapping_occurrence ON scheduled_payments_mapping(occurrence_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_payments_mapping_transaction ON scheduled_payments_mapping(transaction_id);
    `);

    // -----------------------------------------------------------------------
    // Ownership columns (multi-user): every business row belongs to the user
    // that created it. `users` is excluded (local mobile credentials never
    // reach the server).
    // -----------------------------------------------------------------------
    for (const tableName of SYNC_TABLES) {
      await client.query(`
        ALTER TABLE ${tableName}
          ADD COLUMN IF NOT EXISTS user_id TEXT;
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_user_id ON ${tableName}(user_id)`,
      );
    }

    // -----------------------------------------------------------------------
    // Remote sync columns (uuid identity, soft delete, updated_at, device_id)
    // -----------------------------------------------------------------------
    for (const tableName of SYNC_TABLES) {
      await client.query(`
        ALTER TABLE ${tableName}
          ADD COLUMN IF NOT EXISTS uuid TEXT,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS device_id TEXT;
      `);
    }

    // Backfill uuid + updated_at for pre-existing rows (JS-side uuidv4 avoids
    // requiring the pgcrypto extension).
    for (const tableName of SYNC_TABLES) {
      const missing = await client.query(
        `SELECT id FROM ${tableName} WHERE uuid IS NULL`,
      );
      for (const row of missing.rows) {
        await client.query(`UPDATE ${tableName} SET uuid = $1 WHERE id = $2`, [
          randomUUID(),
          row.id,
        ]);
      }
      await client.query(
        `UPDATE ${tableName} SET updated_at = now() WHERE updated_at IS NULL`,
      );
    }

    // Unique index on uuid for idempotent sync lookups.
    for (const tableName of SYNC_TABLES) {
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_uuid ON ${tableName}(uuid)`,
      );
    }

    // Categories: allow the same name across income/expense (mobile behavior,
    // e.g. "Ajustes" and "Intereses" exist in both). Every user owns their own
    // catalog, so uniqueness is scoped by owner.
    await client.query(`
      ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;
    `);
    await client.query(`
      DROP INDEX IF EXISTS idx_categories_name_type;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_type
        ON categories(user_id, name, type);
    `);

    // Ledger of processed sync operations (idempotency + audit), scoped by the
    // user that pushed the operation.
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_operations (
        uuid TEXT PRIMARY KEY,
        user_id TEXT,
        entity TEXT NOT NULL,
        operation TEXT NOT NULL,
        entity_id INTEGER,
        device_id TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS user_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_sync_operations_user_id ON sync_operations(user_id);
    `);

    // -----------------------------------------------------------------------
    // Bank statement import staging (server-side review before insert). Not
    // part of the mobile sync set: these hold parsed-but-unreviewed rows.
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS statement_imports (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        till_id INTEGER NOT NULL,
        source_filename TEXT,
        source_format TEXT,
        detected_bank TEXT,
        status TEXT NOT NULL DEFAULT 'mapping',
        raw_grid JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_statement_imports_user ON statement_imports(user_id);
      CREATE INDEX IF NOT EXISTS idx_statement_imports_till ON statement_imports(till_id);

      CREATE TABLE IF NOT EXISTS statement_rows (
        id SERIAL PRIMARY KEY,
        import_id INTEGER NOT NULL REFERENCES statement_imports(id) ON DELETE CASCADE,
        transaction_date TEXT NOT NULL,
        description TEXT,
        amount NUMERIC(15, 2) NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('ingreso', 'egreso')),
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        imported BOOLEAN NOT NULL DEFAULT FALSE,
        row_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_statement_rows_import ON statement_rows(import_id);

      CREATE TABLE IF NOT EXISTS statement_templates (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        till_id INTEGER NOT NULL UNIQUE,
        source_format TEXT,
        mapping JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_statement_templates_till ON statement_templates(till_id);
    `);

    // Existing databases predating the column-mapping step.
    await client.query(`
      ALTER TABLE statement_imports ADD COLUMN IF NOT EXISTS raw_grid JSONB;
    `);

    console.log('✓ Database migration completed');
  } catch (error) {
    console.error('✗ Database migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
};
