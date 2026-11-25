import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInvoice, buildFingerprint } from '../src/validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

test('aprueba factura MXN válida con IVA 16% e ítems consistentes', () => {
  const fixture = loadFixture('valid-invoice-mx.json');
  const result = validateInvoice(fixture, { sourceFile: 'factura-cloud.pdf' });

  assert.equal(result.es_valida, true);
  assert.equal(result.estado_validacion, 'APROBADA');
  assert.equal(result.errores.length, 0);
  assert.equal(result.metricas_matematicas.total_calculado, 2900);
  assert.equal(result.metricas_matematicas.diferencia_matematica, 0);
  assert.equal(result.metricas_matematicas.tasa_impuesto_pct, 16);
  assert.equal(result.registro_sheets.archivo_origen, 'factura-cloud.pdf');
  assert.match(result.registro_sheets.id_registro, /^INV-[A-F0-9]{16}$/);
});

test('aprueba recibo USD válido con descuento y propina', () => {
  const fixture = loadFixture('valid-receipt-usd-discount.json');
  const result = validateInvoice(fixture);

  assert.equal(result.es_valida, true);
  assert.equal(result.estado_validacion, 'APROBADA');
  assert.equal(result.metricas_matematicas.total_calculado, 49.5);
  assert.equal(result.registro_sheets.moneda, 'USD');
});

test('detecta alucinación matemática cuando subtotal + impuestos != total', () => {
  const fixture = loadFixture('invalid-math-hallucination.json');
  const result = validateInvoice(fixture);

  assert.equal(result.es_valida, false);
  assert.equal(result.estado_validacion, 'REVISION_MANUAL');
  assert.ok(result.errores.some((e) => e.code === 'MATH_TOTAL_MISMATCH'));
  assert.equal(result.metricas_matematicas.total_calculado, 1392);
  assert.equal(result.metricas_matematicas.diferencia_matematica, 100);
});

test('detecta discrepancia cuando la suma de ítems no coincide con el subtotal', () => {
  const fixture = loadFixture('invalid-line-items-mismatch.json');
  const result = validateInvoice(fixture);

  assert.equal(result.es_valida, false);
  assert.equal(result.estado_validacion, 'REVISION_MANUAL');
  assert.ok(result.errores.some((e) => e.code === 'LINE_ITEMS_SUBTOTAL_MISMATCH'));
  assert.equal(result.metricas_matematicas.suma_items, 13500);
});

test('rechaza comprobante con campos obligatorios faltantes, fecha inválida, tasa anormal y baja confianza', () => {
  const fixture = loadFixture('missing-required-fields.json');
  const result = validateInvoice(fixture);

  assert.equal(result.es_valida, false);
  assert.equal(result.estado_validacion, 'REVISION_MANUAL');

  const codes = new Set(result.errores.map((e) => e.code));
  assert.ok(codes.has('MISSING_VENDOR'));
  assert.ok(codes.has('INVALID_DATE'));
  assert.ok(codes.has('INVALID_CURRENCY'));
  assert.ok(codes.has('ABNORMAL_TAX_RATE'));
  assert.ok(codes.has('LOW_CONFIDENCE'));
});

test('tolera diferencias de redondeo de 1 centavo (<= 0.02)', () => {
  const result = validateInvoice({
    proveedor: 'Supermercado Central',
    fecha_emision: '2026-10-10',
    moneda: 'EUR',
    subtotal: 100.00,
    descuento: 0,
    impuestos: 21.00,
    propina: 0,
    total: 121.01,
    confianza_extraccion: 0.95,
    items: []
  });

  assert.equal(result.es_valida, true);
  assert.equal(result.estado_validacion, 'APROBADA');
  assert.equal(result.metricas_matematicas.diferencia_matematica, 0.01);
});

test('genera fingerprint determinístico para prevención de duplicados', () => {
  const fp1 = buildFingerprint({
    proveedor: '  Servicios Cloud Latam  ',
    numero_comprobante: 'FAC-001',
    fecha_emision: '2026-10-15',
    moneda: 'mxn',
    total: 2900
  });
  const fp2 = buildFingerprint({
    proveedor: 'servicios cloud latam',
    numero_comprobante: 'fac-001',
    fecha_emision: '2026-10-15',
    moneda: 'MXN',
    total: 2900.0
  });

  assert.equal(fp1, fp2);
  assert.equal(fp1.length, 16);
});
