import { z } from 'zod';

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

// Row schemas matching mobile app structure
export const UsersRowSchema = z.object({
  id: z.string(),
  password: z.string(),
  password_salt: nullableString.optional(),
  password_iterations: nullableNumber.optional(),
  password_algorithm: nullableString.optional(),
  failed_attempts: nullableNumber.optional(),
  locked_until: nullableNumber.optional(),
}).strict();

export const TillsRowSchema = z.object({
  id: z.number(),
  name: nullableString.optional(),
  account_number: nullableString.optional(),
  is_bank: z.boolean().optional(),
}).strict();

export const CategoriesRowSchema = z.object({
  id: z.number(),
  name: nullableString.optional(),
  type: nullableString.optional(),
}).strict();

export const EntitiesRowSchema = z.object({
  id: z.number(),
  name: nullableString.optional(),
  type: nullableString.optional(),
  contact: nullableString.optional(),
}).strict();

export const TransactionsRowSchema = z.object({
  id: z.number(),
  till_id: nullableNumber.optional(),
  amount: nullableNumber.optional(),
  type: nullableString.optional(),
  description: nullableString.optional(),
  transfer_id: nullableString.optional(),
  transaction_date: nullableString.optional(),
  category_id: nullableNumber.optional(),
}).strict();

export const ScheduledPlansRowSchema = z.object({
  id: z.number(),
  category_id: nullableNumber.optional(),
  entity_id: nullableNumber.optional(),
  till_id: nullableNumber.optional(),
  title: nullableString.optional(),
  base_amount: nullableNumber.optional(),
  total_installments: nullableNumber.optional(),
  start_date: nullableString.optional(),
}).strict();

export const ScheduledOccurrencesRowSchema = z.object({
  id: z.number(),
  plan_id: nullableNumber.optional(),
  installment_number: nullableNumber.optional(),
  due_date: nullableString.optional(),
  type: nullableString.optional(),
  amount: nullableNumber.optional(),
  status: nullableString.optional(),
  transaction_id: nullableNumber.optional(),
}).strict();

export const BackupTablesSchema = z.object({
  users: z.array(UsersRowSchema).optional(),
  tills: z.array(TillsRowSchema).optional(),
  categories: z.array(CategoriesRowSchema).optional(),
  entities: z.array(EntitiesRowSchema).optional(),
  transactions: z.array(TransactionsRowSchema).optional(),
  scheduled_plans: z.array(ScheduledPlansRowSchema).optional(),
  scheduled_occurrences: z.array(ScheduledOccurrencesRowSchema).optional(),
}).strict();

export const EncryptedBackupEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('AES-256-GCM'),
  nonce: z.string(),
  ciphertext: z.string(),
  authTag: z.string(),
  exported_at: z.string().optional(),
  db_schema_version: z.number().optional(),
  wrappedMasterKey: z
    .object({
      version: z.number(),
      algorithm: z.string(),
      kdf: z.string(),
      iterations: z.number(),
      salt: z.string(),
      nonce: z.string(),
      ciphertext: z.string(),
      authTag: z.string(),
    })
    .optional(),
}).strict();

export const BackupPayloadSchema = z
  .object({
    app: z.string().optional(),
    version: z.number().optional(),
    schema_version: z.number().optional(),
    exported_at: z.string().optional(),
    tables: BackupTablesSchema,
  })
  .strict();
