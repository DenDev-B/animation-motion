import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D, type Canvas } from '@napi-rs/canvas';
import { composeFrame, createRenderCache, locateFrame, projectFrameCount, renderFrame, validateAsset, validateProject, type CatalogAsset, type ProjectV1 } from '../engine/index.ts';
import { safeFileName } from './file-names.ts';
(globalThis as any).Path2D = Path2D;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message: string): never { console.error(`ОШИБКА: ${message}`); process.exit(1); }
function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const projectPath = option('--project');
if (!projectPath) fail('укажите --project path');
const step = Number(option('--step', '0.5'));
const cols = Number(option('--cols', '6'));
const thumb = Number(option('--thumb', '320'));
const at = option('--at');
if (!Number.isFinite(step) || step <= 0 || !Number.isInteger(cols) || cols <= 0 || !Number.isInteger(thumb) || thumb <= 0) fail('step, cols и thumb должны быть положительными числами');

const project = JSON.parse(fs.readFileSync(path.resolve(projectPath), 'utf8')) as unknown;
const catalogDir = path.join(root, 'catalog');
const catalog: Record<string, CatalogAsset> = {};
for (const file of fs.readdirSync(catalogDir).filter((name) => name.endsWith('.json'))) {
  const asset = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8')) as CatalogAsset;
  const assetValidation = validateAsset(asset);
  if (!assetValidation.ok) fail(`модель каталога ${file} не прошла валидацию: ${assetValidation.errors.map(({ path: p, message }) => `${p}: ${message}`).join('; ')}`);
  catalog[asset.id] = asset;
}
const validation = validateProject(project, { catalogIds: Object.keys(catalog) });
if (!validation.ok) fail(validation.errors.map(({ path: p, message }) => `${p}: ${message}`).join('\n'));
const value = project as ProjectV1;
const frameCount = projectFrameCount(value);
const duration = frameCount / value.fps;
const frameTimes = Array.from({ length: Math.ceil(duration / step) }, (_, index) => index * step);
const size = value.format === '16:9' ? { w: thumb, h: Math.round(thumb * 9 / 16) } : { w: thumb, h: Math.round(thumb * 16 / 9) };
const cache = createRenderCache();
const createCanvasFn = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
const safeName = safeFileName(path.basename(value.title));
const outputDir = path.join(root, 'out', 'contact');
fs.mkdirSync(outputDir, { recursive: true });

function frameIndex(time: number): number {
  return Math.min(frameCount - 1, Math.max(0, Math.round(time * value.fps)));
}
function locateAt(index: number) {
  return locateFrame(value, Math.min(frameCount - 1, Math.max(0, index)));
}
type CanvasImage = Canvas;
interface Buffers { a: CanvasImage; b: CanvasImage; out: CanvasImage; }
function makeBuffers(width: number, height: number): Buffers {
  return { a: createCanvas(width, height), b: createCanvas(width, height), out: createCanvas(width, height) };
}
function renderFrameAt(index: number, width: number, height: number, buffers: Buffers): CanvasImage {
  const location = locateAt(index);
  const ctxA = buffers.a.getContext('2d') as unknown as CanvasRenderingContext2D;
  const first = location.frames[0];
  renderFrame(ctxA, value.scenes[first.sceneIndex].scene, first.t, { w: width, h: height }, { createCanvas: createCanvasFn, catalog, cache });
  const second = location.frames[1];
  if (!second || !location.transition) return buffers.a;
  const ctxB = buffers.b.getContext('2d') as unknown as CanvasRenderingContext2D;
  const ctxOut = buffers.out.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(ctxB, value.scenes[second.sceneIndex].scene, second.t, { w: width, h: height }, { createCanvas: createCanvasFn, catalog, cache });
  const transition = value.scenes[second.sceneIndex].transition;
  composeFrame(ctxOut, ctxA, ctxB, location.transition.type, location.transition.progress, { w: width, h: height }, { color: transition.color, dir: transition.dir });
  return buffers.out;
}
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

const cellHeight = size.h + 34;
const perSheet = 60;
const thumbBuffers = makeBuffers(size.w, size.h);
for (let start = 0; start < frameTimes.length; start += perSheet) {
  const group = frameTimes.slice(start, start + perSheet);
  const rows = Math.ceil(group.length / cols);
  const sheet = createCanvas(cols * size.w, rows * cellHeight);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#19151f'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  group.forEach((time, index) => {
    const timeIndex = frameIndex(time);
    const location = locateAt(timeIndex);
    const sceneIndex = location.frames[0].sceneIndex;
    const previousIndex = frameIndex(index === 0 ? Math.max(0, frameTimes[start] - step) : group[index - 1]);
    const previousScene = locateAt(previousIndex).frames[0].sceneIndex;
    const col = index % cols, row = Math.floor(index / cols);
    const x = col * size.w, y = row * cellHeight;
    const image = renderFrameAt(timeIndex, size.w, size.h, thumbBuffers);
    ctx.drawImage(image, x, y);
    ctx.strokeStyle = location.transition || sceneIndex !== previousScene ? '#ffb347' : '#51485b';
    ctx.lineWidth = 3; ctx.strokeRect(x + 1, y + 1, size.w - 2, size.h - 2);
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
    const label = location.frames.map((frame) => value.scenes[frame.sceneIndex].name).join(' → ');
    ctx.fillText(`${formatTime(time)} · ${label}`, x + 5, y + size.h + 22);
  });
  const file = path.join(outputDir, `${safeName}_${Math.floor(start / perSheet) + 1}.png`);
  fs.writeFileSync(file, sheet.toBuffer('image/png'));
  console.log(`CONTACT: ${file} (${group.length} миниатюр)`);
}

if (at) {
  const timestamps = at.split(',').map(Number);
  const fullSize = value.format === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
  const fullBuffers = makeBuffers(fullSize.w, fullSize.h);
  for (const time of timestamps) {
    if (!Number.isFinite(time) || time < 0 || time >= duration) fail(`время --at вне проекта: ${time}`);
    const image = renderFrameAt(frameIndex(time), fullSize.w, fullSize.h, fullBuffers);
    const filename = `${safeName}_at_${time.toFixed(1).replace('.', '-')}.png`;
    fs.writeFileSync(path.join(outputDir, filename), image.toBuffer('image/png'));
    console.log(`FRAME: ${path.join(outputDir, filename)}`);
  }
}
console.log(`CONTACT: PASS (${frameTimes.length} кадров, ожидалось ${Math.ceil(duration / step)}, ${frameCount} кадров проекта)`);
