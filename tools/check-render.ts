import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
(globalThis as any).Path2D = Path2D;
import { renderFrame, createRenderCache, validateScene, counterValue, unitsPerMeter, unitsToMeters, assetScaleForMeters, type SceneV1, type CatalogAsset } from '../engine/index.ts';
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
const catalog: Record<string, CatalogAsset> = {};
for (const file of fs.readdirSync(path.join(__dirname, '..', 'catalog')).filter((name) => name.endsWith('.json'))) {
  const asset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog', file), 'utf8')) as CatalogAsset;
  catalog[asset.id] = asset;
}
const catalogJson = catalog.whale;
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
    const validation = validateScene(target, { catalogIds: Object.keys(catalog) });
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

function rainScene(params: Record<string, unknown>): SceneV1 {
  return {
    version: 1,
    title: 'rain-period',
    duration: 10,
    palette: { sky: ['#000000', '#000000'] },
    style: {},
    camera: { verticalFit: 1, keys: [{ t: 0, x: 0, y: 0, zoom: 1 }] },
    assets: {},
    layers: [
      { id: 'p-sky', name: 'Небо', depth: 0, visible: true, objects: [{ id: 'p-sky-obj', name: 'Небо', kind: 'sky' }] },
      { id: 'p-rain', name: 'Дождь', depth: 0, visible: true, objects: [{ id: 'p-rain-obj', name: 'Дождь', kind: 'rain', params }] },
    ],
  };
}

function averageMs(target: SceneV1, w: number, h: number, iterations: number): number {
  const targetCache = createRenderCache();
  renderSceneToImageData(target, w, h, 0, targetCache);
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) renderSceneToImageData(target, w, h, i * 0.03, targetCache);
  return Number(process.hrtime.bigint() - started) / 1e6 / iterations;
}

function particleChecks(): string | null {
  const cases: Array<[string, number, number]> = [['16:9', 1280, 720], ['9:16', 720, 1280]];
  for (const file of ['rain-city.json', 'snow-hills.json', 'birds-sunset.json']) {
    const target = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', file), 'utf8')) as unknown as SceneV1;
    const validation = validateScene(target, { catalogIds: Object.keys(catalog) });
    if (!validation.ok) return `${file}: ${validation.errors[0]?.message ?? 'не проходит валидацию'}`;
    for (const [label, w, h] of cases) {
      if (!equal(renderSceneToImageData(target, w, h, 2, createRenderCache()), renderSceneToImageData(target, w, h, 2, createRenderCache()))) return `${file} ${label}: кадр t=2 невоспроизводим`;
      const ordered = createRenderCache();
      const before = renderSceneToImageData(target, w, h, 5, ordered);
      for (const t of [0, 1, 2, 3, 4]) renderSceneToImageData(target, w, h, t, ordered);
      if (!equal(before, renderSceneToImageData(target, w, h, 5, ordered))) return `${file} ${label}: кадр зависит от порядка рендера`;
      log(`PARTICLES: ${file} ${label} PASS`);
    }
  }
  const periodic = rainScene({ w: 1000, h: 600, count: 300, seed: 5, speed: 1200, angle: 0, len: 20, width: 1, alpha: 0.6, color: '#ffffff' });
  const sample = renderSceneToImageData(periodic, 960, 540, 1, createRenderCache());
  const shifted = renderSceneToImageData(periodic, 960, 540, 1.5, createRenderCache());
  if (!equal(sample, shifted)) return 'rain angle=0: кадр t и t+h/speed не совпадают';
  log('PARTICLES: rain period h/speed EXACT');
  const heavy = rainScene({ w: 2600, h: 1400, count: 3000, seed: 7, speed: 1600, angle: 12, len: 34, width: 1.5, alpha: 0.5, color: '#cfe0ff' });
  const baseline = averageMs(rainScene({ w: 2600, h: 1400, count: 1, seed: 7, speed: 1600, angle: 12, len: 34, width: 1.5, alpha: 0, color: '#cfe0ff' }), 1920, 1080, 8);
  const loaded = averageMs(heavy, 1920, 1080, 8);
  log(`PARTICLES: rain count=3000 1080p +${(loaded - baseline).toFixed(2)} ms/frame (${loaded.toFixed(2)} против ${baseline.toFixed(2)})`);
  return null;
}

