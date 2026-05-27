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
        name TEXT NOT NULL UNIQUE,
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

    // Seed categories if table is empty
    const categoryCount = await client.query('SELECT COUNT(*) FROM categories');
    if (categoryCount.rows[0].count === 0) {
      const categoriesList = [
        ['Alimentación', 'expense'],
        ['Salud', 'expense'],
        ['Combustible', 'expense'],
        ['Mantenimiento', 'expense'],
        ['Vestimenta', 'expense'],
        ['Servicios', 'expense'],
        ['Subscripciones', 'expense'],
        ['Alquiler', 'expense'],
        ['Ajustes', 'expense'],
        ['Préstamos', 'expense'],
        ['Ocio', 'expense'],
        ['Educación', 'expense'],
        ['Salario', 'income'],
        ['Ventas', 'income'],
        ['Alquileres Cobrados', 'income'],
        ['Intereses', 'income'],
      ];

      for (const [name, type] of categoriesList) {
        await client.query(
          'INSERT INTO categories (name, type) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
          [name, type],
        );
      }
    }

    console.log('✓ Database migration completed');
  } catch (error) {
    console.error('✗ Database migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
};
