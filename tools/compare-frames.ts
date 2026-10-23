import puppeteer, { type Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import http from 'http';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { renderFrame, createRenderCache, type SceneV1, type CatalogAsset } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;
import { spawnPreview, waitForServer, launchSafeChrome, assertPortFree } from './browser.ts';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 4174;
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const M0_PATH = path.resolve('reference/m0/scene-sandbox.html');
const BASELINE_DIR = path.resolve('reference/m0/baseline');
const OUT_DIR = path.resolve('out/compare');
const TS = [0, 6, 12] as const;
const ASPECTS = ['h', 'v'] as const;
type Aspect = typeof ASPECTS[number];
const SIZE: Record<Aspect, { w: number; h: number }> = { h: { w: 1280, h: 720 }, v: { w: 720, h: 1280 } };
const MIN_UNIQUE_COLORS = 256;
const MIN_CHANGE_PCT = 1;

const IS_CHROME = process.env.npm_lifecycle_event === 'compare:frames:chrome';
const ALLOW_CHROME = process.env.ALLOW_CHROME === '1';

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function log(m: string) { process.stdout.write(m + '\n'); }

function savePng(file: string, w: number, h: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const png = new PNG({ width: w, height: h });
    png.data = data;
    png.pack().pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject);
  });
}

function nearestNeighbor(src: Buffer, sw: number, sh: number, dw: number, dh: number): Buffer {
  const out = Buffer.alloc(dw * dh * 4);
  const xscale = sw / dw;
  const yscale = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * yscale));
    const siBase = sy * sw * 4;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * xscale));
      const si = siBase + sx * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return out;
}

interface Frame { source: string; aspect: Aspect; t: number; w: number; h: number; data: Buffer; }

interface CmpResult {
  diffPixels: number;
  maxDelta: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  pixelmatch: number;
  diffBuf: Buffer;
}

