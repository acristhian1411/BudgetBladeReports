import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { extractTextItems, getDocumentProxy } from 'unpdf';

/**
 * Bank-statement parser. The pipeline has two steps so the user can map
 * columns once per till and reuse that mapping (a "template"):
 *
 *   1. `extractGrid`  file (csv/xlsx/pdf) -> grid of cells (string[][]).
 *   2. `detectMapping` / `applyMapping`  grid -> { date, description, amount, type }.
 *
 * `amount` is always positive and `type` is 'ingreso' | 'egreso' (the mobile
 * schema stores the sign in `type`, never in the amount).
 */

const MONTHS_ES = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

const isoDate = (y, m, d) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Parses a date token to 'YYYY-MM-DD', or null when unrecognized. */
export function parseDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoDate(m[1], m[2], m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return isoDate(m[3], m[2], m[1]); // DD/MM/YYYY

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/);
  if (m) return isoDate(`20${m[3]}`, m[2], m[1]);

  m = s.match(
    /^(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s*,?\s*(\d{4})/i,
  );
  if (m) return isoDate(m[3], MONTHS_ES[m[2].toLowerCase().slice(0, 3)], m[1]);

  return null;
}

/**
 * Parses a monetary amount to a number. Handles negative signs, parentheses,
 * and Latin-American ("1.234,56") vs US ("1,234.56") separators, plus
 * thousands-only groups ("3.500.000").
 */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  }

  const commaCount = (s.match(/,/g) || []).length;
  const dotCount = (s.match(/\./g) || []).length;
  let decimalSep = null;

  if (commaCount > 0 && dotCount > 0) {
    decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  } else if (commaCount > 1) {
    s = s.replace(/,/g, '');
  } else if (dotCount > 1) {
    s = s.replace(/\./g, '');
  } else if (commaCount === 1 || dotCount === 1) {
    const sep = commaCount === 1 ? ',' : '.';
    const decimals = s.length - s.lastIndexOf(sep) - 1;
    if (decimals === 3) {
      s = s.replace(sep, '');
    } else {
      decimalSep = sep;
    }
  }

  if (decimalSep) {
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandsSep).join('').split(decimalSep).join('.');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

const clean = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim();

export function detectFormat(filename, mimetype) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.csv') || mimetype === 'text/csv') return 'csv';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
  if (name.endsWith('.pdf') || mimetype === 'application/pdf') return 'pdf';
  return null;
}

// ---------------------------------------------------------------------------
// Step 1: extraction -> grid
// ---------------------------------------------------------------------------

const cellToText = (value) => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (typeof value.result !== 'undefined') return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if (typeof value.text === 'string') return value.text;
    return '';
  }
  return String(value);
};

const detectDelimiter = (text) => {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim());
  if (!firstLine) return ',';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  if (semis >= commas && semis > 0) return ';';
  return ',';
};

const csvToMatrix = (buffer) => {
  const text = buffer.toString('utf-8');
  const delimiter = detectDelimiter(text);
  return parse(text, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }).map((row) => row.map(cellToText));
};

const xlsxToMatrix = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const matrix = [];
  sheet.eachRow((row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (cells.length < colNumber - 1) cells.push('');
      cells.push(cellToText(cell.value));
    });
    if (cells.some((c) => String(c).trim() !== '')) matrix.push(cells);
  });
  return matrix;
};

// pdf.js merges words within a cell and inserts a space item between columns,
// so each non-space item is already one cell; column order is its x position.
const itemsToLines = (items) => {
  const sorted = [...items]
    .filter((item) => item.str && item.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - item.y) <= 3) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
};

const lineText = (line) => line.items.map((i) => i.str).join(' ');

const HEADER_Y_RANGE = 24;
const HEADER_X_RANGE = 24;
const DESCRIPTION_CONTINUATION_Y_RANGE = 24;

const isHeaderBand = (lines) => {
  const text = lines.map(lineText).join(' ');
  return /fecha|date/i.test(text) &&
    /saldo|importe|monto|debito|credito/i.test(text) &&
    /descrip|concepto|detalle/i.test(text);
};

