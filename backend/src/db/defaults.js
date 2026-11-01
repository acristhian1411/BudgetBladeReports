import { randomUUID } from 'node:crypto';
import { nowIso } from '../services/write.js';

/**
 * Default categories copied to every user on first login so each one owns an
 * independent catalog (renames/deletes never leak across accounts).
 */
export const DEFAULT_CATEGORIES = [
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
  ['Impuestos', 'expense'],
  ['Pago de tarjetas', 'expense'],
  ['Intereses de tarjeta', 'expense'],
  ['Intereses', 'expense'],
  ['Otros', 'expense'],
  ['Salario', 'income'],
  ['Ajustes', 'income'],
  ['Ventas', 'income'],
  ['Alquileres Cobrados', 'income'],
  ['Intereses', 'income'],
];

// Avoid one existence query per request; a process restart costs one query per
// user. `shortcut: a user who deletes all categories gets them back after a
// restart, acceptable for a default catalog`.
const seededUsers = new Set();

export const resetUserCategoryCache = () => seededUsers.clear();

export const ensureUserCategories = async (db, userId) => {
  if (seededUsers.has(userId)) return;

  const existing = await db.query(
    'SELECT 1 FROM categories WHERE user_id = $1 LIMIT 1',
    [userId],
  );
  if (existing.rowCount === 0) {
    const values = [];
    const placeholders = DEFAULT_CATEGORIES.map(([name, type], i) => {
      values.push(userId, name, type, randomUUID(), nowIso());
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });

    await db.query(
      `INSERT INTO categories (user_id, name, type, uuid, updated_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (user_id, name, type) DO NOTHING`,
      values,
    );
  }

  seededUsers.add(userId);
};
