import puppeteer, { type Page, type Browser } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import http from 'http';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const PORT = 4174;
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const M0_PATH = path.resolve('reference/m0/scene-sandbox.html');
const OUT_DIR = path.resolve('out/compare');
const TS = [0, 6, 12] as const;
const ASPECTS = ['h', 'v'] as const;
type Aspect = typeof ASPECTS[number];
const SIZE: Record<Aspect, { w: number; h: number }> = { h: { w: 1280, h: 720 }, v: { w: 720, h: 1280 } };

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function log(m: string) { process.stdout.write(m + '\n'); }

async function waitForServer(port: number, retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/`, (res) => { res.resume(); if (res.statusCode === 200) resolve(res); else reject(new Error(String(res.statusCode))); });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch { await sleep(250); }
  }
  return false;
}

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

interface Frame { aspect: Aspect; t: number; w: number; h: number; data: Buffer; }

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
  return { aspect, t, w, h, data: Buffer.from(new Uint8ClampedArray(data)) };
}

async function captureNew(page: Page, aspect: Aspect, t: number): Promise<Frame> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__editor !== undefined);
  await page.evaluate((a: Aspect) => (window as any).__editor.setAspect(a), aspect);
  const data = await page.evaluate((t: number) => {
    (window as any).__editor.setT(t);
    const cv = document.querySelector('#cv') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const id = g.getImageData(0, 0, cv.width, cv.height);
    return Array.from(id.data);
  }, t);
  const { w, h } = SIZE[aspect];
  return { aspect, t, w, h, data: Buffer.from(new Uint8ClampedArray(data)) };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('build');
  execSync('npm.cmd run build', { stdio: 'inherit' });
  log('preview spawn');
  const preview = spawn('cmd', ['/c', 'npm.cmd', 'run', 'preview', '--', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let previewOut = '';
  preview.stdout.on('data', (d) => { previewOut += d; });
  preview.stderr.on('data', (d) => { previewOut += d; });

  let exitCode = 1;
  try {
    if (!(await waitForServer(PORT))) {
      log('preview NOT up');
      console.log(previewOut);
      preview.kill();
      process.exit(1);
    }
    log('server up');

    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new' as any,
      args: ['--disable-gpu', '--force-device-scale-factor=1', '--allow-file-access-from-files'],
    });

    const page = await browser.newPage();
    const results: Array<{ aspect: Aspect; t: number; diffPixels: number; total: number; percent: number; maxDelta: number; bbox: { x0: number; y0: number; x1: number; y1: number } | null; pixelmatch: number; verdict: string }> = [];
    let etalonStable = true;

    const m0v_t6_a = await captureM0(page, 'v', 6);
    const m0v_t0_b = await captureM0(page, 'v', 0);
    const m0v_t6_b = await captureM0(page, 'v', 6);
    const noise = compare(m0v_t6_a, m0v_t6_b);
    etalonStable = noise.diffPixels === 0;
    log(`etalon self-noise t=6 (9:16): differing=${noise.diffPixels} maxDelta=${noise.maxDelta} -> ${etalonStable ? 'стабилен' : 'НЕСТАБИЛЕН'}`);

    for (const aspect of ASPECTS) {
      for (const t of TS) {
        const m0 = await captureM0(page, aspect, t);
        const New = await captureNew(page, aspect, t);
        const cmp = compare(m0, New);
        const total = m0.w * m0.h;
        const percent = (cmp.diffPixels / total) * 100;
        const verdict = cmp.diffPixels === 0 ? 'EXACT' : 'DIFF';
        results.push({ aspect, t: m0.t, diffPixels: cmp.diffPixels, total, percent, maxDelta: cmp.maxDelta, bbox: cmp.bbox, pixelmatch: cmp.pixelmatch, verdict });
        await savePng(path.join(OUT_DIR, `m0-${aspect}-t${t}.png`), m0.w, m0.h, m0.data);
        await savePng(path.join(OUT_DIR, `new-${aspect}-t${t}.png`), New.w, New.h, New.data);
        await savePng(path.join(OUT_DIR, `diff-${aspect}-t${t}.png`), m0.w, m0.h, cmp.diffBuf);
        log(`${aspect.toUpperCase()} t=${t}: diff=${cmp.diffPixels}/${total} (${percent.toFixed(2)}%) maxDelta=${cmp.maxDelta} pixelmatch=${cmp.pixelmatch} verdict=${verdict}`);
      }
    }
    await browser.close();

    // sheet.png
    const cellH = 180;
    const colW = 320;
    const rowGap = 6;
    const colGap = 40;
    const sheetW = 3 * colW + 2 * colGap;
    const sheetH = results.length * cellH + (results.length - 1) * rowGap;
    const sheet = Buffer.alloc(sheetW * sheetH * 4, 0);
    function pngToRGBA(buf: Buffer): { w: number; h: number; data: Buffer } {
      const png = PNG.sync.read(buf);
      return { w: png.width, h: png.height, data: Buffer.from(png.data) };
    }
    let ri = 0;
    for (const r of results) {
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

    const report = { etalonStable, etalonNote: etalonStable ? 'стабилен' : 'НЕСТАБИЛЕН', results };
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    log('\nformat  t  diffPixels  percent   maxDelta  pixelmatch  verdict');
    for (const r of results) {
      log(`${r.aspect.toUpperCase().padEnd(5)} ${String(r.t).padEnd(2)} ${String(r.diffPixels).padEnd(10)} ${r.percent.toFixed(2).padEnd(9)} ${String(r.maxDelta).padEnd(10)} ${String(r.pixelmatch).padEnd(11)} ${r.verdict}`);
    }
    log(`etalon self-noise: ${etalonStable ? 'стабилен' : 'НЕСТАБИЛЕН'}`);

    const allExact = results.every((r) => r.verdict === 'EXACT');
    if (allExact && etalonStable) {
      log('OVERALL: PASS');
      exitCode = 0;
    } else {
      log('OVERALL: FAIL');
      exitCode = 1;
    }
  } finally {
    try { preview.kill(); } catch {}
  }
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