function compare(a: Frame, b: Frame): CmpResult {
  const { w, h } = a;
  let diffPixels = 0, maxDelta = 0;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    const base = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = base + x * 4;
      let d = 0;
      for (let c = 0; c < 4; c++) { const dd = Math.abs(a.data[i + c] - b.data[i + c]); if (dd > d) d = dd; }
      if (d > 0) {
        diffPixels++;
        if (d > maxDelta) maxDelta = d;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const bbox = diffPixels > 0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null;
  const diffOut = Buffer.alloc(w * h * 4);
  const pm = pixelmatch(a.data, b.data, diffOut, w, h, { threshold: 0.1 }) as number;
  return { diffPixels, maxDelta, bbox, pixelmatch: pm, diffBuf: diffOut };
}

function uniqueColors(data: Buffer): number {
  const u32 = new Uint32Array(data.buffer, data.byteOffset, data.length / 4);
  return new Set(u32).size;
}

async function captureNode(aspect: Aspect, t: number, scene: SceneV1, catalog: Record<string, CatalogAsset>, cache: ReturnType<typeof createRenderCache>): Promise<Frame> {
  const { w, h } = SIZE[aspect];
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(ctx, scene, t, { w, h }, { createCanvas: ((w2: number, h2: number) => createCanvas(w2, h2)) as unknown as (w: number, h: number) => HTMLCanvasElement, catalog, cache });
  const id = ctx.getImageData(0, 0, w, h);
  return { source: 'NODE', aspect, t, w, h, data: Buffer.from(new Uint8ClampedArray(id.data)) };
}

function loadBaseline(aspect: Aspect, t: number): Frame {
  const file = path.join(BASELINE_DIR, `m0-${aspect}-t${t}.png`);
  if (!fs.existsSync(file)) {
    log(`базовый кадр не найден: ${file}`);
    log('Положите 6 эталонных M0-кадров в reference/m0/baseline/ (m0-h/v-t0/6/12.png) и повторите.');
    process.exit(1);
  }
  const png = PNG.sync.read(fs.readFileSync(file));
  return { source: 'BASELINE', aspect, t, w: png.width, h: png.height, data: Buffer.from(png.data) };
}

interface ResultRow {
  aspect: Aspect; t: number; sourceA: string; sourceB: string; diffPixels: number; total: number; percent: number;
  maxDelta: number; bbox: { x0: number; y0: number; x1: number; y1: number } | null; pixelmatch: number; verdict: string;
}

async function chromeMode() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('build');
  execSync('npm.cmd run build', { stdio: 'inherit' });
  log('preview spawn');
  await assertPortFree(PORT);
  const preview = spawnPreview(PORT);
  let previewOut = '';
  if (preview.proc.stdout) preview.proc.stdout.on('data', (d) => { previewOut += d; });
  if (preview.proc.stderr) preview.proc.stderr.on('data', (d) => { previewOut += d; });

  let exitCode = 1;
  const extraChecks: Array<{ name: string; ok: boolean; message: string }> = [];
  try {
    if (!(await waitForServer(PORT, `http://localhost:${PORT}/`))) {
      log('preview NOT up');
      console.log(previewOut);
      preview.cleanup();
      process.exit(1);
    }
    log('server up');

    const chrome = await launchSafeChrome(['--allow-file-access-from-files']);
    const page = await chrome.browser.newPage();
    const results: ResultRow[] = [];
    let etalonStable = true;

    const m0v_t6_a = await captureM0(page, 'v', 6);
    const m0v_t0_b = await captureM0(page, 'v', 0);
    const m0v_t6_b = await captureM0(page, 'v', 6);
    const noise = compare(m0v_t6_a, m0v_t6_b);
    etalonStable = noise.diffPixels === 0;
    log(`etalon self-noise t=6 (9:16): differing=${noise.diffPixels} maxDelta=${noise.maxDelta} -> ${etalonStable ? 'стабилен' : 'НЕСТАБИЛЕН'}`);

    for (const f of [m0v_t6_a, m0v_t0_b, m0v_t6_b]) {
      const uc = uniqueColors(f.data);
      const ok = uc >= MIN_UNIQUE_COLORS;
      extraChecks.push({ name: `M0 ${f.aspect.toUpperCase()} t=${f.t} уникальных цветов`, ok, message: `${uc} цветов (требуется ≥ ${MIN_UNIQUE_COLORS})` });
      if (!ok) log(`FAIL: M0 ${f.aspect.toUpperCase()} t=${f.t}: ${uc} уникальных цветов < ${MIN_UNIQUE_COLORS}`);
    }

    const newFrames: Record<string, Frame> = {};
    const m0Frames: Record<string, Frame> = {};
    for (const aspect of ASPECTS) {
      for (const t of TS) {
        const m0 = await captureM0(page, aspect, t);
        m0Frames[`${aspect}-t${t}`] = m0;
        const New = await captureNew(page, aspect, t);
        newFrames[`${aspect}-t${t}`] = New;
        const cmp = compare(m0, New);
        const total = m0.w * m0.h;
        const percent = (cmp.diffPixels / total) * 100;
        const verdict = cmp.diffPixels === 0 ? 'EXACT' : 'DIFF';
        results.push({ aspect, t: m0.t, sourceA: 'M0', sourceB: 'NEW', diffPixels: cmp.diffPixels, total, percent, maxDelta: cmp.maxDelta, bbox: cmp.bbox, pixelmatch: cmp.pixelmatch, verdict });
        await savePng(path.join(OUT_DIR, `m0-${aspect}-t${t}.png`), m0.w, m0.h, m0.data);
        await savePng(path.join(OUT_DIR, `new-${aspect}-t${t}.png`), New.w, New.h, New.data);
        await savePng(path.join(OUT_DIR, `diff-${aspect}-t${t}.png`), m0.w, m0.h, cmp.diffBuf);
        log(`${aspect.toUpperCase()} t=${t}: diff=${cmp.diffPixels}/${total} (${percent.toFixed(2)}%) maxDelta=${cmp.maxDelta} pixelmatch=${cmp.pixelmatch} verdict=${verdict}`);
      }
    }

    await chrome.cleanup();

    for (const key of Object.keys(newFrames)) {
      const f = newFrames[key];
      const uc = uniqueColors(f.data);
      const ok = uc >= MIN_UNIQUE_COLORS;
      extraChecks.push({ name: `NEW ${f.aspect.toUpperCase()} t=${f.t} уникальных цветов`, ok, message: `${uc} цветов (требуется ≥ ${MIN_UNIQUE_COLORS})` });
      if (!ok) log(`FAIL: NEW ${f.aspect.toUpperCase()} t=${f.t}: ${uc} уникальных цветов < ${MIN_UNIQUE_COLORS}`);
    }

    for (const aspect of ASPECTS) {
      const f0 = newFrames[`${aspect}-t0`];
      const f6 = newFrames[`${aspect}-t6`];
      const cmp = compare(f0, f6);
      const pct = (cmp.diffPixels / (f0.w * f0.h)) * 100;
      const ok = pct > MIN_CHANGE_PCT;
      extraChecks.push({ name: `NEW ${aspect.toUpperCase()} t=0 vs t=6 изменение`, ok, message: `${pct.toFixed(2)}% пикселей различаются (требуется > ${MIN_CHANGE_PCT}%)` });
      if (!ok) log(`FAIL: NEW ${aspect.toUpperCase()} t=0 vs t=6: ${pct.toFixed(2)}% изменений ≤ ${MIN_CHANGE_PCT}%`);
    }

    const scene = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'whale-demo.json'), 'utf8')) as unknown as SceneV1;
    const catalogJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog', 'whale.json'), 'utf8')) as unknown as CatalogAsset;
    const catalog: Record<string, CatalogAsset> = { whale: catalogJson };
    const nodeCache = createRenderCache();
    log('\nNODE vs M0:');
    for (const aspect of ASPECTS) {
      for (const t of TS) {
        const m0 = m0Frames[`${aspect}-t${t}`];
        const nodeFrame = await captureNode(aspect, t, scene, catalog, nodeCache);
        const cmp = compare(m0, nodeFrame);
        const total = m0.w * m0.h;
        const percent = (cmp.diffPixels / total) * 100;
        const verdict = cmp.diffPixels === 0 ? 'EXACT' : 'DIFF';
        results.push({ aspect, t: nodeFrame.t, sourceA: 'M0', sourceB: 'NODE', diffPixels: cmp.diffPixels, total, percent, maxDelta: cmp.maxDelta, bbox: cmp.bbox, pixelmatch: cmp.pixelmatch, verdict });
        log(`NODE ${aspect.toUpperCase()} t=${t}: diff=${cmp.diffPixels}/${total} (${percent.toFixed(2)}%) maxDelta=${cmp.maxDelta} pixelmatch=${cmp.pixelmatch} verdict=${verdict}`);
        const uc = uniqueColors(nodeFrame.data);
        const ok = uc >= MIN_UNIQUE_COLORS;
        extraChecks.push({ name: `NODE ${aspect.toUpperCase()} t=${t} уникальных цветов`, ok, message: `${uc} цветов (требуется ≥ ${MIN_UNIQUE_COLORS})` });
        if (!ok) log(`FAIL: NODE ${aspect.toUpperCase()} t=${t}: ${uc} уникальных цветов < ${MIN_UNIQUE_COLORS}`);
      }
    }

    const m0newResults = results.filter((r) => r.sourceA === 'M0' && r.sourceB === 'NEW');
    const cellH = 180;
    const colW = 320;
    const rowGap = 6;
    const colGap = 40;
    const sheetW = 3 * colW + 2 * colGap;
    const sheetH = m0newResults.length * cellH + (m0newResults.length - 1) * rowGap;
    const sheet = Buffer.alloc(sheetW * sheetH * 4, 0);
    function pngToRGBA(buf: Buffer): { w: number; h: number; data: Buffer } {
      const png = PNG.sync.read(buf);
      return { w: png.width, h: png.height, data: Buffer.from(png.data) };
    }
    let ri = 0;
    for (const r of m0newResults) {
      const cells = [
        path.join(OUT_DIR, `m0-${r.aspect}-t${r.t}.png`),
        path.join(OUT_DIR, `new-${r.aspect}-t${r.t}.png`),
        path.join(OUT_DIR, `diff-${r.aspect}-t${r.t}.png`),
      ];
      for (let ci = 0; ci < 3; ci++) {
        const { w: sw, h: sh, data: sdata } = pngToRGBA(fs.readFileSync(cells[ci]));
        const dw = Math.max(1, Math.round(sw * cellH / sh));
        const dx = ci * (colW + colGap) + Math.floor((colW - dw) / 2);
        const dy = ri * (cellH + rowGap);
        const scaled = nearestNeighbor(sdata, sw, sh, dw, cellH);
        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < dw; x++) {
            const si = (y * dw + x) * 4;
            const di = ((dy + y) * sheetW + (dx + x)) * 4;
            sheet[di] = scaled[si]; sheet[di + 1] = scaled[si + 1]; sheet[di + 2] = scaled[si + 2]; sheet[di + 3] = scaled[si + 3];
          }
        }
      }
      ri++;
    }
    await savePng(path.join(OUT_DIR, 'sheet.png'), sheetW, sheetH, sheet);

    const report = { etalonStable, etalonNote: etalonStable ? 'стабилен' : 'НЕСТАБИЛЕН', extraChecks, results };
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    log('\nformat  t  A->B     diffPixels  percent   maxDelta  pixelmatch  verdict');
    for (const r of results) {
      log(`${r.aspect.toUpperCase().padEnd(5)} ${String(r.t).padEnd(2)} ${r.sourceA}->${r.sourceB.padEnd(5)} ${String(r.diffPixels).padEnd(10)} ${r.percent.toFixed(2).padEnd(9)} ${String(r.maxDelta).padEnd(10)} ${String(r.pixelmatch).padEnd(11)} ${r.verdict}`);
    }
    log('\nпроверки защиты от пустого кадра:');
    for (const c of extraChecks) {
      log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}: ${c.message}`);
    }
    log(`etalon self-noise: ${etalonStable ? 'стабилен' : 'НЕСТАБИЛЕН'}`);

    const m0newExact = m0newResults.every((r) => r.verdict === 'EXACT');
    const allExtra = extraChecks.every((c) => c.ok);
    if (m0newExact && etalonStable && allExtra) {
      log('OVERALL: PASS');
      exitCode = 0;
    } else {
      log('OVERALL: FAIL');
      exitCode = 1;
    }
  } finally {
    try { preview.cleanup(); } catch {}
  }
  process.exit(exitCode);
}

async function nodeMode() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const scene = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenes', 'whale-demo.json'), 'utf8')) as unknown as SceneV1;
  const catalogJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog', 'whale.json'), 'utf8')) as unknown as CatalogAsset;
  const catalog: Record<string, CatalogAsset> = { whale: catalogJson };
  const nodeCache = createRenderCache();

  const results: ResultRow[] = [];
  const extraChecks: Array<{ name: string; ok: boolean; message: string }> = [];
  let exitCode = 1;

  try {
    const newFrames: Record<string, Frame> = {};
    for (const aspect of ASPECTS) {
      for (const t of TS) {
        const base = loadBaseline(aspect, t);
        const nodeFrame = await captureNode(aspect, t, scene, catalog, nodeCache);
        newFrames[`${aspect}-t${t}`] = nodeFrame;
        const cmp = compare(base, nodeFrame);
        const total = base.w * base.h;
        const percent = (cmp.diffPixels / total) * 100;
        const verdict = cmp.diffPixels === 0 ? 'EXACT' : 'DIFF';
        results.push({ aspect, t: base.t, sourceA: 'BASELINE', sourceB: 'NODE', diffPixels: cmp.diffPixels, total, percent, maxDelta: cmp.maxDelta, bbox: cmp.bbox, pixelmatch: cmp.pixelmatch, verdict });
        await savePng(path.join(OUT_DIR, `m0-${aspect}-t${t}.png`), base.w, base.h, base.data);
        await savePng(path.join(OUT_DIR, `new-${aspect}-t${t}.png`), nodeFrame.w, nodeFrame.h, nodeFrame.data);
        await savePng(path.join(OUT_DIR, `diff-${aspect}-t${t}.png`), base.w, base.h, cmp.diffBuf);
        log(`${aspect.toUpperCase()} t=${t}: diff=${cmp.diffPixels}/${total} (${percent.toFixed(2)}%) maxDelta=${cmp.maxDelta} pixelmatch=${cmp.pixelmatch} verdict=${verdict}`);

        const uc = uniqueColors(nodeFrame.data);
        const ok = uc >= MIN_UNIQUE_COLORS;
        extraChecks.push({ name: `NODE ${aspect.toUpperCase()} t=${t} уникальных цветов`, ok, message: `${uc} цветов (требуется ≥ ${MIN_UNIQUE_COLORS})` });
        if (!ok) log(`FAIL: NODE ${aspect.toUpperCase()} t=${t}: ${uc} уникальных цветов < ${MIN_UNIQUE_COLORS}`);
      }
    }

    for (const aspect of ASPECTS) {
      const f0 = newFrames[`${aspect}-t0`];
      const f6 = newFrames[`${aspect}-t6`];
      const cmp = compare(f0, f6);
      const pct = (cmp.diffPixels / (f0.w * f0.h)) * 100;
      const ok = pct > MIN_CHANGE_PCT;
      extraChecks.push({ name: `NODE ${aspect.toUpperCase()} t=0 vs t=6 изменение`, ok, message: `${pct.toFixed(2)}% пикселей различаются (требуется > ${MIN_CHANGE_PCT}%)` });
      if (!ok) log(`FAIL: NODE ${aspect.toUpperCase()} t=0 vs t=6: ${pct.toFixed(2)}% изменений ≤ ${MIN_CHANGE_PCT}%`);
    }

    const sheetResults = results;
    const cellH = 180;
    const colW = 320;
    const rowGap = 6;
    const colGap = 40;
    const sheetW = 3 * colW + 2 * colGap;
    const sheetH = sheetResults.length * cellH + (sheetResults.length - 1) * rowGap;
    const sheet = Buffer.alloc(sheetW * sheetH * 4, 0);
    function pngToRGBA(buf: Buffer): { w: number; h: number; data: Buffer } {
      const png = PNG.sync.read(buf);
      return { w: png.width, h: png.height, data: Buffer.from(png.data) };
    }
    let ri = 0;
    for (const r of sheetResults) {
      const cells = [
        path.join(OUT_DIR, `m0-${r.aspect}-t${r.t}.png`),
        path.join(OUT_DIR, `new-${r.aspect}-t${r.t}.png`),
        path.join(OUT_DIR, `diff-${r.aspect}-t${r.t}.png`),
      ];
      for (let ci = 0; ci < 3; ci++) {
        const { w: sw, h: sh, data: sdata } = pngToRGBA(fs.readFileSync(cells[ci]));
        const dw = Math.max(1, Math.round(sw * cellH / sh));
        const dx = ci * (colW + colGap) + Math.floor((colW - dw) / 2);
        const dy = ri * (cellH + rowGap);
        const scaled = nearestNeighbor(sdata, sw, sh, dw, cellH);
        for (let y = 0; y < cellH; y++) {
          for (let x = 0; x < dw; x++) {
            const si = (y * dw + x) * 4;
            const di = ((dy + y) * sheetW + (dx + x)) * 4;
            sheet[di] = scaled[si]; sheet[di + 1] = scaled[si + 1]; sheet[di + 2] = scaled[si + 2]; sheet[di + 3] = scaled[si + 3];
          }
        }
      }
      ri++;
    }
    await savePng(path.join(OUT_DIR, 'sheet.png'), sheetW, sheetH, sheet);

    const report = { etalonStable: true, etalonNote: 'база без браузера', extraChecks, results };
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    log('\nformat  t  A->B     diffPixels  percent   maxDelta  pixelmatch  verdict');
    for (const r of results) {
      log(`${r.aspect.toUpperCase().padEnd(5)} ${String(r.t).padEnd(2)} ${r.sourceA}->${r.sourceB.padEnd(5)} ${String(r.diffPixels).padEnd(10)} ${r.percent.toFixed(2).padEnd(9)} ${String(r.maxDelta).padEnd(10)} ${String(r.pixelmatch).padEnd(11)} ${r.verdict}`);
    }
    log('\nпроверки защиты от пустого кадра:');
    for (const c of extraChecks) {
      log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}: ${c.message}`);
    }

    const allExact = results.every((r) => r.verdict === 'EXACT');
    const allExtra = extraChecks.every((c) => c.ok);
    if (allExact && allExtra) {
      log('OVERALL: PASS');
      exitCode = 0;
    } else {
      log('OVERALL: FAIL');
      exitCode = 1;
    }
  } catch (e) {
    console.error(e);
    exitCode = 1;
  }
  process.exit(exitCode);
}