function textChecks(): string | null {
  const cases: Array<[string, number, number]> = [['16:9', 1280, 720], ['9:16', 720, 1280]];
  for (const file of ['title-card.json', 'counter-demo.json']) {
    const target = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', file), 'utf8')) as unknown as SceneV1;
    const validation = validateScene(target, { catalogIds: Object.keys(catalog) });
    if (!validation.ok) return `${file}: ${validation.errors[0]?.message ?? 'не проходит валидацию'}`;
    for (const [label, w, h] of cases) {
      if (!equal(renderSceneToImageData(target, w, h, 2, createRenderCache()), renderSceneToImageData(target, w, h, 2, createRenderCache()))) return `${file} ${label}: кадр t=2 невоспроизводим`;
      const ordered = createRenderCache();
      const before = renderSceneToImageData(target, w, h, 3, ordered);
      for (const t of [0, 1, 2]) renderSceneToImageData(target, w, h, t, ordered);
      if (!equal(before, renderSceneToImageData(target, w, h, 3, ordered))) return `${file} ${label}: кадр зависит от порядка рендера`;
      log(`TEXT: ${file} ${label} PASS`);
    }
  }
  const counter = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', 'counter-demo.json'), 'utf8')) as unknown as SceneV1;
  const start = renderSceneToImageData(counter, 1280, 720, 0, createRenderCache());
  const middle = renderSceneToImageData(counter, 1280, 720, 2.5, createRenderCache());
  const end = renderSceneToImageData(counter, 1280, 720, 5, createRenderCache());
  if (equal(start, end) || equal(start, middle)) return 'counter-demo: значение счётчика не меняет кадр';

  const linear = { from: 0, to: 1000000, t0: 1, t1: 5, ease: 'lin', thousands: ' ' };
  const expected: Array<[number, string]> = [[0, '0'], [1, '0'], [3, '500 000'], [5, '1 000 000'], [9, '1 000 000']];
  for (const [t, value] of expected) {
    const actual = counterValue(linear, t);
    if (actual !== value) return `counterValue t=${t}: "${actual}" вместо "${value}"`;
  }
  if (counterValue({ ...linear, ease: 'inOut' }, 3) !== '500 000') return 'counterValue inOut: середина не 500 000';
  const formatted = counterValue({ from: 0, to: 1234567, decimals: 1, thousands: ',', prefix: '~', suffix: ' y', t0: 0, t1: 1, ease: 'lin' }, 1);
  if (formatted !== '~1,234,567.0 y') return `counterValue формат: "${formatted}"`;
  log('TEXT: counterValue 0→500 000→1 000 000 EXACT');
  return null;
}

