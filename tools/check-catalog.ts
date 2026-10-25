import fs from 'fs';
import path from 'path';
const dir = path.join(process.cwd(), 'catalog');
const idxPath = path.join(dir, 'index.json');
if (!fs.existsSync(idxPath)) { console.error('catalog/index.json missing'); process.exit(1); }
const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
if (idx.length !== files.length) { console.error('index stale'); process.exit(1); }
console.log('check:catalog OK');
process.exit(0);
