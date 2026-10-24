import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { createRenderCache, projectFrameCount, renderFrame, validateProject, type CatalogAsset, type ProjectV1 } from '../engine/index.ts';
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
const validation = validateProject(project);
if (!validation.ok) fail(validation.errors.map(({ path: p, message }) => `${p}: ${message}`).join('\n'));
const value = project as ProjectV1;
const duration = value.scenes.reduce((sum, entry) => sum + entry.scene.duration, 0);
const frameCount = projectFrameCount(value);
const frameTimes = Array.from({ length: Math.ceil(duration / step) }, (_, index) => index * step);
const catalogDir = path.join(root, 'catalog');
const catalog: Record<string, CatalogAsset> = {};
for (const file of fs.readdirSync(catalogDir).filter((name) => name.endsWith('.json'))) {
  const asset = JSON.parse(fs.readFileSync(path.join(catalogDir, file), 'utf8')) as CatalogAsset;
  catalog[asset.id] = asset;
}
const size = value.format === '16:9' ? { w: thumb, h: Math.round(thumb * 9 / 16) } : { w: thumb, h: Math.round(thumb * 16 / 9) };
const cache = createRenderCache();
const createCanvasFn = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
const safeName = path.basename(value.title).replace(/[\\/:*?"<>|]/g, '_');
const outputDir = path.join(root, 'out', 'contact');
fs.mkdirSync(outputDir, { recursive: true });

function locateTime(time: number): { sceneIndex: number; localTime: number } {
  let elapsed = 0;
  for (let sceneIndex = 0; sceneIndex < value.scenes.length; sceneIndex++) {
    const scene = value.scenes[sceneIndex].scene;
    if (time < elapsed + scene.duration || sceneIndex === value.scenes.length - 1) return { sceneIndex, localTime: Math.min(time - elapsed, scene.duration) };
    elapsed += scene.duration;
  }
  return { sceneIndex: value.scenes.length - 1, localTime: 0 };
}
function render(time: number, sceneIndex: number, localTime: number, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const scene = value.scenes[sceneIndex].scene;
  renderFrame(ctx, scene, localTime, { w: width, h: height }, { createCanvas: createCanvasFn, catalog, cache });
  return canvas;
}
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

const cellHeight = size.h + 34;
const perSheet = 60;
for (let start = 0; start < frameTimes.length; start += perSheet) {
  const group = frameTimes.slice(start, start + perSheet);
  const rows = Math.ceil(group.length / cols);
  const sheet = createCanvas(cols * size.w, rows * cellHeight);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#19151f'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  group.forEach((time, index) => {
    const { sceneIndex, localTime } = locateTime(time);
    const col = index % cols, row = Math.floor(index / cols);
    const x = col * size.w, y = row * cellHeight;
    const image = render(time, sceneIndex, localTime, size.w, size.h);
    ctx.drawImage(image, x, y);
    ctx.strokeStyle = sceneIndex !== (index === 0 ? locateTime(frameTimes[start] - step).sceneIndex : locateTime(group[index - 1]).sceneIndex) ? '#ffb347' : '#51485b';
    ctx.lineWidth = 3; ctx.strokeRect(x + 1, y + 1, size.w - 2, size.h - 2);
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
    ctx.fillText(`${formatTime(time)} · ${value.scenes[sceneIndex].name}`, x + 5, y + size.h + 22);
  });
  const file = path.join(outputDir, `${safeName}_${Math.floor(start / perSheet) + 1}.png`);
  fs.writeFileSync(file, sheet.toBuffer('image/png'));
  console.log(`CONTACT: ${file} (${group.length} миниатюр)`);
}

if (at) {
  const timestamps = at.split(',').map(Number);
  for (const time of timestamps) {
    if (!Number.isFinite(time) || time < 0 || time >= duration) fail(`время --at вне проекта: ${time}`);
    const { sceneIndex, localTime } = locateTime(time);
    const fullSize = value.format === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
    const image = render(time, sceneIndex, localTime, fullSize.w, fullSize.h);
    const filename = `${safeName}_at_${time.toFixed(1).replace('.', '-')}.png`;
    fs.writeFileSync(path.join(outputDir, filename), image.toBuffer('image/png'));
    console.log(`FRAME: ${path.join(outputDir, filename)}`);
  }
}
console.log(`CONTACT: PASS (${frameTimes.length} кадров, ожидалось ${Math.ceil(duration / step)}, ${frameCount} кадров проекта)`);
