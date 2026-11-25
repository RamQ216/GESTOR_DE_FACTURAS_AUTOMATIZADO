#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { validateInvoice } from './validator.js';

const fileArg = process.argv[2];

if (!fileArg) {
  console.error('Uso: npm run validate -- <ruta-al-json-de-factura>');
  console.error('Ejemplo: npm run validate -- tests/fixtures/valid-invoice-mx.json');
  process.exit(1);
}

const fullPath = resolve(process.cwd(), fileArg);
const raw = readFileSync(fullPath, 'utf8');
const payload = JSON.parse(raw);

const result = validateInvoice(payload, { sourceFile: basename(fullPath) });

console.log(JSON.stringify(result, null, 2));
process.exit(result.es_valida ? 0 : 2);
