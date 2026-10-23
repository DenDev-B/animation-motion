import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { renderFrame, createRenderCache, validateScene, type SceneV1, type CatalogAsset } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;

function log(m: string) { process.stdout.write(m + '\n'); }
function fail(m: string): never { log(`ОШИБКА: ${m}`); process.exit(1); }

function parseArgs(): { scene: string; format: 'h' | 'v'; w: number; h: number; fps: number; t0: number; t1: number; out: string; crf: number; preset: string } {
  const args = process.argv.slice(2);
  let scene = '';
  let format: 'h' | 'v' | undefined;
  let sizeW: number | undefined;
  let sizeH: number | undefined;
  let fps = 30;
  let range: string | undefined;
  let out: string | undefined;
  let crf = 18;
  let preset = 'veryfast';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--format') format = args[++i] as 'h' | 'v';
    else if (a === '--size') { const s = args[++i].split('x'); sizeW = +s[0]; sizeH = +s[1]; }
    else if (a === '--fps') fps = +args[++i];
    else if (a === '--range') range = args[++i];
    else if (a === '--out') out = args[++i];
    else if (a === '--crf') crf = +args[++i];
    else if (a === '--preset') preset = args[++i];
    else if (!a.startsWith('-')) scene = a;
    else fail(`неизвестный аргумент ${a}`);
  }
  if (!scene) fail('укажите scene.json позиционным аргументом');
  if (!format) fail('укажите --format h|v');
  if (fps <= 0) fail('fps должен быть больше 0');
  const w = sizeW ?? (format === 'h' ? 1920 : 1080);
  const h = sizeH ?? (format === 'v' ? 1920 : 1080);
  if (w % 2 !== 0 || h % 2 !== 0) fail(`размер ${w}x${h} нечётный, yuv420p требует чётные размеры`);
  let t0 = 0, t1: number;
  if (range) { const [a, b] = range.split(':').map(Number); if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) fail(`некорректный --range ${range}`); t0 = a; t1 = b; }
  else { t1 = 0; } // t1 зададим после загрузки сцены (duration)
  return { scene, format, w, h, fps, t0, t1, out: out ?? '', crf, preset };
}

async function ffprobe(file: string): Promise<Record<string, string>> {
  const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames,duration -of json "${file}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const s = JSON.parse(out).streams[0];
  return s;
}

