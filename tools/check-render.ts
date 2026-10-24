import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
(globalThis as any).Path2D = Path2D;
import { renderFrame, createRenderCache, validateScene, type SceneV1, type CatalogAsset } from '../engine/index.ts';
import { spawn } from 'child_process';
import http from 'http';
import { spawnPreview, waitForServer, launchSafeChrome, assertPortFree } from './browser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4173;
const URL = `http://localhost:${PORT}/?selftest`;

const IS_CHROME = process.env.npm_lifecycle_event === 'check:render:chrome';
const ALLOW_CHROME = process.env.ALLOW_CHROME === '1';

function log(m: string) { process.stdout.write(m + '\n'); }

const scene = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'whale-demo.json'), 'utf8')) as unknown as SceneV1;
const catalogJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog', 'whale.json'), 'utf8')) as unknown as CatalogAsset;
const catalog: Record<string, CatalogAsset> = { whale: catalogJson };
const cache = createRenderCache();

function renderToImageData(w: number, h: number, t: number, target: SceneV1 = scene): ImageData {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(ctx, target, t, { w, h }, { createCanvas: ((w2: number, h2: number) => createCanvas(w2, h2)) as unknown as (w: number, h: number) => HTMLCanvasElement, catalog, cache });
  return ctx.getImageData(0, 0, w, h);
}

function shapeEquivalence(): string | null {
  const source = scene.layers.flatMap((layer) => layer.objects).find((object) => object.kind === 'asset');
  if (!source) return 'в whale-demo нет объекта kind asset';
  const shapeScene = structuredClone(scene);
  const shapeObject = shapeScene.layers.flatMap((layer) => layer.objects).find((object) => object.id === source.id);
  if (!shapeObject) return `не найден объект ${source.id}`;
  shapeObject.kind = 'shape';
  shapeObject.params = { model: structuredClone(catalogJson) };
  const cases: Array<[string, number, number]> = [['16:9', 1280, 720], ['9:16', 720, 1280]];
  for (const [label, w, h] of cases) for (const t of [0, 6, 12]) {
    if (!equal(renderToImageData(w, h, t), renderToImageData(w, h, t, shapeScene))) return `${label} t=${t}`;
  }
  return null;
}

function equal(a: ImageData, b: ImageData): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

function renderSceneToImageData(target: SceneV1, w: number, h: number, t: number, targetCache: ReturnType<typeof createRenderCache>): ImageData {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(ctx, target, t, { w, h }, { createCanvas: ((w2: number, h2: number) => createCanvas(w2, h2)) as unknown as (w: number, h: number) => HTMLCanvasElement, catalog, cache: targetCache });
  return ctx.getImageData(0, 0, w, h);
}

function backgroundChecks(): string | null {
  const cases: Array<[string, number, number]> = [['16:9', 1280, 720], ['9:16', 720, 1280]];
  for (const file of ['bg-night.json', 'bg-day.json']) {
    const target = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', file), 'utf8')) as unknown as SceneV1;
    const validation = validateScene(target, { catalogIds: ['whale'] });
    if (!validation.ok) return `${file}: ${validation.errors[0]?.message ?? 'не проходит валидацию'}`;
    for (const [label, w, h] of cases) {
      if (!equal(renderSceneToImageData(target, w, h, 5, createRenderCache()), renderSceneToImageData(target, w, h, 5, createRenderCache()))) return `${file} ${label}: кадр t=5 невоспроизводим`;
      const ordered = createRenderCache();
      const before = renderSceneToImageData(target, w, h, 5, ordered);
      for (const t of [0, 1, 2, 3, 4]) renderSceneToImageData(target, w, h, t, ordered);
      if (!equal(before, renderSceneToImageData(target, w, h, 5, ordered))) return `${file} ${label}: кадр зависит от порядка рендера`;
      const data = renderSceneToImageData(target, w, h, 2, createRenderCache()).data;
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 16) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      if (colors.size < 256) return `${file} ${label}: пустой кадр (${colors.size} цветов)`;
      log(`BG: ${file} ${label} PASS (${colors.size} цветов)`);
    }
  }
  return null;
}

async function nodeMode(): Promise<void> {
  const shapeFail = shapeEquivalence();
  if (shapeFail) {
    log(`SHAPE: FAIL (${shapeFail})`);
    process.exit(1);
  }
  log('SHAPE: EXACT (asset whale = shape whale)');
  const bgFail = backgroundChecks();
  if (bgFail) {
    log(`BG: FAIL (${bgFail})`);
    process.exit(1);
  }
  const cases: Array<[string, number, number]> = [['16:9', 1280, 720], ['9:16', 720, 1280]];
  let fail = '';
  for (const [label, w, h] of cases) {
    const a1 = renderToImageData(w, h, 0);
    const a2 = renderToImageData(w, h, 0);
    if (!equal(a1, a2)) { fail = `${label} t=0 невоспроизводим`; break; }
    const t6 = renderToImageData(w, h, 6);
    const t6b = renderToImageData(w, h, 6);
    if (!equal(t6, t6b)) { fail = `${label} t=6 невоспроизводим`; break; }
    const a0again = renderToImageData(w, h, 0);
    if (!equal(a0again, a1)) { fail = `${label} состояние между кадрами`; break; }
  }
  if (fail) {
    log(`SELFTEST: FAIL (Node): ${fail}`);
    process.exit(1);
  } else {
    log('SELFTEST: PASS (Node)');
    process.exit(0);
  }
}

async function chromeMode() {
  const { execSync } = await import('child_process');
  log('build');
  execSync('npm.cmd run build', { stdio: 'inherit' });
  log('build done');

  await assertPortFree(PORT);
  const preview = spawnPreview(PORT);
  log('preview spawned');
  if (!(await waitForServer(PORT, URL))) {
    log('preview NOT up');
    preview.cleanup();
    process.exit(1);
  }
  log('server up');

  const chromeHandle = await launchSafeChrome(['--dump-dom', URL]);
  let chromeOut = '';
  chromeHandle.browser.pages().then((pages) => {
    // страница уже открыта через аргумент --dump-dom; ждём вывода через stdout ниже
  });
  const page = await chromeHandle.browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const content = await page.content();
  await chromeHandle.cleanup();

  if (content.includes('SELFTEST: PASS')) {
    log('SELFTEST: PASS');
    process.exit(0);
  } else {
    log('SELFTEST: FAIL');
    log(content.slice(0, 2000));
    process.exit(1);
  }
}

async function main() {
  if (IS_CHROME && !ALLOW_CHROME) {
    log('Chrome отключён: check-render:chrome запущен без ALLOW_CHROME=1.');
    log('Используйте npm run check:render (Node-сетест, без браузера).');
    log('Для браузерного режима задайте ALLOW_CHROME=1.');
    process.exit(0);
  }
  if (ALLOW_CHROME) {
    await chromeMode();
    return;
  }
  await nodeMode();
}

main().catch((e) => { log('ERROR ' + String(e)); process.exit(1); });