function scaleChecks(): string | null {
  const file = 'scale-compare.json';
  const target = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', file), 'utf8')) as unknown as SceneV1;
  const validation = validateScene(target, { catalogIds: Object.keys(catalog) });
  if (!validation.ok) return `${file}: ${validation.errors[0]?.message ?? 'не проходит валидацию'}`;
  const cases: Array<[string, number, number]> = [['16:9', 1280, 720], ['9:16', 720, 1280]];
  for (const [label, w, h] of cases) {
    if (!equal(renderSceneToImageData(target, w, h, 2, createRenderCache()), renderSceneToImageData(target, w, h, 2, createRenderCache()))) return `${file} ${label}: кадр t=2 невоспроизводим`;
    const ordered = createRenderCache();
    const before = renderSceneToImageData(target, w, h, 4, ordered);
    for (const t of [0, 1, 2, 3]) renderSceneToImageData(target, w, h, t, ordered);
    if (!equal(before, renderSceneToImageData(target, w, h, 4, ordered))) return `${file} ${label}: кадр зависит от порядка рендера`;
    if (label === '16:9') {
      const data = renderSceneToImageData(target, w, h, 2, createRenderCache()).data;
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 16) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      if (colors.size < 256) return `${file} ${label}: пустой кадр (${colors.size} цветов)`;
    }
    log(`SCALE: ${file} ${label} PASS`);
  }
  const upm = unitsPerMeter(target);
  const sizes: Array<[string, number]> = [['human', 1.75], ['house', 7], ['plane', 12], ['whale', 6.58]];
  for (const [id, sizeM] of sizes) {
    const asset = catalog[id];
    if (!asset) return `в каталоге нет ${id}`;
    const renderedM = unitsToMeters(asset.bounds[3] * assetScaleForMeters(asset, sizeM, target), upm);
    if (Math.abs(renderedM - sizeM) / sizeM > 0.01) return `${id}: ${renderedM.toFixed(3)} м вместо ${sizeM} м`;
  }
  log(`SCALE: world ${upm} units/m, высоты human/house/plane/whale = 1.75/7/12/6.58 м EXACT (в пределах 1%)`);
  return null;
}

function cameraChecks(): string | null {
  const cases: Array<[string, number, number]> = [['16:9', 1280, 720], ['9:16', 720, 1280]];
  for (const file of ['camera-shake.json', 'camera-push.json']) {
    const target = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', file), 'utf8')) as unknown as SceneV1;
    const validation = validateScene(target, { catalogIds: Object.keys(catalog) });
    if (!validation.ok) return `${file}: ${validation.errors[0]?.message ?? 'не проходит валидацию'}`;
    for (const [label, w, h] of cases) {
      if (!equal(renderSceneToImageData(target, w, h, 3, createRenderCache()), renderSceneToImageData(target, w, h, 3, createRenderCache()))) return `${file} ${label}: кадр t=3 невоспроизводим`;
      const ordered = createRenderCache();
      const before = renderSceneToImageData(target, w, h, 5, ordered);
      for (const t of [0, 1, 2, 3, 4]) renderSceneToImageData(target, w, h, t, ordered);
      if (!equal(before, renderSceneToImageData(target, w, h, 5, ordered))) return `${file} ${label}: кадр зависит от порядка рендера`;
      log(`CAMERA: ${file} ${label} PASS`);
    }
  }
  const shaken = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', 'camera-shake.json'), 'utf8')) as unknown as SceneV1;
  const still = structuredClone(shaken);
  delete still.camera.shake;
  if (!equal(renderSceneToImageData(shaken, 1280, 720, 1, createRenderCache()), renderSceneToImageData(still, 1280, 720, 1, createRenderCache()))) return 'camera-shake: вне окна кадр отличается от камеры без тряски';
  if (equal(renderSceneToImageData(shaken, 1280, 720, 3, createRenderCache()), renderSceneToImageData(still, 1280, 720, 3, createRenderCache()))) return 'camera-shake: внутри окна тряска не меняет кадр';
  const push = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'fixtures', 'camera-push.json'), 'utf8')) as unknown as SceneV1;
  if (equal(renderSceneToImageData(push, 1280, 720, 0, createRenderCache()), renderSceneToImageData(push, 1280, 720, 6, createRenderCache()))) return 'camera-push: наезд не меняет кадр';
  log('CAMERA: shake окно и push-in EXACT');
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
  const particleFail = particleChecks();
  if (particleFail) {
    log(`PARTICLES: FAIL (${particleFail})`);
    process.exit(1);
  }
  const textFail = textChecks();
  if (textFail) {
    log(`TEXT: FAIL (${textFail})`);
    process.exit(1);
  }
  const scaleFail = scaleChecks();
  if (scaleFail) {
    log(`SCALE: FAIL (${scaleFail})`);
    process.exit(1);
  }
  const cameraFail = cameraChecks();
  if (cameraFail) {
    log(`CAMERA: FAIL (${cameraFail})`);
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
