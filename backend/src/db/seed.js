import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { migrateDatabase } from './migrate.js';
import { DELETE_ORDER } from './tables.js';
import { stampNew, withTransaction } from '../services/write.js';

/**
 * Demo data seeder.
 *
 * Wipes business data (everything except users and categories) and inserts a
 * coherent demo dataset with dates relative to the run date. Meant to be run
 * manually against a demo database: `npm run seed:demo`.
 */

const WIPE_TABLES = DELETE_ORDER.filter(
  (table) => !['users', 'categories'].includes(table),
);

const iso = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

/** First day-safe date for (month offset, day). */
const monthDate = (date, offset, day) => {
  const total = date.getFullYear() * 12 + date.getMonth() + offset;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay), 12);
};

export async function seedDemoDatabase(pool, { today = new Date() } = {}) {
  const base = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    12,
  );

  await migrateDatabase(pool);

  return withTransaction(pool, async (client) => {
    for (const table of WIPE_TABLES) {
      await client.query(`DELETE FROM ${table}`);
    }

    const insert = async (table, data) => {
      const row = stampNew(data);
      const columns = Object.keys(row);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        columns.map((column) => row[column]),
      );
      return result.rows[0].id;
    };

    // Categories are kept between runs; only create the ones a fresh database
    // might be missing.
    const categoryRows = await client.query(
      'SELECT id, name, type FROM categories',
    );
    const categoryIds = new Map(
      categoryRows.rows.map((row) => [`${row.name}|${row.type}`, row.id]),
    );
    const ensureCategory = async (name, type) => {
      const key = `${name}|${type}`;
      if (categoryIds.has(key)) return categoryIds.get(key);
      const result = await client.query(
        `INSERT INTO categories (name, type, uuid, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (name, type) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [name, type, randomUUID()],
      );
      categoryIds.set(key, result.rows[0].id);
      return result.rows[0].id;
    };
    const cat = (name, type) => categoryIds.get(`${name}|${type}`);

    for (const [name, type] of [
      ['Alimentación', 'expense'],
      ['Combustible', 'expense'],
      ['Servicios', 'expense'],
      ['Ocio', 'expense'],
      ['Salud', 'expense'],
      ['Vestimenta', 'expense'],
      ['Subscripciones', 'expense'],
      ['Alquiler', 'expense'],
      ['Préstamos', 'expense'],
      ['Mantenimiento', 'expense'],
      ['Impuestos', 'expense'],
      ['Otros', 'expense'],
      ['Pago de tarjetas', 'expense'],
      ['Intereses de tarjeta', 'expense'],
      ['Salario', 'income'],
      ['Ventas', 'income'],
      ['Alquileres Cobrados', 'income'],
      ['Ajustes', 'income'],
    ]) {
      await ensureCategory(name, type);
    }

    // Tills
    const efectivo = await insert('tills', { name: 'Efectivo', is_bank: false });
    const itau = await insert('tills', {
      name: 'Banco Itaú',
      is_bank: true,
      account_number: '**** 4821',
    });
    const ueno = await insert('tills', {
      name: 'Ueno Bank',
      is_bank: true,
      account_number: '**** 7310',
    });
    const billetera = await insert('tills', {
      name: 'Billetera Personal',
      is_bank: false,
      account_number: '0981 234 567',
    });

    // Entities
    const inmobiliaria = await insert('entities', {
      name: 'Inmobiliaria San Blas',
      type: 'provider',
      contact: '+595 21 555 010',
    });
    const bancoAtlas = await insert('entities', {
      name: 'Banco Atlas',
      type: 'provider',
      contact: '+595 21 555 020',
    });
    const personal = await insert('entities', {
      name: 'Personal',
      type: 'provider',
      contact: '+595 21 555 030',
    });
    const autoSur = await insert('entities', {
      name: 'Auto Sur',
      type: 'provider',
      contact: '+595 21 555 040',
    });
    const estudioNorte = await insert('entities', {
      name: 'Estudio Norte',
      type: 'client',
      contact: 'contacto@estudionorte.com.py',
    });
    const municipalidad = await insert('entities', {
      name: 'Municipalidad de Asunción',
      type: 'provider',
      contact: '+595 21 555 050',
    });

    // Credit cards (linked to bank tills)
    const visa = await insert('credit_cards', {
      till_id: itau,
      name: 'Visa Itaú',
      credit_limit: 15_000_000,
    });
    const master = await insert('credit_cards', {
      till_id: ueno,
      name: 'Mastercard Ueno',
      credit_limit: 8_000_000,
    });

    const addTx = (data) =>
      insert('transactions', {
        till_id: data.till_id,
        amount: data.amount,
        type: data.type,
        description: data.description ?? '',
        transaction_date: data.date,
        category_id: data.category_id ?? null,
        payment_method: data.payment_method ?? null,
        credit_card_id: data.credit_card_id ?? null,
        affects_balance: data.affects_balance ?? 1,
        transfer_id: data.transfer_id ?? null,
      });

    // Opening balances so every till starts positive.
    for (const [till, amount] of [
      [efectivo, 2_000_000],
      [itau, 8_000_000],
      [ueno, 3_000_000],
      [billetera, 1_000_000],
    ]) {
      await addTx({
        till_id: till,
        amount,
        type: 'ingreso',
        description: 'Saldo inicial',
        date: iso(addDays(base, -121)),
        category_id: cat('Ajustes', 'income'),
      });
    }

    // Deterministic pseudo-random generator so the demo looks the same.
    let seed = 987654321;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const between = (min, max, step = 1000) =>
      Math.round((min + rand() * (max - min)) / step) * step;

    // Everyday transactions for the last 120 days.
    for (let offset = 120; offset >= 0; offset -= 1) {
      const date = addDays(base, -offset);
      const dateStr = iso(date);
      const dayOfMonth = date.getDate();
      const weekday = date.getDay();

      if (dayOfMonth === 5) {
        await addTx({
          till_id: itau,
          amount: 15_000_000,
          type: 'ingreso',
          description: 'Sueldo mensual',
          date: dateStr,
          category_id: cat('Salario', 'income'),
        });
      }

      if (dayOfMonth === 18 && offset < 90) {
        await addTx({
          till_id: billetera,
          amount: between(1_500_000, 2_800_000, 50_000),
          type: 'ingreso',
          description: 'Proyecto freelance',
          date: dateStr,
          category_id: cat('Ventas', 'income'),
        });
      }

      if (weekday === 1 || weekday === 4) {
        await addTx({
          till_id: rand() < 0.7 ? itau : efectivo,
          amount: between(220_000, 620_000),
          type: 'egreso',
          description: 'Compras del súper',
          date: dateStr,
          category_id: cat('Alimentación', 'expense'),
        });
      }

      if (offset % 4 === 0) {
        await addTx({
          till_id: itau,
          amount: between(150_000, 280_000),
          type: 'egreso',
          description: 'Combustible',
          date: dateStr,
          category_id: cat('Combustible', 'expense'),
        });
      }

      if ((weekday === 5 || weekday === 6) && rand() < 0.65) {
        await addTx({
          till_id: rand() < 0.5 ? efectivo : itau,
          amount: between(120_000, 380_000),
          type: 'egreso',
          description: 'Salida con amigos',
          date: dateStr,
          category_id: cat('Ocio', 'expense'),
        });
      }

      if (dayOfMonth === 14) {
        await addTx({
          till_id: itau,
          amount: between(250_000, 450_000),
          type: 'egreso',
          description: 'Mantenimiento del hogar',
          date: dateStr,
          category_id: cat('Mantenimiento', 'expense'),
        });
      }

      if (dayOfMonth === 22) {
        await addTx({
          till_id: rand() < 0.5 ? itau : efectivo,
          amount: between(250_000, 700_000),
          type: 'egreso',
          description: 'Indumentaria',
          date: dateStr,
          category_id: cat('Vestimenta', 'expense'),
        });
      }

      if (offset % 45 === 7) {
        await addTx({
          till_id: itau,
          amount: between(180_000, 550_000),
          type: 'egreso',
          description: 'Consulta médica',
          date: dateStr,
          category_id: cat('Salud', 'expense'),
        });
      }
    }

    // Transfers: bank -> cash.
    for (const monthsAgo of [3, 2, 1]) {
      const date = iso(monthDate(base, -monthsAgo, 8));
      const transferId = `demo-transfer-${monthsAgo}`;
      await addTx({
        till_id: itau,
        amount: -2_000_000,
        type: 'transferencia',
        description: 'Retiro para efectivo',
        date,
        payment_method: 'transfer',
        transfer_id: transferId,
      });
      await addTx({
        till_id: efectivo,
        amount: 2_000_000,
        type: 'transferencia',
        description: 'Retiro para efectivo',
        date,
        payment_method: 'transfer',
        transfer_id: transferId,
      });
    }

    // Credit card purchases (do not affect the till balance directly).
    const cardPurchases = [];
    for (const [
      card,
      till,
      daysAgo,
      amount,
      category,
      description,
    ] of [
      [visa, itau, 98, 1_250_000, 'Alimentación', 'Supermercado con tarjeta'],
      [master, ueno, 90, 640_000, 'Vestimenta', 'Zapatillas'],
      [visa, itau, 78, 2_100_000, 'Mantenimiento', 'Repuestos del auto'],
      [master, ueno, 66, 480_000, 'Ocio', 'Cena aniversario'],
      [visa, itau, 54, 920_000, 'Salud', 'Estudios médicos'],
      [master, ueno, 42, 1_450_000, 'Alimentación', 'Compra mensual'],
      [visa, itau, 26, 380_000, 'Subscripciones', 'Servicios digitales'],
      [master, ueno, 12, 760_000, 'Combustible', 'Carga de combustible'],
    ]) {
      const id = await addTx({
        till_id: till,
        amount,
        type: 'egreso',
        description,
        date: iso(addDays(base, -daysAgo)),
        category_id: cat(category, 'expense'),
        payment_method: 'credit_card',
        credit_card_id: card,
        affects_balance: 0,
      });
      cardPurchases.push({ id, card, amount });
    }

    // Pay 70% of the Visa purchases, leaving both cards with pending debt.
    const visaPurchases = cardPurchases.filter(
      (purchase) => purchase.card === visa,
    );
    const visaTotal = visaPurchases.reduce(
      (sum, purchase) => sum + purchase.amount,
      0,
    );
    const capital = Math.round((visaTotal * 0.7) / 1000) * 1000;
    const paymentId = await addTx({
      till_id: itau,
      amount: capital,
      type: 'egreso',
      description: 'Pago tarjeta Visa',
      date: iso(addDays(base, -20)),
      category_id: cat('Pago de tarjetas', 'expense'),
      payment_method: 'transfer',
      credit_card_id: visa,
    });
    let leftToAllocate = capital;
    for (const purchase of visaPurchases) {
      if (leftToAllocate <= 0) break;
      const paid = Math.min(leftToAllocate, purchase.amount);
      await insert('credit_card_payment_items', {
        credit_card_id: visa,
        purchase_transaction_id: purchase.id,
        payment_transaction_id: paymentId,
        amount_paid: paid,
      });
      leftToAllocate -= paid;
    }

    const addPlan = async ({
      title,
      type = 'egreso',
      category,
      entity = null,
      till = null,
      amount,
      installments = null,
      startMonthsAgo = 0,
      day = 5,
      processed = 0,
      partial = null,
      reminder = false,
    }) => {
      const categoryType = type === 'ingreso' ? 'income' : 'expense';
      const categoryId = cat(category, categoryType);
      const start = monthDate(base, -startMonthsAgo, day);
      const planId = await insert('scheduled_plans', {
        title,
        type,
        category_id: categoryId,
        entity_id: entity,
        till_id: till,
        base_amount: amount,
        total_installments: installments,
        start_date: iso(start),
      });

      if (reminder || !installments) return planId;

      for (let index = 0; index < installments; index += 1) {
        const due = monthDate(start, index, day);
        const dueStr = iso(due);
        const isPartial = Boolean(partial && partial.index === index);
        const isProcessed = index < processed;
        let status = 'pending';
        let remaining = amount;
        let transactionId = null;

        if (isProcessed || isPartial) {
          const paid = isPartial ? partial.amount : amount;
          transactionId = await addTx({
            till_id: till,
            amount: paid,
            type,
            description: `${title} (cuota ${index + 1})`,
            date: dueStr,
            category_id: categoryId,
            affects_balance: 1,
          });
          status = isPartial ? 'partially_paid' : 'processed';
          remaining = isPartial ? amount - paid : 0;
        } else if (due < base) {
          status = 'overdue';
        }

        const occurrenceId = await insert('scheduled_occurrences', {
          plan_id: planId,
          installment_number: index + 1,
          due_date: dueStr,
          type,
          amount,
          remaining_amount: remaining,
          status,
          transaction_id: transactionId,
        });

        if (isPartial) {
          await insert('scheduled_payments_mapping', {
            occurrence_id: occurrenceId,
            transaction_id: transactionId,
            amount_paid: partial.amount,
            payment_date: dueStr,
          });
        }
      }

      return planId;
    };

    await addPlan({
      title: 'Alquiler departamento',
      category: 'Alquiler',
      entity: inmobiliaria,
      till: itau,
      amount: 3_200_000,
      installments: 12,
      startMonthsAgo: 5,
      day: 5,
      processed: 4,
    });
    await addPlan({
      title: 'Préstamo auto',
      category: 'Préstamos',
      entity: bancoAtlas,
      till: itau,
      amount: 1_800_000,
      installments: 24,
      startMonthsAgo: 4,
      day: 10,
      processed: 4,
      partial: { index: 4, amount: 1_100_000 },
    });
    await addPlan({
      title: 'Internet y celular',
      category: 'Servicios',
      entity: personal,
      till: itau,
      amount: 380_000,
      installments: 12,
      startMonthsAgo: 3,
      day: 12,
      processed: 4,
    });
    await addPlan({
      title: 'Seguro del auto',
      category: 'Servicios',
      entity: autoSur,
      till: itau,
      amount: 620_000,
      installments: 12,
      startMonthsAgo: 2,
      day: 15,
      processed: 3,
    });
    await addPlan({
      title: 'Netflix + Spotify',
      category: 'Subscripciones',
      entity: personal,
      till: itau,
      amount: 95_000,
      installments: 12,
      startMonthsAgo: 3,
      day: 20,
      processed: 4,
    });
    await addPlan({
      title: 'Alquiler cobrado',
      type: 'ingreso',
      category: 'Alquileres Cobrados',
      entity: estudioNorte,
      till: itau,
      amount: 1_800_000,
      installments: 6,
      startMonthsAgo: 2,
      day: 25,
      processed: 3,
    });

    // Reminders without occurrences (projections / variable commitments).
    await insert('scheduled_plans', {
      title: 'Gastos variables',
      type: 'egreso',
      category_id: cat('Otros', 'expense'),
      entity_id: null,
      till_id: efectivo,
      base_amount: 0,
      total_installments: null,
      start_date: iso(base),
    });
    await insert('scheduled_plans', {
      title: 'Patente 2027',
      type: 'egreso',
      category_id: cat('Impuestos', 'expense'),
      entity_id: municipalidad,
      till_id: itau,
      base_amount: 1_200_000,
      total_installments: null,
      start_date: iso(monthDate(base, 3, 15)),
    });

    const counts = {};
    for (const table of [
      'tills',
      'entities',
      'credit_cards',
      'transactions',
      'scheduled_plans',
      'scheduled_occurrences',
      'scheduled_payments_mapping',
      'credit_card_payment_items',
    ]) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${table}`,
      );
      counts[table] = result.rows[0].count;
    }
    return counts;
  });
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL no está definida.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const counts = await seedDemoDatabase(pool);
    console.log(
      '\n✓ Datos de demo cargados. Se borraron los datos de negocio previos.',
    );
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table}: ${count}`);
    }
  } catch (error) {
    console.error('✗ Error al cargar datos de demo:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