async function main() {
  const { scene, format, w, h, fps, t0, crf, preset } = parseArgs();

  // каталог
  const catalogDir = path.join(__dirname, '..', 'catalog');
  const catalog: Record<string, CatalogAsset> = {};
  for (const f of fs.readdirSync(catalogDir)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')) as CatalogAsset;
    catalog[c.id] = c;
  }
  log(`каталог: ${Object.keys(catalog).join(', ') || '(пуст)'}`);

  // сцена
  const sceneRaw = JSON.parse(fs.readFileSync(scene, 'utf8')) as unknown;
  const res = validateScene(sceneRaw, { catalogIds: Object.keys(catalog) });
  if (!res.ok) {
    log('сцена не прошла валидацию:');
    for (const e of res.errors) log(`  ${e.path}: ${e.message}`);
    process.exit(1);
  }
  const sceneV1 = sceneRaw as SceneV1;

  let t1 = sceneV1.duration;
  if (t0 >= t1) fail(`--range начинается ${t0} >= длительность сцены ${t1}`);
  const N = Math.round((t1 - t0) * fps);
  log(`сцена: ${scene}, длительность=${t1} с, кадры t=${t0}..${t1} (конечная точка не кадр), N=${N} при ${fps} fps`);

  const outFile = (() => {
    if (process.argv.includes('--out')) {
      const i = process.argv.indexOf('--out');
      return process.argv[i + 1];
    }
    const base = path.basename(scene, '.json');
    return path.join(__dirname, '..', 'out', 'video', `${base}-${format}.mp4`);
  })();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  // один холст и один буфер на весь экспорт
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const cache = createRenderCache();
  const createCanvasFn = ((w2: number, h2: number) => createCanvas(w2, h2)) as unknown as (w: number, h: number) => HTMLCanvasElement;

  const ffmpeg = spawn('ffmpeg', [
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', preset, '-crf', String(crf),
    '-movflags', '+faststart', '-y', outFile
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffmpegErr = '';
  ffmpeg.stderr.on('data', (d) => { ffmpegErr += d; });
  ffmpeg.on('error', (e) => { fail(`ffmpeg spawn error: ${e.message}`); });

  let totalRender = 0;
  let peakMem = 0;
  const tStart = process.hrtime.bigint();
  let written = 0;

  for (let i = 0; i < N; i++) {
    const t = t0 + i / fps;
    const tr0 = process.hrtime.bigint();
    renderFrame(ctx, sceneV1, t, { w, h }, { createCanvas: createCanvasFn, catalog, cache });
    const imgData = ctx.getImageData(0, 0, w, h);
    const tr1 = process.hrtime.bigint();
    totalRender += Number(tr1 - tr0) / 1e6;
    const ok = ffmpeg.stdin.write(Buffer.from(imgData.data));
    if (!ok) {
      await new Promise<void>((resolve) => { ffmpeg.stdin!.once('drain', resolve); });
    }
    const m = process.memoryUsage().rss;
    if (m > peakMem) peakMem = m;
    written++;
    if (i % 30 === 0 || i === N - 1) {
      const elapsed = Number(process.hrtime.bigint() - tStart) / 1e6;
      const msPerFrame = elapsed / (i + 1);
      const eta = msPerFrame * (N - i - 1);
      log(`${i + 1}/${N} ms/frame=${msPerFrame.toFixed(2)} ETA=${eta.toFixed(0)} ms`);
    }
  }

  ffmpeg.stdin.end();
  const code = await new Promise<number>((resolve) => ffmpeg.on('close', resolve));
  const totalMs = Number(process.hrtime.bigint() - tStart) / 1e6;
  const msPerFrame = totalMs / N;
  const renderMsPerFrame = totalRender / N;

  if (code !== 0) {
    log(`ffmpeg завершился с кодом ${code}`);
    log(ffmpegErr.slice(-2000));
    process.exit(1);
  }

  log(`записано ${outFile} (${written} кадров, ${totalMs.toFixed(0)} мс, ${msPerFrame.toFixed(2)} мс/кадр, пик памяти ${(peakMem / 1e6).toFixed(0)} МБ)`);

  // приёмка через ffprobe
  let probe: Record<string, string>;
  try { probe = await ffprobe(outFile); } catch (e) { log(`ffprobe не удался: ${e}`); process.exit(1); }

  const checks: Array<{ name: string; ok: boolean; got: string; want: string }> = [];
  const nbFrames = Number(probe.nb_frames);
  const duration = Number(probe.duration);
  const fpsStr = probe.r_frame_rate;
  checks.push({ name: 'кодек', ok: probe.codec_name === 'h264', got: probe.codec_name ?? '', want: 'h264' });
  checks.push({ name: 'pixel format', ok: probe.pix_fmt === 'yuv420p', got: probe.pix_fmt ?? '', want: 'yuv420p' });
  checks.push({ name: 'размер', ok: Number(probe.width) === w && Number(probe.height) === h, got: `${probe.width}x${probe.height}`, want: `${w}x${h}` });
  checks.push({ name: 'fps', ok: fpsStr === `${fps}/1`, got: fpsStr ?? '', want: `${fps}/1` });
  checks.push({ name: 'число кадров', ok: nbFrames === N, got: String(nbFrames), want: String(N) });
  checks.push({ name: 'длительность', ok: Math.abs(duration - (t1 - t0)) < 0.5, got: duration.toFixed(3), want: (t1 - t0).toFixed(3) });

  let allPass = true;
  for (const c of checks) {
    log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}: got=${c.got} want=${c.want}`);
    if (!c.ok) allPass = false;
  }

  log('не проверяет скрипт: звук, плавность на глаз, цветопередачу, соответствие эталону M0, отсутствие артефактов сжатия.');

  if (!allPass) process.exit(1);
  log(`ЭКСПОРТ: OK`);
}

main().catch((e) => { log(`ИСКЛЮЧЕНИЕ: ${e}`); process.exit(1); });
