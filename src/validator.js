import { createHash } from 'node:crypto';

export const DEFAULT_CONFIG = {
  mathTolerance: 0.02,
  minConfidence: 0.8,
  maxTaxRate: 0.35,
  allowedCurrencies: new Set([
    'USD', 'EUR', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL', 'UYU', 'PYG',
    'BOB', 'CRC', 'DOP', 'GTQ', 'HNL', 'NIO', 'PAB', 'VES', 'GBP', 'CAD'
  ])
};

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isValidIsoDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function buildFingerprint({ proveedor, numero_comprobante, fecha_emision, moneda, total }) {
  const raw = [
    normalizeText(proveedor).toLowerCase(),
    normalizeText(numero_comprobante).toLowerCase(),
    normalizeText(fecha_emision),
    normalizeText(moneda).toUpperCase(),
    Number.isFinite(total) ? round2(total).toFixed(2) : '0.00'
  ].join('|');

  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Valida y normaliza el JSON extraído por Gemini Multimodal.
 * Combina reglas de integridad de esquema + validación matemática determinística
 * para prevenir alucinaciones contables antes de persistir en Google Sheets.
 *
 * @param {object} extracted - Payload JSON devuelto por el modelo multimodal.
 * @param {object} [options] - Opciones de validación y metadatos del archivo.
 * @returns {object} Resultado con estado ('APROBADA' | 'REVISION_MANUAL'), errores, métricas y fila lista para Sheets.
 */
export function validateInvoice(extracted, options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options
  };

  const errors = [];
  const warnings = [];

  if (!extracted || typeof extracted !== 'object') {
    return {
      estado_validacion: 'REVISION_MANUAL',
      es_valida: false,
      errores: [{ code: 'INVALID_PAYLOAD', message: 'La respuesta de la IA no es un objeto JSON válido.' }],
      advertencias: [],
      metricas_matematicas: null,
      registro_sheets: null
    };
  }

  // 1. Normalización de campos base
  const proveedor = normalizeText(extracted.proveedor);
  const taxId = normalizeText(extracted.tax_id_proveedor || '');
  const tipoComprobante = normalizeText(extracted.tipo_comprobante || 'comprobante').toLowerCase();
  const numeroComprobante = normalizeText(extracted.numero_comprobante || '');
  const fechaEmision = normalizeText(extracted.fecha_emision);
  const moneda = normalizeText(extracted.moneda).toUpperCase();

  const subtotal = toFiniteNumber(extracted.subtotal);
  const descuento = toFiniteNumber(extracted.descuento, 0);
  const impuestos = toFiniteNumber(extracted.impuestos, 0);
  const propina = toFiniteNumber(extracted.propina, 0);
  const totalExtraido = toFiniteNumber(extracted.total);
  const confianza = toFiniteNumber(extracted.confianza_extraccion, 0);
  const items = Array.isArray(extracted.items) ? extracted.items : [];

  // 2. Validación de campos obligatorios
  if (!proveedor) {
    errors.push({ code: 'MISSING_VENDOR', message: 'Falta el nombre del proveedor.' });
  }

  if (!fechaEmision || !isValidIsoDate(fechaEmision)) {
    errors.push({
      code: 'INVALID_DATE',
      message: `Fecha de emisión inválida o faltante ("${fechaEmision || ''}"). Se requiere formato YYYY-MM-DD.`
    });
  } else {
    const parsedDate = new Date(`${fechaEmision}T00:00:00Z`);
    const maxAllowedDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (parsedDate > maxAllowedDate) {
      errors.push({
        code: 'FUTURE_DATE',
        message: `La fecha de emisión (${fechaEmision}) está en el futuro.`
      });
    }
  }

  if (!moneda || !/^[A-Z]{3}$/.test(moneda)) {
    errors.push({
      code: 'INVALID_CURRENCY',
      message: `Código de moneda inválido ("${moneda || ''}"). Debe ser ISO-4217 de 3 letras.`
    });
  } else if (!config.allowedCurrencies.has(moneda)) {
    warnings.push({
      code: 'UNCOMMON_CURRENCY',
      message: `Moneda "${moneda}" fuera de la lista habitual; verificar manualmente si aplica.`
    });
  }

  if (subtotal === null || subtotal < 0) {
    errors.push({ code: 'INVALID_SUBTOTAL', message: 'El subtotal es obligatorio y debe ser >= 0.' });
  }
  if (totalExtraido === null || totalExtraido < 0) {
    errors.push({ code: 'INVALID_TOTAL', message: 'El total es obligatorio y debe ser >= 0.' });
  }
  if (descuento < 0 || impuestos < 0 || propina < 0) {
    errors.push({
      code: 'NEGATIVE_COMPONENT',
      message: 'Descuento, impuestos y propina no pueden ser negativos.'
    });
  }

  // 3. Regla Matemática #1: Subtotal - Descuento + Impuestos + Propina = Total
  let totalCalculado = null;
  let diferenciaMatematica = null;

  if (subtotal !== null && totalExtraido !== null) {
    totalCalculado = round2(subtotal - descuento + impuestos + propina);
    diferenciaMatematica = round2(totalExtraido - totalCalculado);

    if (Math.abs(diferenciaMatematica) > config.mathTolerance) {
      errors.push({
        code: 'MATH_TOTAL_MISMATCH',
        message: `Discrepancia en total: extraído ${totalExtraido.toFixed(2)} vs calculado ${totalCalculado.toFixed(2)} (diferencia: ${diferenciaMatematica.toFixed(2)} ${moneda || ''}).`
      });
    }
  }

  // 4. Regla Matemática #2: Validación de ítems contra subtotal
  let sumaItems = null;
  if (items.length > 0) {
    let acumulado = 0;
    items.forEach((item, index) => {
      const cantidad = toFiniteNumber(item?.cantidad);
      const precioUnitario = toFiniteNumber(item?.precio_unitario);
      const importeLinea = toFiniteNumber(item?.importe);

      if (importeLinea === null || importeLinea < 0) {
        errors.push({
          code: 'INVALID_LINE_ITEM',
          message: `Ítem #${index + 1} sin importe numérico válido.`
        });
        return;
      }

      acumulado += importeLinea;

      if (cantidad !== null && precioUnitario !== null) {
        const esperadoLinea = round2(cantidad * precioUnitario);
        if (Math.abs(esperadoLinea - importeLinea) > config.mathTolerance) {
          errors.push({
            code: 'LINE_ITEM_CALC_MISMATCH',
            message: `Ítem #${index + 1} ("${normalizeText(item?.descripcion || 'Sin descripción')}"): ${cantidad} × ${precioUnitario} = ${esperadoLinea.toFixed(2)}, pero se extrajo ${importeLinea.toFixed(2)}.`
          });
        }
      }
    });

    sumaItems = round2(acumulado);
    const itemsTolerance = Math.min(0.05, Math.max(config.mathTolerance, items.length * 0.01));
    if (subtotal !== null && Math.abs(sumaItems - subtotal) > itemsTolerance) {
      errors.push({
        code: 'LINE_ITEMS_SUBTOTAL_MISMATCH',
        message: `La suma de ítems (${sumaItems.toFixed(2)}) no coincide con el subtotal extraído (${subtotal.toFixed(2)}).`
      });
    }
  }

  // 5. Regla Matemática #3: Sanidad de tasa impositiva
  let tasaImpuestoEfectiva = null;
  if (subtotal !== null && subtotal - descuento > 0 && impuestos > 0) {
    const baseImponible = subtotal - descuento;
    tasaImpuestoEfectiva = round2((impuestos / baseImponible) * 100);
    if (impuestos / baseImponible > config.maxTaxRate) {
      errors.push({
        code: 'ABNORMAL_TAX_RATE',
        message: `Tasa de impuesto efectiva sospechosa (${tasaImpuestoEfectiva}% > ${(config.maxTaxRate * 100).toFixed(0)}%). Posible alucinación de lectura.`
      });
    }
  }

  // 6. Regla de Confianza de IA
  if (confianza < config.minConfidence) {
    errors.push({
      code: 'LOW_CONFIDENCE',
      message: `Confianza de extracción baja (${(confianza * 100).toFixed(1)}% < ${(config.minConfidence * 100).toFixed(0)}%). Requiere revisión humana.`
    });
  }

  const esValida = errors.length === 0;
  const estadoValidacion = esValida ? 'APROBADA' : 'REVISION_MANUAL';
  const fingerprint = buildFingerprint({
    proveedor,
    numero_comprobante: numeroComprobante,
    fecha_emision: fechaEmision,
    moneda,
    total: totalExtraido ?? 0
  });

  const nowIso = options.processedAt || new Date().toISOString();
  const registroSheets = {
    id_registro: `INV-${fingerprint.toUpperCase()}`,
    fecha_procesamiento: nowIso,
    estado_validacion: estadoValidacion,
    proveedor: proveedor || 'DESCONOCIDO',
    tax_id_proveedor: taxId,
    tipo_comprobante: tipoComprobante,
    numero_comprobante: numeroComprobante,
    fecha_emision: fechaEmision,
    moneda: moneda,
    subtotal: subtotal !== null ? round2(subtotal) : '',
    descuento: round2(descuento),
    impuestos: round2(impuestos),
    propina: round2(propina),
    total_extraido: totalExtraido !== null ? round2(totalExtraido) : '',
    total_calculado: totalCalculado !== null ? totalCalculado : '',
    diferencia_matematica: diferenciaMatematica !== null ? diferenciaMatematica : '',
    tasa_impuesto_pct: tasaImpuestoEfectiva !== null ? tasaImpuestoEfectiva : 0,
    confianza_ia: round2(confianza),
    cantidad_items: items.length,
    errores_validacion: errors.map((e) => `[${e.code}] ${e.message}`).join(' | '),
    advertencias: warnings.map((w) => `[${w.code}] ${w.message}`).join(' | '),
    fingerprint,
    archivo_origen: options.sourceFile || ''
  };

  return {
    estado_validacion: estadoValidacion,
    es_valida: esValida,
    errores: errors,
    advertencias: warnings,
    metricas_matematicas: {
      subtotal,
      descuento,
      impuestos,
      propina,
      total_extraido: totalExtraido,
      total_calculado: totalCalculado,
      diferencia_matematica: diferenciaMatematica,
      suma_items: sumaItems,
      tasa_impuesto_pct: tasaImpuestoEfectiva
    },
    registro_sheets: registroSheets
  };
}
