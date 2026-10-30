import fs from 'fs';
const p = 'editor/catalog.ts';
if (!fs.existsSync(p)) { console.error('missing'); process.exit(1); }
console.log('check:catalog-ui OK');
process.exit(0);
