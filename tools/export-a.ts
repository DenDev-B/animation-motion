import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 4175;
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('out/export');
const FPS = 30;
const FRAME_COUNT = 90; // 3 с при 30 fps, t = i/30
const SIZES = [{ w: 1280, h: 720 }, { w: 720, h: 1280 }] as const;

function log(m: string) { process.stdout.write(m + '\n'); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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

function startFFmpeg(w: number, h: number, outFile: string) {
  return spawn('ffmpeg', [
    '-f', 'image2pipe', '-vcodec', 'png', '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18',
    '-movflags', '+faststart', '-y', outFile
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
}

async function runPathA() {
  if (process.env.ALLOW_CHROME !== '1') {
    log('Chrome отключён: export:a:chrome запущен без ALLOW_CHROME=1.');
    log('Используйте npm run export:b (Node + @napi-rs/canvas + ffmpeg, без браузера).');
    log('Для пути A (puppeteer + Chrome) задайте ALLOW_CHROME=1.');
    process.exit(0);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('PATH A — puppeteer + vite preview + image2pipe(PNG)');
  log('build...');
  execSync('npm.cmd run build', { stdio: 'inherit' });

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

    const report: Array<{ path: string; size: { w: number; h: number }; totalMs: number; msPerFrame: number; renderMsPerFrame: number; transferMsPerFrame: number; waitMsPerFrame: number; peakMemMB: number; frames: number }> = [];

    for (const { w, h } of SIZES) {
      const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: 'new' as any,
        args: ['--disable-gpu', '--force-device-scale-factor=1'],
      });
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).__editor !== undefined);
      await page.evaluate((a: string) => (window as any).__editor.setAspect(a), w === 1280 ? 'h' : 'v');

      const outFile = path.join(OUT_DIR, `A-${w}x${h}.mp4`);
      const ffmpeg = startFFmpeg(w, h, outFile);
      let ffmpegErr = '';
      ffmpeg.stderr.on('data', (d) => { ffmpegErr += d; });

      let totalRender = 0, totalTransfer = 0;
      let peakMem = 0;
      const t0 = process.hrtime.bigint();

      for (let i = 0; i < FRAME_COUNT; i++) {
        const t = i / FPS;
        const tr0 = process.hrtime.bigint();
        const dataURL = await page.evaluate((tt: number) => {
          (window as any).__editor.setT(tt);
          const cv = document.querySelector('#cv') as HTMLCanvasElement;
          return cv.toDataURL('image/png');
        }, t);
        const tr1 = process.hrtime.bigint();
        const pngBuf = Buffer.from((dataURL as string).split(',')[1], 'base64');
        const tt0 = process.hrtime.bigint();
        ffmpeg.stdin.write(pngBuf);
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

      await browser.close();
    }

    const reportPath = path.join(OUT_DIR, 'report-a.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(`report: ${reportPath}`);

    exitCode = 0;
  } finally {
    try { preview.kill(); } catch {}
  }
  process.exit(exitCode);
}

runPathA();
