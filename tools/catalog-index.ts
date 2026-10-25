import fs from 'fs';
import path from 'path';
const dir = path.join(process.cwd(), 'catalog');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
const items: any[] = [];
for (const f of files) {
  const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  items.push({ id: a.id, name: a.name, file: f, tags: a.meta?.tags ?? [], view: a.meta?.view, realSize: a.realSize ?? a.meta?.realSize, license: a.meta?.license?.name, attribution: a.meta?.license?.attribution ?? false });
}
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(items, null, 2), 'utf-8');
console.log('catalog:index OK', items.length);
