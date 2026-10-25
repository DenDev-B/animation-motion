import fs from 'node:fs';
import path from 'node:path';
import { extractJson } from '../engine/ai-io.ts';
import { addToCatalog } from '../engine/catalog-add.ts';

const args = process.argv.slice(2);
const input = args[0];
if (!input) throw new Error('Использование: npm run catalog:add -- <файл|-> [--id slug] [--overwrite] [--dry]');
let source = '';
if (input === '-') {
  source = fs.readFileSync(0, 'utf8');
} else {
  source = fs.readFileSync(path.resolve(input), 'utf8');
}
const model = extractJson(source);
const idIndex = args.indexOf('--id');
const id = idIndex >= 0 ? args[idIndex + 1] : undefined;
const overwrite = args.includes('--overwrite');
const dry = args.includes('--dry');
const res = addToCatalog(model, { id, overwrite, dry });
if (!res.ok) {
  console.error('Ошибки:');
  for (const e of res.errors) console.error(`- ${e.path}: ${e.message}`);
  process.exit(1);
}
console.log(`catalog:add OK id=${res.id} dry=${dry}`);
