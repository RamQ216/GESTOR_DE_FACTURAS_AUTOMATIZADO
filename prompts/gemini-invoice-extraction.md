# Prompt y Esquema Estructurado para Google Gemini Multimodal

Este documento define el prompt y el `responseSchema` utilizados por el flujo de **n8n** para extraer datos contables desde imágenes (`JPG`, `PNG`, `WEBP`) o documentos `PDF` con **Google Gemini** (`gemini-3.6-flash` por defecto, configurable vía `GEMINI_MODEL`).

## Principios de Diseño Anti-Alucinaciones

1. **Temperatura `0`**: Minimiza variabilidad y fuerza extracción literal.
2. **Structured Outputs (`responseMimeType: "application/json"` + `responseSchema`)**: Garantiza que la IA devuelva únicamente JSON válido con los tipos esperados.
3. **Prohibición explícita de "corregir" totales**: Se instruye a la IA a transcribir exactamente los números impresos en el comprobante. Si el comprobante tiene un error de lectura o OCR, nuestro **Validador Contable en JavaScript** (`src/validator.js`) lo detectará matemáticamente y lo enviará a `Revision_Manual`.
4. **Auto-evaluación de confianza (`confianza_extraccion`)**: Si el comprobante está borroso, cortado o arrugado, la IA reporta un puntaje `< 0.80` para activar la revisión humana.

---

## System Instruction

```text
Eres un auditor contable experto en extracción estructurada de comprobantes fiscales (facturas, recibos, tickets y boletas).
Tu tarea es leer el archivo adjunto (imagen o PDF) y extraer únicamente los datos visibles con máxima precisión.

Reglas estrictas:
1. NO inventes ni recalcules valores faltantes para forzar que las sumas cuadren: extrae exactamente los números impresos en el documento.
2. Convierte todas las fechas al formato ISO YYYY-MM-DD.
3. Normaliza la moneda al código ISO-4217 de 3 letras (ej: USD, MXN, EUR, ARS, COP, CLP, PEN, BRL).
4. Usa números decimales puros con punto decimal (sin símbolos de moneda ni separadores de miles).
5. Si no existe descuento o propina en el comprobante, devuelve 0.
6. Si un campo de texto no aparece en el documento, devuelve cadena vacía "".
7. Asigna confianza_extraccion entre 0.0 y 1.0 reflejando la legibilidad real del documento.
```

---

## JSON Schema (`responseSchema`)

```json
{
  "type": "OBJECT",
  "properties": {
    "proveedor": { "type": "STRING", "description": "Nombre comercial o razón social del emisor" },
    "tax_id_proveedor": { "type": "STRING", "description": "RFC, CUIT, NIT, RUT, EIN o VAT ID del proveedor" },
    "tipo_comprobante": { "type": "STRING", "enum": ["factura", "recibo", "ticket", "boleta", "nota_credito", "comprobante"] },
    "numero_comprobante": { "type": "STRING", "description": "Folio o número identificador del comprobante" },
    "fecha_emision": { "type": "STRING", "description": "Fecha de emisión en formato YYYY-MM-DD" },
    "moneda": { "type": "STRING", "description": "Código ISO-4217 de 3 letras (USD, MXN, EUR, ARS, etc.)" },
    "subtotal": { "type": "NUMBER", "description": "Monto antes de impuestos y propinas" },
    "descuento": { "type": "NUMBER", "description": "Descuento aplicado como número positivo, 0 si no aplica" },
    "impuestos": { "type": "NUMBER", "description": "Suma total de impuestos (IVA, Sales Tax, etc.), 0 si no aplica" },
    "propina": { "type": "NUMBER", "description": "Propina o cargo de servicio, 0 si no aplica" },
    "total": { "type": "NUMBER", "description": "Monto total final impreso en el comprobante" },
    "confianza_extraccion": { "type": "NUMBER", "description": "Confianza de 0.0 a 1.0 sobre la legibilidad y precisión de lectura" },
    "items": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "descripcion": { "type": "STRING" },
          "cantidad": { "type": "NUMBER" },
          "precio_unitario": { "type": "NUMBER" },
          "importe": { "type": "NUMBER" }
        },
        "required": ["descripcion", "importe"]
      }
    }
  },
  "required": [
    "proveedor",
    "tipo_comprobante",
    "fecha_emision",
    "moneda",
    "subtotal",
    "descuento",
    "impuestos",
    "propina",
    "total",
    "confianza_extraccion",
    "items"
  ]
}
```
