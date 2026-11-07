// Лесенка предпросмотра: план (кадр / кусок / всё, масштаб) и реальные запуски export.ts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, Path2D } from '@napi-rs/canvas';
import { composeFrame, createRenderCache, locateFrame, projectFrameCount, renderFrame, validateProject, type ProjectV1 } from '../engine/index.ts';
import { PREVIEW_SCALES, planPreview, previewSuffix, scaledSize, type Aspect } from '../engine/preview-plan.ts';
(globalThis as any).Path2D = Path2D;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'out', 'verify-preview');
const failures: string[] = [];
const ok = (c: boolean, l: string) => { if (!c) { failures.push(l); console.error(`FAIL ${l}`); } else console.log(`OK   ${l}`); };

// ---- 1. План: чистая математика ----
const all = planPreview(90, 30, '16:9');
ok(all.ok && all.plan.mode === 'all' && all.plan.startFrame === 0 && all.plan.count === 90 && all.plan.width === 1920 && all.plan.height === 1080, 'без запроса: весь ролик 1920x1080');
const half = planPreview(90, 30, '16:9', { scale: 0.5 });
ok(half.ok && half.plan.width === 960 && half.plan.height === 540 && half.plan.mode === 'all', 'масштаб 0.5: 960x540, режим «всё»');
const quarterV = planPreview(90, 30, '9:16', { scale: 0.25 });
ok(quarterV.ok && quarterV.plan.width === 270 && quarterV.plan.height === 480, '9:16 при 0.25: 270x480');
let evenOk = true;
for (const a of ['16:9', '9:16'] as Aspect[]) for (const s of PREVIEW_SCALES) { const z = scaledSize(a, s); if (z.width % 2 || z.height % 2) evenOk = false; }
ok(evenOk, 'все размеры чётные (нужно для yuv420p)');
const fr = planPreview(90, 30, '16:9', { frame: 1 });
ok(fr.ok && fr.plan.mode === 'frame' && fr.plan.startFrame === 30 && fr.plan.count === 1, 'кадр t=1 → глобальный кадр 30, один кадр');
const clip = planPreview(90, 30, '16:9', { range: { from: 1, to: 2.5 } });
ok(clip.ok && clip.plan.mode === 'clip' && clip.plan.startFrame === 30 && clip.plan.count === 45, 'кусок 1:2.5 → старт 30, 45 кадров');
ok(!planPreview(90, 30, '16:9', { frame: 3 }).ok, 'ошибка: кадр на самой границе длительности (нет такого кадра)');
ok(!planPreview(90, 30, '16:9', { frame: -0.1 }).ok, 'ошибка: кадр до начала');
ok(!planPreview(90, 30, '16:9', { frame: Number.NaN }).ok, 'ошибка: кадр NaN');
ok(!planPreview(90, 30, '16:9', { range: { from: 2, to: 1 } }).ok, 'ошибка: кусок наоборот');
ok(!planPreview(90, 30, '16:9', { range: { from: 0, to: 3.5 } }).ok, 'ошибка: кусок дальше конца');
ok(!planPreview(90, 30, '16:9', { range: { from: 1, to: 1.001 } }).ok, 'ошибка: кусок короче кадра');
ok(!planPreview(90, 30, '16:9', { frame: 1, range: { from: 0, to: 1 } }).ok, 'ошибка: кадр и кусок вместе');
ok(!planPreview(90, 30, '16:9', { scale: 0.3 }).ok, 'ошибка: масштаб 0.3 не из списка');
ok(!planPreview(0, 30, '16:9').ok && !planPreview(90, 0, '16:9').ok, 'ошибка: пустой ролик и fps=0');
ok(JSON.stringify(planPreview(156, 30, '9:16', { range: { from: 1, to: 4 }, scale: 0.5 })) === JSON.stringify(planPreview(156, 30, '9:16', { range: { from: 1, to: 4 }, scale: 0.5 })), 'план детерминирован');

// склейка кусков даёт ровно весь ролик: без потерянных и задвоенных кадров
let seamOk = true;
for (const [fps, total] of [[24, 75], [30, 156], [60, 301]] as const) {
  const duration = total / fps;
  for (const cut of [0.5, 1.37, 2.0, duration / 2]) {
    const a = planPreview(total, fps, '16:9', { range: { from: 0, to: cut } });
    const b = planPreview(total, fps, '16:9', { range: { from: cut, to: duration } });
    if (!a.ok || !b.ok || a.plan.startFrame + a.plan.count !== b.plan.startFrame || a.plan.count + b.plan.count !== total) seamOk = false;
  }
}
ok(seamOk, 'два куска встык (0..x и x..конец) дают ровно все кадры при 24/30/60 fps');

