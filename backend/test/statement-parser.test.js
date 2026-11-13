import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount,
  parseDate,
  detectFormat,
  extractGrid,
  detectMapping,
  applyMapping,
} from '../src/services/statementParser.js';

test('parseAmount handles Latin-American, US, and thousands-only formats', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('3.500.000'), 3500000);
  assert.equal(parseAmount('1234,56'), 1234.56);
  assert.equal(parseAmount('1234.56'), 1234.56);
  assert.equal(parseAmount('1.234'), 1234);
  assert.equal(parseAmount('500'), 500);
});

test('parseAmount handles negative signs and parentheses', () => {
  assert.equal(parseAmount('-25.000'), -25000);
  assert.equal(parseAmount('(250.000)'), -250000);
  assert.equal(parseAmount('250.000-'), -250000);
  assert.equal(parseAmount('1.000,00'), 1000);
});

test('parseAmount returns null for non-numeric input', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(null), null);
});

test('parseDate normalizes common date formats', () => {
  assert.equal(parseDate('01/11/2024'), '2024-11-01');
  assert.equal(parseDate('2024-11-01'), '2024-11-01');
  assert.equal(parseDate('9/11/2026'), '2026-11-09');
  assert.equal(parseDate('garbage'), null);
});

test('detectFormat maps extensions and mimetypes', () => {
  assert.equal(detectFormat('extracto.csv', 'text/csv'), 'csv');
  assert.equal(detectFormat('extracto.xlsx', undefined), 'xlsx');
  assert.equal(detectFormat('extracto.pdf', 'application/pdf'), 'pdf');
  assert.equal(detectFormat('extracto.doc', undefined), null);
});

const BANK_CSV =
  'Fecha Operación;Fecha Proceso;Descripción;Referencia;Importe;Saldo\n' +
  '9/11/2026;09/11/2026;Transf. SPI ACOSTA ESCALAN;0911267780;5.000;20.769\n' +
  '09/11/2026;09/11/2026;Transf. Recibida ACOSTA ESC;3132600010;20.000;15.769\n' +
  '09/11/2026;09/11/2026;Compra Negocio PIK*EUROSU;5855175948;-130.000;-4.231\n';

test('extractGrid + detectMapping + applyMapping on a bank CSV', async () => {
  const grid = await extractGrid(Buffer.from(BANK_CSV, 'utf-8'), 'csv');
  const mapping = detectMapping(grid);
  assert.deepEqual(mapping, {
    header_row: 0,
    date: { column: 0, format: 'DD/MM/YYYY' },
    description: { columns: [2] },
    amount: { mode: 'signed', column: 4 },
  });

  const rows = applyMapping(grid, mapping);
  assert.deepEqual(rows, [
    { date: '2026-11-09', description: 'Transf. SPI ACOSTA ESCALAN', amount: 5000, type: 'ingreso' },
    { date: '2026-11-09', description: 'Transf. Recibida ACOSTA ESC', amount: 20000, type: 'ingreso' },
    { date: '2026-11-09', description: 'Compra Negocio PIK*EUROSU', amount: 130000, type: 'egreso' },
  ]);
});

test('applyMapping supports split debit/credit columns', () => {
  const grid = [
    ['Fecha', 'Descripcion', 'Debito', 'Credito'],
    ['01/11/2024', 'Supermercado X', '150.000', ''],
    ['02/11/2024', 'Sueldo', '', '3.500.000'],
  ];
  const mapping = {
    header_row: 0,
    date: { column: 0, format: 'DD/MM/YYYY' },
    description: { columns: [1] },
    amount: { mode: 'split', egreso: 2, ingreso: 3 },
  };
  assert.deepEqual(applyMapping(grid, mapping), [
    { date: '2024-11-01', description: 'Supermercado X', amount: 150000, type: 'egreso' },
    { date: '2024-11-02', description: 'Sueldo', amount: 3500000, type: 'ingreso' },
  ]);
});

// Minimal single-page PDF with positioned text (mimics a fixed-column table).
function makePdf(rows) {
  let stream = '';
  for (const [x, y, text] of rows.flat()) {
    const escaped = text.replace(/([()\\])/g, '\\$1');
    stream += `BT /F1 10 Tf ${x} ${y} Td (${escaped}) Tj ET\n`;
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

test('extractGrid reconstructs a PDF table and merges wrapped descriptions', async () => {
  const pdf = makePdf([
    [[100, 780, 'Fecha: 10/11/2026']],
    [[250, 750, 'Movimientos De Cuenta...']],
    [
      [42, 615, 'Fecha'], [145, 615, 'Fecha'], [286, 611, 'Descripcion'],
      [435, 611, 'Referencia'], [566, 609, 'Importe'], [661, 609, 'Saldo'],
    ],
    [[42, 600, 'Operacion'], [145, 600, 'Proceso']],
    [
      [46, 569, '09/11/2026'], [149, 569, '09/11/2026'], [248, 569, 'Transf. SPI ACOSTA ESCALAN'],
      [404, 569, '09112677'], [583, 569, '5.000'], [681, 569, '20.769'],
    ],
    [[269, 555, 'CRISTHIAN AGUSTIN']],
    [
      [46, 514, '09/11/2026'], [149, 514, '09/11/2026'], [248, 514, 'Compra Negocio PIK*EUROSU'],
      [435, 514, '5855175948'], [569, 514, '-130.000'], [683, 514, '-4.231'],
    ],
    [[600, 300, 'Página 1 de 1']],
  ]);

  const grid = await extractGrid(pdf, 'pdf');
  assert.deepEqual(grid[0], ['Fecha Operacion', 'Fecha Proceso', 'Descripcion', 'Referencia', 'Importe', 'Saldo']);
  const rows = applyMapping(grid, detectMapping(grid));

  assert.deepEqual(rows, [
    { date: '2026-11-09', description: 'Transf. SPI ACOSTA ESCALAN CRISTHIAN AGUSTIN', amount: 5000, type: 'ingreso' },
    { date: '2026-11-09', description: 'Compra Negocio PIK*EUROSU', amount: 130000, type: 'egreso' },
  ]);
});