async function captureM0(page: Page, aspect: Aspect, t: number): Promise<Frame> {
  await page.goto('file://' + M0_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__sandbox !== undefined);
  const btn = await page.$('#play');
  if (btn) {
    const text = await page.evaluate((el: Element) => el.textContent, btn);
    if (text && /Пауза/.test(text ?? '')) await btn.click();
  }
  await page.click(`#aspect button[data-a="${aspect}"]`);
  const data = await page.evaluate((t: number) => {
    (window as any).__sandbox.setT(t);
    const cv = document.querySelector('#cv') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const id = g.getImageData(0, 0, cv.width, cv.height);
    return Array.from(id.data);
  }, t);
  const { w, h } = SIZE[aspect];
  return { source: 'M0', aspect, t, w, h, data: Buffer.from(new Uint8ClampedArray(data)) };
}

async function captureNew(page: Page, aspect: Aspect, t: number): Promise<Frame> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__editor !== undefined);
  await page.evaluate((a: string) => (window as any).__editor.setAspect(a), aspect);
  const data = await page.evaluate((t: number) => {
    (window as any).__editor.setT(t);
    const cv = document.querySelector('#cv') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const id = g.getImageData(0, 0, cv.width, cv.height);
    return Array.from(id.data);
  }, t);
  const { w, h } = SIZE[aspect];
  return { source: 'NEW', aspect, t, w, h, data: Buffer.from(new Uint8ClampedArray(data)) };
}

async function main() {
  if (IS_CHROME && !ALLOW_CHROME) {
    log('Chrome отключён: compare:frames:chrome запущен без ALLOW_CHROME=1.');
    log('Используйте npm run compare:frames (Node-рендер vs reference/m0/baseline/, без браузера).');
    log('Для браузерного режима задайте ALLOW_CHROME=1.');
    process.exit(0);
  }
  if (ALLOW_CHROME) {
    await chromeMode();
    return;
  }
  await nodeMode();
}

main().catch((e) => { console.error(e); process.exit(1); });
