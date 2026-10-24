import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSchemaMarkdown } from './schema-doc.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs', 'SCHEMA-v1.md');
fs.writeFileSync(target, renderSchemaMarkdown(), 'utf8');
console.log(`docs:schema OK ${target}`);
