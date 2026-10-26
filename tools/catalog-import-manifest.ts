import fs from 'node:fs';
import path from 'node:path';
import { importSvg } from '../engine/svg-import.ts';
import { buildImportedModel } from '../engine/svg-import.ts';
import { addToCatalog } from '../engine/catalog-add.ts';

type ManifestRecord = {
  file?: string;
  id?: string;
  name?: string;
  view?: string;
  facing?: string;
  sizeM?: number;
  sizeAxis?: 'height' | 'width';
  tags?: string[];
  license?: string;
  author?: string;
  source?: string;
  url?: string;
  attribution?: boolean;
  colors?: 'keep' | 'mono' | 'slots';
};

const args = process.argv.slice(2);
const manifestPath = args[0];
if (!manifestPath) throw new Error('Usage: npm run catalog:import-manifest -- <manifest.json> [--dry] [--overwrite]');
const dry = args.includes('--dry');
const overwrite = args.includes('--overwrite');
const manifestDir = path.dirname(path.resolve(manifestPath));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestRecord[];
if (!Array.isArray(manifest)) throw new Error('Манифест должен быть массивом записей');

const rows: Array<{ id: string; result: string; warnings: string[] }> = [];
let okCount = 0, skipCount = 0, errCount = 0;

for (const rec of manifest) {
  const id = String(rec.id ?? '');
  const file = rec.file ? String(rec.file) : '';
  const fullPath = file ? path.resolve(manifestDir, file) : undefined;
  if (!file || !fullPath || !fs.existsSync(fullPath)) {
    rows.push({ id, result: 'пропущено: нет файла', warnings: [] });
    skipCount++;
    continue;
  }
  let svg: string;
  try { svg = fs.readFileSync(fullPath, 'utf8'); } catch (e) {
    rows.push({ id, result: `ошибка чтения: ${(e as Error).message}`, warnings: [] });
    errCount++;
    continue;
  }
  let res: any;
  try { res = importSvg(svg, { colors: rec.colors ?? 'keep', scaleHeight: 200 }); } catch (e) {
    rows.push({ id, result: `ошибка импорта SVG: ${(e as Error).message}`, warnings: [] });
    errCount++;
    continue;
  }
  const model = buildImportedModel(res, {
    id,
    name: rec.name ?? id,
    view: (rec.view ?? 'side') as 'side' | 'bottom' | 'front' | 'top' | 'three-quarter',
    facing: rec.facing as 'left' | 'right' | undefined,
    sizeM: rec.sizeM ?? 0,
    sizeAxis: rec.sizeAxis,
    tags: rec.tags ?? [],
    license: {
      name: rec.license ?? 'own',
      author: rec.author ?? '',
      source: rec.source ?? '',
      url: rec.url,
      attribution: rec.attribution ?? false,
    },
  });
  const r = addToCatalog(model, { id, overwrite, dry });
  if (!r.ok) {
    rows.push({ id, result: `ошибка каталога: ${r.errors.map((e: any) => e.message).join('; ')}`, warnings: res.warnings ?? [] });
    errCount++;
    continue;
  }
  rows.push({ id, result: dry ? 'проверено (dry-run, не записано)' : 'импортировано', warnings: res.warnings ?? [] });
  okCount++;
}

console.log('id | результат | предупреждения');
console.log('---|---|---');
for (const row of rows) {
  console.log(`${row.id} | ${row.result} | ${row.warnings.join('; ') || '-'}`);
}
console.log(`Итого: импортировано ${okCount}, пропущено ${skipCount}, ошибок ${errCount} из ${manifest.length}`);
