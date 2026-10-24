import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { composeFrame, locateFrame, projectFrameCount, validateProject, type ProjectV1 } from '../engine/index.ts';
import { readCatalogIds } from './catalog-ids.ts';
(globalThis as any).Path2D = Path2D;

const catalogIds = readCatalogIds();
const project = JSON.parse(fs.readFileSync('projects/transitions-demo.project.json', 'utf8')) as ProjectV1;
const validation = validateProject(project, { catalogIds });
assert.ok(validation.ok, `transitions-demo не проходит валидацию: ${JSON.stringify(validation.errors)}`);

const total = projectFrameCount(project);
const sceneFrames = project.scenes.reduce((sum, entry) => sum + Math.round(entry.scene.duration * project.fps), 0);
const overlaps = project.scenes.reduce((sum, entry, index) => sum + (index > 0 && entry.transition.type !== 'cut' ? Math.round((entry.transition.duration ?? 0) * project.fps) : 0), 0);
assert.equal(total, sceneFrames - overlaps, 'projectFrameCount должен учитывать наложения');

const blocks = new Map<number, number[]>();
for (let index = 0; index < total; index++) {
  const location = locateFrame(project, index);
  assert.ok(location.frames.length === 1 || location.frames.length === 2, `кадр ${index}: ожидалось 1-2 сцены, получено ${location.frames.length}`);
  for (const frame of location.frames) assert.ok(frame.t >= 0 && frame.t < project.scenes[frame.sceneIndex].scene.duration, `кадр ${index}: t ${frame.t} вне сцены ${frame.sceneIndex}`);
  if (location.frames.length === 2) {
    const second = location.frames[1].sceneIndex;
    assert.ok(location.transition, `кадр ${index}: наложение без transition`);
    assert.equal(location.transition!.type, project.scenes[second].transition.type);
    const list = blocks.get(second) ?? [];
    list.push(index);
    blocks.set(second, list);
  }
}

for (let sceneIndex = 1; sceneIndex < project.scenes.length; sceneIndex++) {
  const transition = project.scenes[sceneIndex].transition;
  const expected = Math.round((transition.duration ?? 0) * project.fps);
  const list = blocks.get(sceneIndex);
  assert.ok(list, `сцена ${sceneIndex}: нет кадров перехода`);
  assert.equal(list!.length, expected, `сцена ${sceneIndex}: неверное число кадров перехода`);
  const first = list![0];
  const last = list![list!.length - 1];
  assert.equal(locateFrame(project, first).transition!.progress, 0, `сцена ${sceneIndex}: progress на первом кадре`);
  const lastLocation = locateFrame(project, last);
  assert.equal(lastLocation.transition!.progress, 1, `сцена ${sceneIndex}: progress на последнем кадре`);
  assert.equal(lastLocation.frames[1].t, (expected - 1) / project.fps);
  assert.equal(locateFrame(project, first).frames[1].t, 0);
  if (first > 0) assert.equal(locateFrame(project, first - 1).frames.length, 1);
  if (last + 1 < total) {
    const after = locateFrame(project, last + 1);
    assert.equal(after.frames.length, 1);
    assert.equal(after.frames[0].sceneIndex, sceneIndex);
  }
}

const whale = JSON.parse(fs.readFileSync('projects/whale-demo.project.json', 'utf8')) as ProjectV1;
const whaleTotal = projectFrameCount(whale);
assert.equal(whaleTotal, whale.scenes.reduce((sum, entry) => sum + Math.round(entry.scene.duration * whale.fps), 0), 'cut-проект не должен терять кадры');
let offset = 0;
for (let sceneIndex = 0; sceneIndex < whale.scenes.length; sceneIndex++) {
  const frames = Math.round(whale.scenes[sceneIndex].scene.duration * whale.fps);
  for (let local = 0; local < frames; local++) {
    const location = locateFrame(whale, offset + local);
    assert.equal(location.frames.length, 1, `whale кадр ${offset + local}: ложное наложение`);
    assert.equal(location.frames[0].sceneIndex, sceneIndex);
    assert.equal(location.frames[0].t, local / whale.fps);
  }
  offset += frames;
}