const p1 = planPreview(156, 30, '16:9', { range: { from: 2, to: 5 }, scale: 0.5 });
const p2 = planPreview(156, 30, '16:9', { frame: 3.5 });
ok(p1.ok && previewSuffix(p1.plan, 30) === '_clip2.00-5.00_x0.5', `суффикс куска с масштабом (${p1.ok ? previewSuffix(p1.plan, 30) : 'план отклонён'})`);
ok(p2.ok && previewSuffix(p2.plan, 30) === '_frame3.50', 'суффикс кадра');
ok(all.ok && previewSuffix(all.plan, 30) === '', 'у полного экспорта суффикса нет: пробы не затрут финал');

// ---- 2. Реальные запуски ----
const scene = (title: string, sky: [string, string], sx: number) => ({
  version: 1, title, duration: 3, palette: { sky },
  camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }, { t: 3, x: 0, y: 0, zoom: 1.2 }] }, assets: {},
  layers: [{ id: 'l', name: 'Слой', depth: 1, visible: true, objects: [
    { id: 'sky', name: 'Небо', kind: 'sky', params: {} },
    { id: 'box', name: 'Куб', kind: 'shape', x: sx, y: 0, anim: [{ type: 'move', from: [-300, 0], to: [300, 0], t0: 0, t1: 3, ease: 'lin' }],
      params: { model: { bounds: [-60, -60, 120, 120], parts: [{ id: 'p', name: 'p', d: 'M -60 -60 L 60 -60 L 60 60 L -60 60 Z', fill: '#ffffff' }] } } },
  ] }],
});
const project = {
  version: 1, title: 'Проба', fps: 30, format: '16:9',
  scenes: [
    { id: 's1', name: 'А', scene: scene('А', ['#300808', '#a02020'], 0), transition: { type: 'cut' } },
    { id: 's2', name: 'Б', scene: scene('Б', ['#082040', '#40a0e0'], 0), transition: { type: 'crossfade', duration: 0.8 } },
  ],
} as unknown as ProjectV1;
ok(validateProject(project).ok, 'тестовый проект валиден');
const total = projectFrameCount(project);
ok(total === 156, `в тестовом проекте 156 кадров (получено ${total})`);

fs.mkdirSync(dir, { recursive: true });
const projectFile = path.join(dir, 'mini.project.json');
fs.writeFileSync(projectFile, JSON.stringify(project, null, 2), 'utf8');
const run = (script: string, args: string[]) => spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { cwd: root, encoding: 'utf8' });

const cc = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
function inProcess(index: number, w: number, h: number): Buffer {
  const mk = () => { const c = createCanvas(w, h); return { c, g: c.getContext('2d') as unknown as CanvasRenderingContext2D }; };
  const A = mk(), B = mk(), O = mk();
  const cache = createRenderCache();
  const loc = locateFrame(project, index);
  renderFrame(A.g, project.scenes[loc.frames[0].sceneIndex].scene, loc.frames[0].t, { w, h }, { createCanvas: cc, catalog: {}, cache });
  if (loc.frames[1] && loc.transition) {
    renderFrame(B.g, project.scenes[loc.frames[1].sceneIndex].scene, loc.frames[1].t, { w, h }, { createCanvas: cc, catalog: {}, cache });
    composeFrame(O.g, A.g, B.g, loc.transition.type, loc.transition.progress, { w, h }, {});
    return Buffer.from(O.g.getImageData(0, 0, w, h).data);
  }
  return Buffer.from(A.g.getImageData(0, 0, w, h).data);
}
async function pixels(file: string): Promise<{ w: number; h: number; data: Buffer }> {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: Buffer.from(g.getImageData(0, 0, img.width, img.height).data) };
}
const meanDiff = (a: Buffer, b: Buffer) => { let s = 0, n = 0; for (let i = 0; i < a.length; i += 4) { s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; } return s / n; };

// 2.1 кадр внутри окна перехода: PNG из export.ts == кадр, посчитанный движком напрямую
const framePng = path.join(dir, 'frame-2.5.png');
const rf = run('export.ts', ['--project', projectFile, '--frame', '2.5', '--out', framePng, '--overwrite']);
ok(rf.status === 0 && fs.existsSync(framePng), `--frame 2.5 завершился успешно${rf.status === 0 ? '' : `: ${rf.stdout.slice(-300)}`}`);
const idx = Math.round(2.5 * 30);
const lf = locateFrame(project, idx);
ok(lf.transition !== null && lf.frames.length === 2, 'кадр t=2.5 лежит внутри перехода (две сцены сразу)');
if (fs.existsSync(framePng)) {
  const got = await pixels(framePng);
  ok(got.w === 1920 && got.h === 1080, `PNG кадра 1920x1080 (${got.w}x${got.h})`);
  ok(Buffer.compare(got.data, inProcess(idx, 1920, 1080)) === 0, 'PNG кадра t=2.5 побайтно равен кадру движка (EXACT)');
}

