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

      -- Transactions
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        till_id INTEGER REFERENCES tills(id) ON DELETE SET NULL,
        amount NUMERIC(15, 2),
        type TEXT,
        description TEXT,
        transfer_id TEXT,
        transaction_date TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
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
        start_date TEXT NOT NULL
      );

      -- Scheduled occurrences
      CREATE TABLE IF NOT EXISTS scheduled_occurrences (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES scheduled_plans(id) ON DELETE CASCADE,
        installment_number INTEGER,
        due_date TEXT NOT NULL,
        type TEXT NOT NULL,
        amount NUMERIC(15, 2),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'overdue')),
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
      );

      -- Create indices for common queries
      CREATE INDEX IF NOT EXISTS idx_transactions_till_id ON transactions(till_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_scheduled_plans_till_id ON scheduled_plans(till_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_plans_entity_id ON scheduled_plans(entity_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_occurrences_plan_id ON scheduled_occurrences(plan_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_occurrences_due_date ON scheduled_occurrences(due_date);
    `);

    // Add is_bank column to tills if it doesn't exist (incremental migration)
    await client.query(`
      ALTER TABLE tills ADD COLUMN IF NOT EXISTS is_bank BOOLEAN DEFAULT FALSE;
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