function expectError(mutate: (value: ProjectV1) => void, path: string): void {
  const value = structuredClone(project);
  mutate(value);
  const result = validateProject(value, { catalogIds });
  assert.equal(result.ok, false, `${path}: ожидалась ошибка`);
  assert.ok(result.errors.some((issue) => issue.path === path), `${path}: нет ошибки, есть ${JSON.stringify(result.errors)}`);
}
expectError((value) => { (value.scenes[1].transition as any).type = 'unknown'; }, 'scenes[1].transition.type');
expectError((value) => { value.scenes[1].transition.duration = 2; }, 'scenes[1].transition.duration');
expectError((value) => { value.scenes[1].transition.duration = -1; }, 'scenes[1].transition.duration');
expectError((value) => { value.scenes[0].transition = { type: 'fade', duration: 0.5 }; }, 'scenes[0].transition.type');
expectError((value) => { value.scenes[3].transition.dir = 'diagonal' as any; }, 'scenes[3].transition.dir');
expectError((value) => { value.scenes[2].transition.color = 'red'; }, 'scenes[2].transition.color');

const size = { w: 32, h: 18 };
function solid(color: string): CanvasRenderingContext2D {
  const canvas = createCanvas(size.w, size.h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size.w, size.h);
  return ctx;
}
function pixels(ctx: CanvasRenderingContext2D): Buffer {
  return Buffer.from(ctx.getImageData(0, 0, size.w, size.h).data);
}
function sha(ctx: CanvasRenderingContext2D): string {
  return crypto.createHash('sha256').update(pixels(ctx)).digest('hex');
}
const A = solid('#ff0000');
const B = solid('#0000ff');
const out = createCanvas(size.w, size.h).getContext('2d') as unknown as CanvasRenderingContext2D;
const kinds = ['fade', 'crossfade', 'slide', 'wipe', 'dip'] as const;
for (const kind of kinds) {
  composeFrame(out, A, B, kind, 0, size, { color: '#000', dir: 'left' });
  assert.ok(pixels(out).equals(pixels(A)), `${kind}: progress 0 должен давать кадр A`);
  composeFrame(out, A, B, kind, 1, size, { color: '#000', dir: 'left' });
  assert.ok(pixels(out).equals(pixels(B)), `${kind}: progress 1 должен давать кадр B`);
}
composeFrame(out, A, B, 'cut', 0, size);
assert.ok(pixels(out).equals(pixels(A)), 'cut: progress 0');
composeFrame(out, A, B, 'cut', 1, size);
assert.ok(pixels(out).equals(pixels(B)), 'cut: progress 1');

composeFrame(out, A, B, 'crossfade', 0.5, size);
const half = pixels(out);
for (const channel of [0, 2]) assert.ok(Math.abs(half[channel] - 127.5) <= 1, `crossfade 50%: канал ${channel} = ${half[channel]}`);
assert.equal(half[1], 0, 'crossfade 50%: зелёный канал');

composeFrame(out, A, B, 'fade', 0.5, size, { color: '#000' });
const faded = pixels(out);
for (let index = 0; index < faded.length; index += 4) assert.deepEqual([faded[index], faded[index + 1], faded[index + 2], faded[index + 3]], [0, 0, 0, 255], 'fade 50% должен давать цвет');

composeFrame(out, A, B, 'crossfade', 0.37, size);
const firstHash = sha(out);
composeFrame(out, A, B, 'crossfade', 0.37, size);
assert.equal(sha(out), firstHash, 'композитинг должен быть детерминирован');

console.log(`check:transitions PASS (${total} кадров, ${blocks.size} переходов)`);
