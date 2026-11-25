# Plantilla de Google Sheets

Para que el workflow de **n8n** guarde los registros correctamente y evite duplicados usando `fingerprint`, crea una hoja de cálculo en Google Sheets con **dos pestañas exactas**:

1. `Facturas_Validadas`
2. `Revision_Manual`

---

## Pestaña 1: `Facturas_Validadas`

Copia y pega esta fila de encabezados en la **Fila 1** (columnas `A1:V1`):

```text
id_registro	fecha_procesamiento	estado_validacion	proveedor	tax_id_proveedor	tipo_comprobante	numero_comprobante	fecha_emision	moneda	subtotal	descuento	impuestos	propina	total_extraido	total_calculado	diferencia_matematica	tasa_impuesto_pct	confianza_ia	cantidad_items	advertencias	fingerprint	archivo_origen
```

> **Deduplicación automática:** El nodo `Guardar en Facturas_Validadas` usa la operación `Append or Update` tomando `fingerprint` como columna clave (`matchingColumns`). Si subes el mismo comprobante dos veces, actualiza el registro existente en lugar de duplicarlo.

---

## Pestaña 2: `Revision_Manual`

Copia y pega esta fila de encabezados en la **Fila 1** (columnas `A1:P1`):

```text
id_registro	fecha_procesamiento	estado_validacion	proveedor	numero_comprobante	fecha_emision	moneda	subtotal	impuestos	total_extraido	total_calculado	diferencia_matematica	confianza_ia	errores_validacion	fingerprint	archivo_origen
```

### ¿Qué llega a `Revision_Manual`?
Todo comprobante donde el motor determinístico detecte:
- Diferencia entre `total_extraido` y `subtotal - descuento + impuestos + propina` mayor a `0.02`.
- Suma de ítems distinta al `subtotal`.
- Tasa impositiva efectiva anómala (`> 35%`).
- Baja confianza de lectura de la IA (`< 0.80`).
- Campos obligatorios faltantes, fechas inválidas/futuras o moneda fuera de estándar ISO-4217.
