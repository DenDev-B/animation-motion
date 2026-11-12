// Пакетный импорт готового набора иконок формата Iconify (icons.json + info.json) в каталог моделей.
// Ничего не скачивает: файлы набора кладёт человек (например, из npm-пакета @iconify-json/fluent-emoji-flat).
// Список нужных рисунков, размеры в метрах и подписи лежат в catalog-sources/*.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImportedModel, importSvg } from '../engine/svg-import.ts';
import { validateAsset } from '../engine/validate.ts';
import type { CatalogAsset } from '../engine/schema.ts';

export interface IconifyIcon { body: string; width?: number; height?: number }
export interface IconifySet { icons: Record<string, IconifyIcon>; aliases?: Record<string, { parent: string }>; width?: number; height?: number }
export interface IconifyInfo { name: string; author?: { name?: string; url?: string }; license?: { title?: string; spdx?: string; url?: string } }
export interface ListItem { icon: string; id: string; name: string; tags: string[]; view: 'side' | 'bottom' | 'front' | 'top' | 'three-quarter'; sizeM: number; sizeAxis?: 'height' | 'width'; facing?: 'left' | 'right' }
export interface ImportReport { models: CatalogAsset[]; skipped: Array<{ id: string; reason: string }> }

/** Чистая часть: из набора, лицензии и списка получить модели. Без файлов и случайности. */
export function buildModelsFromIconify(set: IconifySet, info: IconifyInfo, list: ListItem[], existingIds: ReadonlySet<string> = new Set()): ImportReport {
  const models: CatalogAsset[] = [];
  const skipped: ImportReport['skipped'] = [];
  const license = info.license?.spdx ?? info.license?.title;
  if (!license) throw new Error('в info.json нет лицензии набора: без неё импорт запрещён');
  const seen = new Set<string>();
  for (const item of list) {
    if (existingIds.has(item.id) || seen.has(item.id)) { skipped.push({ id: item.id, reason: 'id уже есть в каталоге' }); continue; }
    const iconName = set.icons[item.icon] ? item.icon : set.aliases?.[item.icon]?.parent;
    const icon = iconName ? set.icons[iconName] : undefined;
    if (!icon) { skipped.push({ id: item.id, reason: `в наборе нет рисунка «${item.icon}»` }); continue; }
    if (/<(linearGradient|radialGradient|filter|mask|clipPath|image|text)\b/i.test(icon.body)) { skipped.push({ id: item.id, reason: 'рисунок использует градиент/маску/фильтр: импорт заменил бы их плоским цветом' }); continue; }
    const w = icon.width ?? set.width ?? 32;
    const h = icon.height ?? set.height ?? 32;
    let res: ReturnType<typeof importSvg>;
    try {
      res = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${icon.body}</svg>`, { colors: 'keep', scaleHeight: 200 });
    } catch (error) {
      skipped.push({ id: item.id, reason: `импорт SVG не удался: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (res.parts.length === 0) { skipped.push({ id: item.id, reason: 'после импорта нет ни одной части' }); continue; }
    const model = buildImportedModel(res, {
      id: item.id, name: item.name, view: item.view, facing: item.facing, sizeM: item.sizeM, sizeAxis: item.sizeAxis ?? 'height', tags: item.tags,
      license: { name: license, author: info.author?.name, source: `${info.name} (Iconify)`, url: info.license?.url ?? info.author?.url, attribution: true },
    });
    const check = validateAsset(model);
    if (!check.ok) { skipped.push({ id: item.id, reason: `модель не прошла проверку: ${check.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}` }); continue; }
    seen.add(item.id);
    models.push(model);
  }
  return { models, skipped };
}

/** Строка индекса каталога: те же поля, что у tools/catalog-index.ts и addToCatalog. */
export function indexEntry(model: CatalogAsset) {
  return { id: model.id, name: model.name, file: `${model.id}.json`, tags: model.meta?.tags ?? [], view: model.meta?.view, realSize: model.realSize ?? (model.meta as { realSize?: unknown } | undefined)?.realSize, license: model.meta?.license?.name, attribution: model.meta?.license?.attribution ?? false };
}

function main(): void {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const iconsPath = get('--icons');
  const infoPath = get('--info');
  const listPath = get('--list');
  if (!iconsPath || !infoPath || !listPath) throw new Error('Использование: node tools/import-iconify.ts --icons icons.json --info info.json --list catalog-sources/fluent-emoji.json [--dry]');
  const dry = args.includes('--dry');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.join(root, 'catalog');
  const set = JSON.parse(fs.readFileSync(iconsPath, 'utf8')) as IconifySet;
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8')) as IconifyInfo;
  const list = JSON.parse(fs.readFileSync(listPath, 'utf8')) as ListItem[];
  const idxPath = path.join(dir, 'index.json');
  const index = JSON.parse(fs.readFileSync(idxPath, 'utf8')) as Array<{ id: string }>;
  const existing = new Set(index.map((e) => e.id));
  const { models, skipped } = buildModelsFromIconify(set, info, list, existing);
  for (const s of skipped) console.log(`пропущено ${s.id}: ${s.reason}`);
  if (dry) { console.log(`import-iconify dry: добавилось бы ${models.length}, пропущено ${skipped.length}`); return; }
  fs.mkdirSync(dir, { recursive: true });
  for (const model of models) fs.writeFileSync(path.join(dir, `${model.id}.json`), JSON.stringify(model, null, 2) + '\n', 'utf8');
  const next = [...index, ...models.map(indexEntry)];
  fs.writeFileSync(idxPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(`import-iconify OK: добавлено ${models.length}, пропущено ${skipped.length}, в каталоге ${next.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