// 2.2 половинный масштаб: размер и содержимое
const halfPng = path.join(dir, 'frame-2.5-half.png');
const rh = run('export.ts', ['--project', projectFile, '--frame', '2.5', '--scale', '0.5', '--out', halfPng, '--overwrite']);
ok(rh.status === 0 && fs.existsSync(halfPng), '--frame 2.5 --scale 0.5 завершился успешно');
if (fs.existsSync(halfPng)) {
  const got = await pixels(halfPng);
  ok(got.w === 960 && got.h === 540, `PNG при 0.5: 960x540 (${got.w}x${got.h})`);
  ok(Buffer.compare(got.data, inProcess(idx, 960, 540)) === 0, 'PNG при 0.5 побайтно равен кадру движка в 960x540 (EXACT)');
}

// 2.3 кусок в переходном окне: старт именно с нужного кадра, без сдвига
const clipMp4 = path.join(dir, 'clip.mp4');
const rc = run('export.ts', ['--project', projectFile, '--range', '2.2:2.8', '--out', clipMp4, '--overwrite']);
ok(rc.status === 0 && fs.existsSync(clipMp4), `--range 2.2:2.8 завершился успешно${rc.status === 0 ? '' : `: ${rc.stdout.slice(-300)}`}`);
if (fs.existsSync(clipMp4)) {
  const v = run('verify-export.ts', [clipMp4, '1920', '1080', '30', '0.6']);
  ok(v.status === 0, `кусок проходит приёмку MP4: 1920x1080, 30 fps, 18 кадров${v.status === 0 ? '' : `\n${v.stdout}`}`);
  const first = path.join(dir, 'clip-first.png');
  const last = path.join(dir, 'clip-last.png');
  const f1 = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', clipMp4, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', first], { encoding: 'utf8' });
  const f2 = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', clipMp4, '-vf', 'select=eq(n\\,17)', '-frames:v', '1', last], { encoding: 'utf8' });
  ok(f1.status === 0 && f2.status === 0 && fs.existsSync(first) && fs.existsSync(last), 'кадры куска вынуты ffmpeg');
  if (fs.existsSync(first) && fs.existsSync(last)) {
    const a = await pixels(first), b = await pixels(last);
    const iFirst = Math.round(2.2 * 30), iLast = Math.round(2.2 * 30) + 17;
    const dFirstRight = meanDiff(a.data, inProcess(iFirst, 1920, 1080));
    const dFirstWrong = meanDiff(a.data, inProcess(iFirst + 6, 1920, 1080));
    const dLastRight = meanDiff(b.data, inProcess(iLast, 1920, 1080));
    const dLastWrong = meanDiff(b.data, inProcess(iLast - 6, 1920, 1080));
    ok(dFirstRight < 3 && dFirstWrong > dFirstRight * 2, `первый кадр куска = кадр 66, не соседний (расхождение ${dFirstRight.toFixed(2)} против ${dFirstWrong.toFixed(2)} у сдвинутого на 6)`);
    ok(dLastRight < 3 && dLastWrong > dLastRight * 2, `последний кадр куска = кадр 83 (расхождение ${dLastRight.toFixed(2)} против ${dLastWrong.toFixed(2)} у сдвинутого на 6)`);
  }
}

// 2.4 кусок в уменьшенном размере и в 9:16
const smallMp4 = path.join(dir, 'clip-small-v.mp4');
const rs = run('export.ts', ['--project', projectFile, '--format', 'v', '--range', '1:2', '--scale', '0.5', '--out', smallMp4, '--overwrite']);
ok(rs.status === 0 && fs.existsSync(smallMp4), '--range 1:2 --scale 0.5 в 9:16 завершился успешно');
if (fs.existsSync(smallMp4)) ok(run('verify-export.ts', [smallMp4, '540', '960', '30', '1']).status === 0, 'проба 9:16 при 0.5 проходит приёмку: 540x960, 30 кадров');

// 2.5 отказы: внятное сообщение и ненулевой код выхода
const bad: Array<[string, string[]]> = [
  ['--frame за пределом', ['--frame', '99']],
  ['--range и --frame вместе', ['--range', '0:1', '--frame', '1']],
  ['--scale вне списка', ['--scale', '0.3']],
  ['--range дальше конца', ['--range', '0:99']],
];
for (const [label, extra] of bad) {
  const r = run('export.ts', ['--project', projectFile, ...extra, '--out', path.join(dir, 'never.mp4'), '--overwrite']);
  ok(r.status !== 0 && /ОШИБКА/.test(r.stdout), `${label}: отказ с понятным сообщением`);
}
ok(!fs.existsSync(path.join(dir, 'never.mp4')), 'при отказе файл не создаётся');

console.log(failures.length ? `check:preview FAIL (${failures.length})` : 'check:preview PASS');
process.exit(failures.length ? 1 : 0);
