import fs from 'node:fs';
import path from 'node:path';
import { importSvg } from '../engine/svg-import.ts';
import { buildImportedModel } from '../engine/svg-import.ts';
import { addToCatalog } from '../engine/catalog-add.ts';

const args = process.argv.slice(2);
const input = args[0];
if (!input) throw new Error('Usage: npm run catalog:import-svg -- <file.svg> --id ... --view ... --size-m ... --license ...');
const svg = fs.readFileSync(path.resolve(input), 'utf8');
function get(flag: string) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
const id = get('--id');
const view = get('--view');
const sizeM = Number(get('--size-m'));
const license = get('--license');
if (!id || !view || !sizeM || !license) throw new Error('Required: --id, --view, --size-m, --license');
const res = importSvg(svg, { colors: (get('--colors') as any) ?? 'keep', scaleHeight: 200 });
  const model = buildImportedModel(res, {
    id,
    name: get('--name') ?? id,
    view: (get('--view') ?? 'side') as 'side' | 'bottom' | 'front' | 'top' | 'three-quarter',
    facing: get('--facing') as 'left' | 'right' | undefined,
  sizeM,
  sizeAxis: (get('--size-axis') ?? 'height') as 'height' | 'width',
  tags: (get('--tags') ?? '').split(',').filter(Boolean),
  license: {
    name: license,
    author: get('--author') ?? '',
    source: get('--source') ?? '',
    url: get('--url'),
    attribution: get('--attribution') === 'true',
  },
});
const r = addToCatalog(model, { id, dry: args.includes('--dry') });
if (!r.ok) { console.error('Ошибки:', JSON.stringify(r.errors)); process.exit(1); }
console.log(`import-svg OK id=${r.id}`);
if (res.warnings.length) console.log('warnings:', res.warnings.join('; '));
