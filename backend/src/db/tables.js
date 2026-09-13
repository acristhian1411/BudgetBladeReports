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

/**
 * Foreign-key references expressed as `uuid` on the sync wire.
 *
 * For each sync entity, maps the internal integer FK column (`id`) to the uuid
 * column exchanged with the mobile app (`uuid`) and the referenced table
 * (`ref`). The server resolves `*_uuid` -> `*_id` on write and emits `*_uuid`
 * (via joins) on read, so the mobile app never sees server-internal ids.
 */
export const FK_UUID_MAP = {
  transactions: [
    { id: 'till_id', uuid: 'till_uuid', ref: 'tills' },
    { id: 'category_id', uuid: 'category_uuid', ref: 'categories' },
    { id: 'credit_card_id', uuid: 'credit_card_uuid', ref: 'credit_cards' },
    { id: 'parent_transaction_id', uuid: 'parent_transaction_uuid', ref: 'transactions' },
  ],
  scheduled_plans: [
    { id: 'category_id', uuid: 'category_uuid', ref: 'categories' },
    { id: 'entity_id', uuid: 'entity_uuid', ref: 'entities' },
    { id: 'till_id', uuid: 'till_uuid', ref: 'tills' },
  ],
  scheduled_occurrences: [
    { id: 'plan_id', uuid: 'plan_uuid', ref: 'scheduled_plans' },
    { id: 'transaction_id', uuid: 'transaction_uuid', ref: 'transactions' },
  ],
  credit_cards: [{ id: 'till_id', uuid: 'till_uuid', ref: 'tills' }],
  credit_card_payment_items: [
    { id: 'credit_card_id', uuid: 'credit_card_uuid', ref: 'credit_cards' },
    { id: 'purchase_transaction_id', uuid: 'purchase_transaction_uuid', ref: 'transactions' },
    { id: 'payment_transaction_id', uuid: 'payment_transaction_uuid', ref: 'transactions' },
  ],
  scheduled_payments_mapping: [
    { id: 'occurrence_id', uuid: 'occurrence_uuid', ref: 'scheduled_occurrences' },
    { id: 'transaction_id', uuid: 'transaction_uuid', ref: 'transactions' },
  ],
};

// Internal integer FK columns across all sync tables.
const FK_ID_COLUMNS = new Set(
  Object.values(FK_UUID_MAP)
    .flat()
    .map((fk) => fk.id),
);

/**
 * Non-FK, non-id business columns per sync table. Derived from TABLE_COLUMNS so
 * the two stay consistent. These are exchanged as-is on the sync wire (e.g.
 * `transfer_id` is a plain attribute, not an FK, so it remains here).
 */
export const BUSINESS_COLUMNS = Object.fromEntries(
  SYNC_TABLES.map((entity) => [
    entity,
    (TABLE_COLUMNS[entity] ?? []).filter((c) => c !== 'id' && !FK_ID_COLUMNS.has(c)),
  ]),
);
