import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { renderFrame, createRenderCache, validateScene, validateProject, projectFrameCount, locateFrame, type SceneV1, type ProjectV1, type CatalogAsset } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;

function log(m: string) { process.stdout.write(m + '\n'); }
function fail(m: string): never { log(`ОШИБКА: ${m}`); process.exit(1); }

function parseArgs(): { scene: string; project: string; format?: string; fps?: number; t0: number; t1?: number; out: string; crf: number; preset: string; overwrite: boolean } {
  const args = process.argv.slice(2);
  let scene = '';
  let format: string | undefined;
  let project = '';
  let fps: number | undefined;
  let range: string | undefined;
  let out: string | undefined;
  let crf = 18;
  let preset = 'veryfast';
  let overwrite = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project') project = args[++i];
    else if (a === '--format') format = args[++i];
    else if (a === '--fps') fps = +args[++i];
    else if (a === '--range') range = args[++i];
    else if (a === '--out') out = args[++i];
    else if (a === '--crf') crf = +args[++i];
    else if (a === '--preset') preset = args[++i];
    else if (a === '--overwrite') overwrite = true;
    else if (!a.startsWith('-')) scene = a;
    else fail(`неизвестный аргумент ${a}`);
  }
  if (!scene && !project) fail('укажите scene.json аргументом или --project path');
  if (scene && !format) fail('для одиночной сцены укажите --format h|v');
  if (fps !== undefined && fps <= 0) fail('fps должен быть больше 0');
  let t0 = 0, t1: number | undefined;
  if (range) { const [a, b] = range.split(':').map(Number); if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) fail(`некорректный --range ${range}`); t0 = a; t1 = b; }
  return { scene, project, format, fps, t0, t1, out: out ?? '', crf, preset, overwrite };
}

async function ffprobe(file: string): Promise<Record<string, string>> {
  const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames,duration -of json "${file}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const s = JSON.parse(out).streams[0];
  return s;
}

async function main() {
  const args = parseArgs();
  const { scene, project: projectPath, crf, preset, t0 } = args;

  // каталог
  const catalogDir = path.join(__dirname, '..', 'catalog');
  const catalog: Record<string, CatalogAsset> = {};
  for (const f of fs.readdirSync(catalogDir)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')) as CatalogAsset;
    catalog[c.id] = c;
  }
  log(`каталог: ${Object.keys(catalog).join(', ') || '(пуст)'}`);

  let projectV1: ProjectV1 | null = null;
  let sceneV1: SceneV1 | null = null;
  if (projectPath) {
    const raw = JSON.parse(fs.readFileSync(projectPath, 'utf8')) as unknown;
    const result = validateProject(raw);
    if (!result.ok) { log('проект не прошёл валидацию:'); for (const e of result.errors) log(`  ${e.path}: ${e.message}`); process.exit(1); }
    projectV1 = raw as ProjectV1;
  } else {
    const raw = JSON.parse(fs.readFileSync(scene, 'utf8')) as unknown;
    const result = validateScene(raw, { catalogIds: Object.keys(catalog) });
    if (!result.ok) { log('сцена не прошла валидацию:'); for (const e of result.errors) log(`  ${e.path}: ${e.message}`); process.exit(1); }
    sceneV1 = raw as SceneV1;
  }
  const format = args.format ?? projectV1!.format;
  const aspect = format === 'h' || format === '16:9' ? '16:9' : format === 'v' || format === '9:16' ? '9:16' : '';
  if (!aspect) fail('format должен быть h, v, 16:9 или 9:16');
  const fps = args.fps ?? projectV1?.fps ?? 30;
  const w = aspect === '16:9' ? 1920 : 1080;
  const h = aspect === '16:9' ? 1080 : 1920;
  const sceneDuration = sceneV1?.duration ?? projectV1!.scenes.reduce((sum, entry) => sum + entry.scene.duration, 0);
  const t1 = args.t1 ?? sceneDuration;
  if (t1 > sceneDuration) fail(`--range заканчивается ${t1} > длительность ${sceneDuration}`);
  if (t0 >= t1) fail(`--range начинается ${t0} >= длительность ${t1}`);
  const N = projectV1 ? projectFrameCount({ ...projectV1, fps }) : Math.round((t1 - t0) * fps);
  log(`${projectPath ? `проект: ${projectPath}` : `сцена: ${scene}`}, длительность=${t1} с, N=${N} при ${fps} fps`);

  const requestedOutFile = (() => {
    if (process.argv.includes('--out')) {
      const i = process.argv.indexOf('--out');
      return process.argv[i + 1];
    }
    const base = projectV1 ? path.basename(projectV1.title).replace(/[\\/:*?"<>|]/g, '_') : path.basename(scene, '.json');
    return path.join(__dirname, '..', projectV1 ? 'out/export' : 'out/video', `${base}_${aspect}.mp4`);
  })();
  let outFile = requestedOutFile;
  if (!args.overwrite) { let suffix = 2; while (fs.existsSync(outFile)) outFile = requestedOutFile.replace(/\.mp4$/, `_${suffix++}.mp4`); }
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
  let secondSceneBaseline: Buffer | null = null;

  for (let i = 0; i < N; i++) {
    const location = projectV1 ? locateFrame({ ...projectV1, fps }, i) : null;
    const currentScene = projectV1 ? projectV1.scenes[location!.sceneIndex].scene : sceneV1!;
    const t = projectV1 ? location!.t : t0 + i / fps;
    const tr0 = process.hrtime.bigint();
    renderFrame(ctx, currentScene, t, { w, h }, { createCanvas: createCanvasFn, catalog, cache });
    const imgData = ctx.getImageData(0, 0, w, h);
    if (projectV1 && location!.sceneIndex === 1 && t === 0) {
      const separateCanvas = createCanvas(w, h);
      const separateCtx = separateCanvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      renderFrame(separateCtx, currentScene, 0, { w, h }, { createCanvas: createCanvasFn, catalog, cache: createRenderCache() });
      const separateData = separateCtx.getImageData(0, 0, w, h).data;
      const projectData = imgData.data;
      if (Buffer.compare(Buffer.from(separateData), Buffer.from(projectData)) !== 0) fail('кадр 0 второй сцены не совпал с отдельным рендером: FAIL');
      secondSceneBaseline = Buffer.from(separateData);
    }
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
      log(`${i + 1}/${N} сцена=${location ? location.sceneIndex + 1 : 1} ms/frame=${msPerFrame.toFixed(2)} ETA=${eta.toFixed(0)} ms`);
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
  checks.push({ name: 'длительность', ok: Math.abs(duration - N / fps) <= 1 / fps, got: duration.toFixed(3), want: (N / fps).toFixed(3) });
  if (projectV1) checks.push({ name: 'кадр второй сцены EXACT', ok: secondSceneBaseline !== null, got: secondSceneBaseline ? 'EXACT' : 'кадр не найден', want: 'EXACT' });

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
