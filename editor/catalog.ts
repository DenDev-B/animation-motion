// Каталог редактора: чистая логика без DOM (импорт.meta.glob каталога остаётся в editor/main.ts).
import type { CatalogAsset, SceneObject, SceneV1 } from '../engine/schema.ts';
import { validateAsset, type ValidationError } from '../engine/validate.ts';
import { importSvg, buildImportedModel } from '../engine/svg-import.ts';
import { buildModelPrompt } from '../engine/ai-model.ts';
import type { ModelPromptOptions } from '../engine/ai-model.ts';
import type { CatalogEntry } from '../engine/ai-project.ts';
import type { MotionPreset } from '../engine/motion.ts';
import type { ProjectV1 } from '../engine/project.ts';

export const CATALOG_VIEW_ALL = 'все';

export interface CatalogRow {
  entry: CatalogEntry;
  asset: CatalogAsset | undefined;
}

export function filterCatalog(catalog: Record<string, CatalogAsset>, index: readonly CatalogEntry[], query: string, view: string): CatalogEntry[] {
  const q = (query ?? '').trim().toLowerCase();
  return index.filter((e) => {
    if (view && view !== CATALOG_VIEW_ALL && e.view !== view) return false;
    if (!q) return true;
    const haystack = `${e.id} ${e.name ?? ''} ${(e.tags ?? []).join(' ')}`.toLowerCase();
    return haystack.includes(q);
  }).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export function sizeTextM(entry: CatalogEntry): string {
  const rs = entry.realSize;
  if (rs?.heightM !== undefined) return `${rs.heightM} м`;
  if (rs?.widthM !== undefined) return `${rs.widthM} м`;
  return '—';
}

export function allProjectIds(project: Pick<ProjectV1, 'scenes'>): Set<string> {
  const ids = new Set<string>();
  for (const entry of project.scenes) {
    ids.add(entry.id);
    for (const layer of entry.scene.layers) {
      ids.add(layer.id);
      for (const object of layer.objects) ids.add(object.id);
    }
  }
  return ids;
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const id = `${base}_${n}`;
    if (!taken.has(id)) return id;
  }
  throw new Error('Не удалось подобрать уникальный id');
}

export function buildCatalogAssetObject(asset: CatalogAsset, scene: SceneV1, taken: ReadonlySet<string>): SceneObject {
  const id = uniqueId(`asset-${asset.id}`, taken);
  const params: Record<string, unknown> = {};
  if (scene.world?.unitsPerMeter && asset.realSize) {
    const sizeM = asset.realSize.heightM ?? asset.realSize.widthM;
    if (sizeM !== undefined) params.sizeM = sizeM;
  }
  return { id, name: asset.name, kind: 'asset', x: 0, y: 0, s: 1, asset: asset.id, params };
}

export interface SvgImportFields {
  id: string;
  name: string;
  view: 'side' | 'bottom' | 'front' | 'top' | 'three-quarter';
  sizeM: number;
  sizeAxis: 'height' | 'width';
  tags: string[];
  license: { name: string; author?: string; source?: string; url?: string; attribution: boolean };
}

export interface ImportResult {
  ok: boolean;
  asset?: CatalogAsset;
  errors: ValidationError[];
  warnings: string[];
}

export function buildSvgModel(svgText: string, fields: SvgImportFields): ImportResult {
  let imported;
  try { imported = importSvg(svgText); } catch (error) {
    return { ok: false, errors: [{ path: '', message: error instanceof Error ? error.message : String(error) }], warnings: [] };
  }
  const asset = buildImportedModel(imported, {
    id: fields.id, name: fields.name, view: fields.view, sizeM: fields.sizeM, sizeAxis: fields.sizeAxis,
    tags: fields.tags, license: fields.license,
  });
  const validation = validateAsset(asset);
  return { ok: validation.ok, asset: validation.ok ? asset : undefined, errors: validation.errors, warnings: imported.warnings };
}

export interface CheckModelJsonResult {
  ok: boolean;
  asset?: CatalogAsset;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export function checkModelJsonText(text: string): CheckModelJsonResult {
  let candidate: unknown;
  try { candidate = JSON.parse(text); } catch (error) {
    return { ok: false, errors: [{ path: '', message: `Не удалось разобрать JSON: ${error instanceof Error ? error.message : String(error)}` }], warnings: [] };
  }
  const validation = validateAsset(candidate);
  return { ok: validation.ok, asset: validation.ok ? (candidate as CatalogAsset) : undefined, errors: validation.errors, warnings: validation.warnings };
}

export function buildPreviewScene(asset: CatalogAsset, preset: 'none' | MotionPreset, duration = 8): SceneV1 {
  const motion = preset === 'none' ? undefined : { preset, speed: 1, amp: 1 };
  const sizeM = asset.realSize ? (asset.realSize.heightM ?? asset.realSize.widthM) : undefined;
  return {
    version: 1,
    title: `Превью: ${asset.name}`,
    duration,
    palette: { sky: ['#1a1a2e', '#4a4a6a'] },
    world: { unitsPerMeter: 16 },
    camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }] },
    assets: { [asset.id]: asset },
    layers: [{
      id: 'preview',
      name: 'Превью',
      depth: 1,
      visible: true,
      objects: [{ id: 'obj', name: asset.name, kind: 'asset', x: 0, y: 0, s: 1, asset: asset.id, params: { ...(sizeM ? { sizeM } : {}), ...(motion ? { motion } : {}) } }],
    }],
  };
}

export interface ModelCredit {
  id: string;
  name: string;
  author: string;
  license: string;
  source: string;
  own: boolean;
}

export function collectProjectCredits(project: Pick<ProjectV1, 'scenes'>, catalog: Record<string, CatalogAsset>): ModelCredit[] {
  const used = new Set<string>();
  for (const entry of project.scenes) {
    const scene = entry.scene;
    for (const layer of scene.layers) {
      for (const object of layer.objects) {
        if (object.kind === 'asset' && object.asset) used.add(object.asset);
      }
    }
  }
  const credits: ModelCredit[] = [];
  for (const id of used) {
    const a = catalog[id];
    if (!a) continue;
    const lic: { name?: string; author?: string; source?: string; url?: string; attribution?: boolean } = a.meta?.license ?? {};
    credits.push({ id: a.id, name: a.name, author: lic.author ?? (lic.name === 'own' ? 'проект' : ''), license: lic.name ?? 'unknown', source: lic.source ?? '', own: lic.name === 'own' });
  }
  const seen = new Set<string>();
  return credits.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export function formatCredits(credits: readonly ModelCredit[]): string {
  return credits.map((c) => `${c.id} — ${c.name}: ${c.own ? 'собственная модель' : `лицензия ${c.license}`}, автор ${c.author}, источник ${c.source}`).join('\n') || '(нет моделей каталога в проекте)';
}

export function modelPromptText(opts: ModelPromptOptions): string {
  return buildModelPrompt(opts);
}
