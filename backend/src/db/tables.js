/**
 * Shared table metadata for the BudgetBlade dataset.
 *
 * Single source of truth for the business tables that participate in remote
 * sync (everything except `users`, whose local password hash must never leave
 * the device), the per-table writable columns, and the dependency order used
 * for bulk deletes/inserts.
 */

export const SYNC_TABLES = [
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

// Deletion order (children first) and insertion order (parents first).
export const DELETE_ORDER = [
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

export const INSERT_ORDER = [
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

// Writable business columns per table (excludes sync-managed columns:
// uuid, updated_at, deleted_at, device_id).
export const TABLE_COLUMNS = {
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
