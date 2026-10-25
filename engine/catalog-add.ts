import fs from 'node:fs';
import path from 'node:path';
import { validateAsset } from './validate.ts';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

export function addToCatalog(model: any, opts: { id?: string; overwrite?: boolean; dry?: boolean } = {}): { ok: boolean; id: string; errors: any[]; warnings: any[] } {
  const result = validateAsset(model);
  if (!result.ok) return { ok: false, id: '', errors: result.errors, warnings: result.warnings };
  const baseId = opts.id ? slugify(opts.id) : slugify(model.id || model.name || 'model');
  const dir = path.join(process.cwd(), 'catalog');
  let id = baseId;
  if (!opts.overwrite && fs.existsSync(path.join(dir, id + '.json'))) {
    id = baseId + '_2';
    while (fs.existsSync(path.join(dir, id + '.json'))) id = baseId + '_' + Math.floor(Math.random()*1000);
  }
  if (opts.dry) return { ok: true, id, errors: [], warnings: result.warnings };
  const out = { ...model, id };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(out, null, 2), 'utf8');
  // rebuild index
  // simple index update
  const idxPath = path.join(dir, 'index.json');
  let idx: any[] = [];
  if (fs.existsSync(idxPath)) idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  idx = idx.filter((x) => x.id !== id);
  idx.push({ id, name: out.name, file: id + '.json', tags: out.meta?.tags ?? [], view: out.meta?.view, realSize: out.realSize ?? out.meta?.realSize, license: out.meta?.license?.name, attribution: out.meta?.license?.attribution ?? false });
  fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2), 'utf8');
  return { ok: true, id, errors: [], warnings: result.warnings };
}
