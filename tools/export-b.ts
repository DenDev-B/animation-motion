import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createCanvas, Path2D } from '@napi-rs/canvas';
(globalThis as any).Path2D = Path2D;
import { renderFrame, createRenderCache, type SceneV1, type CatalogAsset } from '../engine/index.ts';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(readFileSync(path.join(__dirname, '..', 'scenes', 'whale-demo.json'), 'utf8')) as unknown as SceneV1;
const catalogJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'catalog', 'whale.json'), 'utf8')) as unknown as CatalogAsset;

const OUT_DIR = path.resolve('out/export');
const FPS = 30;
const FRAME_COUNT = 90; // 3 с при 30 fps, t = i/30
const SIZES = [{ w: 1280, h: 720 }, { w: 720, h: 1280 }, { w: 1920, h: 1080 }] as const;

function log(m: string) { process.stdout.write(m + '\n'); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function startFFmpeg(w: number, h: number, outFile: string) {
  return spawn('ffmpeg', [
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18',
    '-movflags', '+faststart', '-y', outFile
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
}

async function runPathB() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('PATH B — engine.renderFrame + @napi-rs/canvas + rawvideo(RGBA)');
  log('build...');
  execSync('npm.cmd run build', { stdio: 'inherit' });

  const catalog: Record<string, CatalogAsset> = { whale: catalogJson };
  const cache = createRenderCache();

  const report: Array<{ path: string; size: { w: number; h: number }; totalMs: number; msPerFrame: number; renderMsPerFrame: number; transferMsPerFrame: number; waitMsPerFrame: number; peakMemMB: number; frames: number }> = [];

  for (const { w, h } of SIZES) {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const outFile = path.join(OUT_DIR, `B-${w}x${h}.mp4`);
    const ffmpeg = startFFmpeg(w, h, outFile);
    let ffmpegErr = '';
    ffmpeg.stderr.on('data', (d) => { ffmpegErr += d; });

    let totalRender = 0, totalTransfer = 0;
    let peakMem = 0;
    const t0 = process.hrtime.bigint();

    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = i / FPS;
      const tr0 = process.hrtime.bigint();
      renderFrame(ctx, scene, t, { w, h }, { createCanvas: ((w2: number, h2: number) => createCanvas(w2, h2)) as unknown as (w: number, h: number) => HTMLCanvasElement, catalog, cache });
      const imgData = ctx.getImageData(0, 0, w, h);
      const tr1 = process.hrtime.bigint();
      const tt0 = process.hrtime.bigint();
      ffmpeg.stdin.write(Buffer.from(imgData.data.buffer));
      const tt1 = process.hrtime.bigint();
      totalRender += Number(tr1 - tr0) / 1e6;
      totalTransfer += Number(tt1 - tt0) / 1e6;
      const m = process.memoryUsage().rss;
      if (m > peakMem) peakMem = m;
    }

    ffmpeg.stdin.end();
    await new Promise<void>((resolve) => ffmpeg.on('close', resolve));
    const t1 = process.hrtime.bigint();
    const totalMs = Number(t1 - t0) / 1e6;
    const msPerFrame = totalMs / FRAME_COUNT;
    const renderMsPerFrame = totalRender / FRAME_COUNT;
    const transferMsPerFrame = totalTransfer / FRAME_COUNT;
    const waitMsPerFrame = msPerFrame - renderMsPerFrame - transferMsPerFrame;

    log(`${w}x${h}: total=${totalMs.toFixed(0)} ms, ms/frame=${msPerFrame.toFixed(2)}, render=${renderMsPerFrame.toFixed(2)}, transfer=${transferMsPerFrame.toFixed(2)}, wait=${waitMsPerFrame.toFixed(2)}, peakMem=${(peakMem / 1e6).toFixed(0)} MB`);
    report.push({ path: outFile, size: { w, h }, totalMs, msPerFrame, renderMsPerFrame, transferMsPerFrame, waitMsPerFrame, peakMemMB: peakMem / 1e6, frames: FRAME_COUNT });
  }

  const reportPath = path.join(OUT_DIR, 'report-b.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`report: ${reportPath}`);

  process.exit(0);
}

runPathB();
