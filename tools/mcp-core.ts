// Ядро MCP-сервера: чистые операции над файлами проекта, без протокола MCP (чтобы проверять без клиента).
import fs from 'fs';
import path from 'path';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { renderFrame, createRenderCache, validateAsset, validateScene, validateProject, projectFrameCount, locateFrame, composeFrame, type SceneV1, type ProjectV1, type CatalogAsset } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;

export interface Issue { path: string; message: string }
export type Parsed = { kind: 'project'; value: ProjectV1 } | { kind: 'scene'; value: SceneV1 };
export interface Source { file?: string; json?: unknown }

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function createCore(root: string) {
  const projectsDir = path.join(root, 'projects');
  const catalogDir = path.join(root, 'catalog');

  function loadCatalog(): Record<string, CatalogAsset> {
    const catalog: Record<string, CatalogAsset> = {};
    for (const f of fs.readdirSync(catalogDir)) {
      if (!f.endsWith('.json') || f === 'index.json') continue;
      const asset = JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')) as CatalogAsset;
      if (validateAsset(asset).ok) catalog[asset.id] = asset;
    }
    return catalog;
  }

  function projectFile(name: string): string {
    const base = name.replace(/\.project\.json$/, '').replace(/\.json$/, '');
    if (!NAME_RE.test(base)) throw new Error(`имя проекта «${name}» не подходит: только латиница, цифры, _ и -, до 64 символов`);
    return path.join(projectsDir, `${base}.project.json`);
  }

  function read(source: Source): unknown {
    if (source.json !== undefined) return typeof source.json === 'string' ? JSON.parse(source.json) : source.json;
    if (!source.file) throw new Error('укажите file (имя проекта в projects/) или json');
    const file = projectFile(source.file);
    if (!fs.existsSync(file)) throw new Error(`проекта «${source.file}» нет в projects/ (см. list_projects)`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function validate(source: Source): { ok: boolean; kind: 'project' | 'scene'; errors: Issue[]; warnings: Issue[]; parsed?: Parsed } {
    const raw = read(source);
    const catalogIds = Object.keys(loadCatalog());
    const isProject = raw !== null && typeof raw === 'object' && Array.isArray((raw as { scenes?: unknown }).scenes);
    const result = isProject ? validateProject(raw, { catalogIds }) : validateScene(raw, { catalogIds });
    const kind = isProject ? 'project' : 'scene';
    return { ok: result.ok, kind, errors: result.errors, warnings: result.warnings, parsed: result.ok ? ({ kind, value: raw } as Parsed) : undefined };
  }

  function render(source: Source, opts: { t?: number; format?: 'h' | 'v'; scale?: number }): { png: Buffer; w: number; h: number; t: number; duration: number } {
    const v = validate(source);
    if (!v.ok || !v.parsed) throw new Error(`не прошло проверку: ${v.errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    const catalog = loadCatalog();
    const format = opts.format ?? (v.parsed.kind === 'project' ? (v.parsed.value.format === '9:16' ? 'v' : 'h') : 'h');
    const scale = Math.min(1, Math.max(0.1, opts.scale ?? 0.5));
    const w = Math.round((format === 'h' ? 1920 : 1080) * scale);
    const h = Math.round((format === 'h' ? 1080 : 1920) * scale);
    const make = (cw: number, ch: number) => createCanvas(cw, ch);
    const cc = make as unknown as (w: number, h: number) => HTMLCanvasElement;
    const ctxOf = () => make(w, h).getContext('2d') as unknown as CanvasRenderingContext2D;
    const cache = createRenderCache();
    let out: CanvasRenderingContext2D;
    let duration: number;
    let t = Math.max(0, opts.t ?? 0);
    if (v.parsed.kind === 'scene') {
      const scene = v.parsed.value;
      duration = scene.duration;
      t = Math.min(t, duration);
      out = ctxOf();
      renderFrame(out, scene, t, { w, h }, { createCanvas: cc, catalog, cache });
    } else {
      const project = v.parsed.value;
      const fps = project.fps ?? 30;
      const frames = projectFrameCount({ ...project, fps });
      duration = frames / fps;
      const index = Math.min(frames - 1, Math.round(t * fps));
      t = index / fps;
      const loc = locateFrame({ ...project, fps }, index);
      const a = ctxOf();
      const first = loc.frames[0];
      renderFrame(a, project.scenes[first.sceneIndex].scene, first.t, { w, h }, { createCanvas: cc, catalog, cache });
      out = a;
      const second = loc.frames[1];
      if (second && loc.transition) {
        const b = ctxOf();
        renderFrame(b, project.scenes[second.sceneIndex].scene, second.t, { w, h }, { createCanvas: cc, catalog, cache });
        const o = ctxOf();
        const transition = project.scenes[second.sceneIndex].transition;
        composeFrame(o, a, b, loc.transition.type, loc.transition.progress, { w, h }, { color: transition.color, dir: transition.dir });
        out = o;
      }
    }
    const canvas = (out as unknown as { canvas: { toBuffer(type: string): Buffer } }).canvas;
    return { png: canvas.toBuffer('image/png'), w, h, t, duration };
  }

  function save(name: string, json: unknown, overwrite = false): { file: string; warnings: Issue[] } {
    const v = validate({ json });
    if (!v.ok) throw new Error(`не сохранено, ошибки: ${v.errors.slice(0, 8).map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    if (v.kind !== 'project') throw new Error('в projects/ сохраняется проект (объект со списком scenes); одиночную сцену оберните в проект');
    const file = projectFile(name);
    if (fs.existsSync(file) && !overwrite) throw new Error(`проект «${name}» уже есть; передайте overwrite: true, чтобы заменить`);
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(typeof json === 'string' ? JSON.parse(json) : json, null, 2)}\n`);
    return { file: path.relative(root, file), warnings: v.warnings };
  }

  function listProjects(): string[] {
    return fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir).filter((f) => f.endsWith('.project.json')).map((f) => f.replace(/\.project\.json$/, '')).sort() : [];
  }

  function listCatalog() {
    return Object.values(loadCatalog()).map((a) => ({ id: a.id, name: a.name, view: a.meta?.view, tags: a.meta?.tags ?? [], sizeM: a.realSize?.heightM ?? a.realSize?.widthM })).sort((x, y) => x.id.localeCompare(y.id));
  }

  function getSchema(): string {
    return fs.readFileSync(path.join(root, 'docs', 'SCHEMA-v1.md'), 'utf8');
  }

  function exportArgs(name: string, format: 'h' | 'v' | undefined, out?: string): string[] {
    const file = projectFile(name);
    if (!fs.existsSync(file)) throw new Error(`проекта «${name}» нет в projects/`);
    const args = ['tools/export.ts', '--project', path.relative(root, file)];
    if (format) args.push('--format', format);
    args.push('--out', out ?? path.join('out', 'mcp', `${path.basename(file).replace(/\.project\.json$/, '')}_${format ?? 'auto'}.mp4`), '--overwrite');
    return args;
  }

  return { loadCatalog, validate, render, save, listProjects, listCatalog, getSchema, exportArgs, projectFile };
}
