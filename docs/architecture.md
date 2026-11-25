# Arquitectura y Reglas Anti-Alucinación Contable

## ¿Por qué no confiar solo en el LLM?

Los modelos multimodales (como Google Gemini) son excelentes para interpretar diseños complejos de facturas, tickets térmicos arrugados y PDFs multipágina, pero **los LLMs son probabilísticos**: pueden confundir un `8` con un `3`, omitir una línea o alucinar un subtotal.

Este proyecto aplica el patrón **AI Extraction + Deterministic Verification Gate**:
1. **IA Multimodal (Probabilística)**: Extrae los datos crudos con `temperature: 0` y `responseSchema` estricto, con prohibición explícita de "arreglar" números.
2. **Motor Contable en JavaScript (Determinístico)**: Verifica aritmética, consistencia interna y reglas de negocio antes de escribir en la base contable.
3. **Enrutamiento Dual (Clean vs Quarantine)**: Solo los comprobantes matemáticamente consistentes llegan a `Facturas_Validadas`; cualquier anomalía se desvía a `Revision_Manual` con trazabilidad completa del error.

---

## Matriz de Reglas de Validación (`src/validator.js`)

| Código de Error | Regla Aplicada | Umbral / Condición | Acción |
| :--- | :--- | :--- | :--- |
| `MISSING_VENDOR` | Proveedor obligatorio | Cadena vacía | `REVISION_MANUAL` |
| `INVALID_DATE` | Fecha de emisión válida | Formato `YYYY-MM-DD` real en calendario | `REVISION_MANUAL` |
| `FUTURE_DATE` | Fecha no futura | `fecha_emision <= hoy + 1 día` | `REVISION_MANUAL` |
| `INVALID_CURRENCY` | Moneda ISO-4217 | Exactamente 3 letras mayúsculas | `REVISION_MANUAL` |
| `MATH_TOTAL_MISMATCH` | Ecuación contable general | `|total - (subtotal - descuento + impuestos + propina)| <= 0.02` | `REVISION_MANUAL` |
| `LINE_ITEM_CALC_MISMATCH` | Consistencia por ítem | `|cantidad * precio_unitario - importe| <= 0.02` | `REVISION_MANUAL` |
| `LINE_ITEMS_SUBTOTAL_MISMATCH` | Suma de ítems vs subtotal | `|sum(items) - subtotal| <= max(0.02, n * 0.01)` (tope `0.05`) | `REVISION_MANUAL` |
| `ABNORMAL_TAX_RATE` | Sanidad de tasa impositiva | `impuestos / (subtotal - descuento) <= 35%` | `REVISION_MANUAL` |
| `LOW_CONFIDENCE` | Umbral de legibilidad IA | `confianza_extraccion >= 0.80` | `REVISION_MANUAL` |

---

## Prevención de Duplicados (`fingerprint`)

Cada comprobante genera una huella determinística a partir de:

```text
normalize(proveedor) | normalize(numero_comprobante) | fecha_emision | moneda | total.toFixed(2)
```

En Node.js (`src/validator.js`) se calcula con SHA-256 truncado a 16 caracteres hexadecimales; en el nodo Code de n8n se usa un hash determinístico de 64 bits sin dependencias externas. Google Sheets utiliza esta columna en modo `Append or Update` para garantizar idempotencia.

---

## Extensiones Futuras Sugeridas

- **Nuevos canales de ingesta**: Conectar un trigger de **Telegram Bot**, **Gmail** o **Google Drive** directamente al nodo `Preparar Archivo y Payload Gemini`.
- **Persistencia SQL**: Reemplazar o duplicar los nodos de Google Sheets por **Supabase / PostgreSQL** usando `fingerprint` como `UNIQUE INDEX`.
- **Notificaciones de Cuarentena**: Enviar alertas automáticas por Slack/Email/Telegram cada vez que una factura caiga en `Revision_Manual`.
