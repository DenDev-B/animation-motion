import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSchemaMarkdown } from './schema-doc.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs', 'SCHEMA-v1.md');
const expected = renderSchemaMarkdown();
if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) {
  console.error('check:docs FAIL — запустите npm run docs:schema');
  process.exit(1);
}
console.log('check:docs PASS');