// Bank PDFs often wrap multi-line column labels (e.g. "Fecha" / "Operación")
// across separate baselines, so detect a compact band instead of one line.
const findHeaderBand = (lines) => {
  for (let start = 0; start < lines.length; start += 1) {
    for (let end = start; end < Math.min(lines.length, start + 4); end += 1) {
      if (lines[start].y - lines[end].y > HEADER_Y_RANGE) break;
      const band = lines.slice(start, end + 1);
      if (!isHeaderBand(band)) continue;

      // Include nearby wrapped header labels such as "Operación" / "Proceso",
      // but stop before the first dated movement row.
      let fullEnd = end;
      while (
        fullEnd + 1 < lines.length &&
        lines[start].y - lines[fullEnd + 1].y <= HEADER_Y_RANGE &&
        !lines[fullEnd + 1].items.some((item) => parseDate(item.str))
      ) {
        fullEnd += 1;
      }
      return { start, end: fullEnd, lines: lines.slice(start, fullEnd + 1) };
    }
  }
  return null;
};

const nearestAnchor = (anchors, x) => {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < anchors.length; i += 1) {
    const dist = Math.abs(anchors[i] - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
};

const makeHeaderColumns = (headerLines) => {
  const items = headerLines.flatMap((line) => line.items).sort((a, b) => a.x - b.x);
  const columns = [];

  for (const item of items) {
    const col = columns[columns.length - 1];
    if (col && item.x - col.anchor <= HEADER_X_RANGE) {
      col.items.push(item);
    } else {
      columns.push({ anchor: item.x, items: [item] });
    }
  }

  return columns.map((col) => ({
    anchor: col.anchor,
    header: headerLines
      .flatMap((line) => line.items)
      .filter((item) => col.items.includes(item))
      .map((item) => item.str)
      .join(' '),
  }));
};

const isDateCell = (cell) => parseDate(cell) != null;

const pdfToGrid = async (buffer) => {
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { items: pages } = await extractTextItems(doc);

  const lines = [];
  for (const pageItems of pages) lines.push(...itemsToLines(pageItems));

  const headerBand = findHeaderBand(lines);
  if (!headerBand) {
    return lines.map((line) => [lineText(line)]);
  }

  const columns = makeHeaderColumns(headerBand.lines);
  const anchors = columns.map((col) => col.anchor);
  const descriptionCol = columns.findIndex((col) => /descrip|concepto|detalle/i.test(col.header));
  const grid = [columns.map((col) => clean(col.header))];
  let lastTransactionIndex = -1;
  let lastTransactionY = null;

  for (let i = headerBand.end + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const row = anchors.map(() => '');
    for (const item of line.items) {
      const col = nearestAnchor(anchors, item.x);
      row[col] = row[col] ? `${row[col]} ${item.str}` : item.str;
    }

    if (row.some(isDateCell)) {
      grid.push(row.map(clean));
      lastTransactionIndex = grid.length - 1;
      lastTransactionY = line.y;
      continue;
    }

    // Wrapped merchant names (and similar description continuations) belong
    // to the preceding transaction only when they're close on the page.
    if (
      lastTransactionIndex >= 0 &&
      lastTransactionY - line.y <= DESCRIPTION_CONTINUATION_Y_RANGE &&
      descriptionCol >= 0 &&
      row[descriptionCol]
    ) {
      grid[lastTransactionIndex][descriptionCol] = clean(
        `${grid[lastTransactionIndex][descriptionCol]} ${row[descriptionCol]}`,
      );
      lastTransactionY = line.y;
    }
  }
  return grid;
};

export async function extractGrid(buffer, format) {
  if (format === 'csv') return csvToMatrix(buffer);
  if (format === 'xlsx') return await xlsxToMatrix(buffer);
  if (format === 'pdf') return await pdfToGrid(buffer);
  throw new Error('Unsupported file format');
}

// ---------------------------------------------------------------------------
// Step 2: mapping (detect + apply)
// ---------------------------------------------------------------------------

const H = {
  date: /fecha|date|\bfch\b/i,
  desc: /descri|concepto|detalle|memo|glosa|movim|narrativ|observacion/i,
  egreso: /debito|egreso|cargo|debe|retiro|salida|pagado/i,
  ingreso: /credito|ingreso|abono|haber|deposito|entrada|cobrado/i,
  amount: /importe|monto|amount|valor/i,
  saldo: /saldo|balance/i,
};

const matches = (cell, pattern) => pattern.test(String(cell ?? ''));

const findHeaderRow = (grid) => {
  for (let i = 0; i < Math.min(grid.length, 30); i += 1) {
    const cells = grid[i];
    const hasDate = cells.some((c) => matches(c, H.date));
    const hasMoney = cells.some(
      (c) =>
        matches(c, H.egreso) ||
        matches(c, H.ingreso) ||
        matches(c, H.amount) ||
        matches(c, H.saldo),
    );
    if (hasDate && hasMoney) return i;
  }
  return -1;
};

const firstIndex = (cells, pattern) => cells.findIndex((c) => matches(c, pattern));

/** Infers a mapping from cell content when no recognizable header exists. */
const detectByContent = (grid) => {
  const numCols = Math.max(0, ...grid.map((r) => r.length));
  if (numCols === 0) return null;

  const stats = [];
  for (let c = 0; c < numCols; c += 1) {
    let dates = 0;
    let amounts = 0;
    let n = 0;
    for (let r = 0; r < Math.min(grid.length, 30); r += 1) {
      const cell = String(grid[r]?.[c] ?? '').trim();
      if (!cell) continue;
      n += 1;
      if (parseDate(cell)) dates += 1;
      else if (parseAmount(cell) != null) amounts += 1;
    }
    stats.push({ c, dates, amounts, n });
  }

  const dateCol = stats.find((s) => s.n > 0 && s.dates / s.n >= 0.6)?.c;
  const amountCols = stats
    .filter((s) => s.n > 0 && s.amounts / s.n >= 0.6)
    .map((s) => s.c);
  const descCol = stats.find(
    (s) => s.n > 0 && s.dates / s.n < 0.5 && s.amounts / s.n < 0.5,
  )?.c;

  if (dateCol == null || amountCols.length === 0) return null;

  const mapping = {
    header_row: -1,
    date: { column: dateCol, format: guessDateFormat(grid, -1, dateCol) },
  };
  if (descCol != null) mapping.description = { columns: [descCol] };
  if (amountCols.length >= 2) {
    mapping.amount = { mode: 'split', egreso: amountCols[0], ingreso: amountCols[1] };
  } else {
    mapping.amount = { mode: 'signed', column: amountCols[0] };
  }
  return mapping;
};

/** Returns a best-effort mapping proposal for a grid (or null). */
export function detectMapping(grid) {
  if (!grid.length) return null;
  const headerRow = findHeaderRow(grid);
  if (headerRow === -1) return detectByContent(grid);

  const headers = grid[headerRow];
  const dateCol = firstIndex(headers, H.date);
  const descCol = firstIndex(headers, H.desc);
  const egresoCol = firstIndex(headers, H.egreso);
  const ingresoCol = firstIndex(headers, H.ingreso);
  const amountCol = firstIndex(headers, H.amount);

  const mapping = { header_row: headerRow };

  if (dateCol !== -1) {
    mapping.date = { column: dateCol, format: guessDateFormat(grid, headerRow, dateCol) };
  }
  if (descCol !== -1) {
    mapping.description = { columns: [descCol] };
  }

  if (egresoCol !== -1 && ingresoCol !== -1) {
    mapping.amount = { mode: 'split', egreso: egresoCol, ingreso: ingresoCol };
  } else if (amountCol !== -1) {
    mapping.amount = { mode: 'signed', column: amountCol };
  } else {
    return detectByContent(grid);
  }

  return mapping;
}

const guessDateFormat = (grid, headerRow, col) => {
  for (let r = headerRow + 1; r < Math.min(grid.length, headerRow + 20); r += 1) {
    const cell = grid[r]?.[col];
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(String(cell ?? ''))) return 'YYYY-MM-DD';
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(String(cell ?? ''))) return 'DD/MM/YYYY';
  }
  return 'DD/MM/YYYY';
};

/** Applies a mapping to a grid, returning normalized statement rows. */
export function applyMapping(grid, mapping) {
  if (!mapping?.date || !mapping?.amount) return [];
  const rows = [];
  const start = (mapping.header_row ?? -1) + 1;

  for (let r = start; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const date = parseDate(cells[mapping.date.column]);
    if (!date) continue;

    const description = (mapping.description?.columns ?? [])
      .map((c) => clean(cells[c]))
      .filter(Boolean)
      .join(' ');

    let amount = null;
    let type = null;
    if (mapping.amount.mode === 'split') {
      const egreso = parseAmount(cells[mapping.amount.egreso]);
      const ingreso = parseAmount(cells[mapping.amount.ingreso]);
      if (egreso != null && Math.abs(egreso) > 0) {
        amount = Math.abs(egreso);
        type = 'egreso';
      } else if (ingreso != null && Math.abs(ingreso) > 0) {
        amount = Math.abs(ingreso);
        type = 'ingreso';
      }
    } else {
      const value = parseAmount(cells[mapping.amount.column]);
      if (value != null) {
        amount = Math.abs(value);
        type = value < 0 ? 'egreso' : 'ingreso';
      }
    }

    if (amount == null || !Number.isFinite(amount)) continue;
    rows.push({ date, description, amount, type });
  }

  return rows;
}
