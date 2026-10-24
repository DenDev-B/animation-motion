import assert from 'node:assert';
import { cameraShake } from '../engine/shake.ts';
import { cameraPreset } from '../engine/camera-presets.ts';
import { camAt } from '../engine/anim.ts';
import type { Camera, SceneV1 } from '../engine/schema.ts';

const shake = { amp: 20, freq: 8, t0: 2, t1: 4, seed: 7, decay: 'none' as const };
const camera: Camera = { keys: [], shake };

for (const t of [2.1, 2.5, 3, 3.7]) {
  const first = cameraShake(camera, t);
  const second = cameraShake(camera, t);
  assert.deepEqual(second, first, `повторный вызов t=${t}`);
}
assert.deepEqual(cameraShake(camera, 1.9), { x: 0, y: 0 }, 'до t0 тряски нет');
assert.deepEqual(cameraShake(camera, 4.1), { x: 0, y: 0 }, 'после t1 тряски нет');

let maxStep = 0;
let previous = cameraShake(camera, 0.5);
for (let t = 0.5 + 1 / 30; t <= 5.5; t += 1 / 30) {
  const current = cameraShake(camera, t);
  maxStep = Math.max(maxStep, Math.abs(current.x - previous.x), Math.abs(current.y - previous.y));
  previous = current;
}
assert.ok(maxStep < shake.amp, `рывок между кадрами ${maxStep.toFixed(2)}`);

const forward: Array<[number, number]> = [];
for (let i = 0; i < 20; i++) forward.push([cameraShake(camera, 2 + i * 0.1).x, cameraShake(camera, 2 + i * 0.1).y]);
const backward: Array<[number, number]> = [];
for (let i = 19; i >= 0; i--) backward.unshift([cameraShake(camera, 2 + i * 0.1).x, cameraShake(camera, 2 + i * 0.1).y]);
assert.deepEqual(backward, forward, 'результат зависит от порядка кадров');

const sample = cameraShake(camera, 3);
assert.ok(sample.x !== 0 && sample.y !== 0, 'обе оси должны трястись');
assert.ok(Math.abs(sample.x - sample.y) > 1e-6, 'оси должны быть независимыми');

const decaying: Camera = { keys: [], shake: { ...shake, decay: 'out' } };
assert.ok(Math.abs(cameraShake(decaying, 3.99).x) < shake.amp * 0.2, 'decay out не гасит амплитуду');

const second = { amp: 7, freq: 5, t0: 2.5, t1: 3.5, seed: 13 };
const both: Camera = { keys: [], shake: [shake, second] };
const at = cameraShake(both, 3);
const sum = cameraShake({ shake }, 3).x + cameraShake({ shake: second }, 3).x;
assert.ok(Math.abs(at.x - sum) < 1e-9, 'массив трясок должен складываться');

const scene: SceneV1 = {
  version: 1,
  title: 'shake',
  duration: 6,
  palette: { sky: ['#000', '#111'] },
  camera: { keys: [{ t: 0, x: 10, y: 20, zoom: 1 }], shake },
  assets: {},
  layers: [],
};
assert.equal(camAt(1.9, scene).x, 10, 'вне окна камера равна ключу');
assert.ok(Math.abs(camAt(3, scene).x - 10) > 0.5, 'внутри окна камера смещена');

const push = cameraPreset('push-in', { duration: 6 });
assert.deepEqual(push, [{ t: 0, x: 0, y: 0, zoom: 1 }, { t: 6, x: 0, y: 0, zoom: 1.25 }], 'push-in');
const pull = cameraPreset('pull-out', { duration: 6 });
assert.equal(pull[0].zoom, 1.25, 'pull-out начало');
assert.equal(pull[1].zoom, 1, 'pull-out конец');
assert.ok(cameraPreset('pan-left', { duration: 4 })[1].x < 0, 'pan-left');
assert.ok(cameraPreset('pan-right', { duration: 4 })[1].x > 0, 'pan-right');
const drift = cameraPreset('drift', { duration: 6 });
assert.deepEqual([drift[0].x, drift[drift.length - 1].x], [0, 0], 'drift возвращается');
assert.ok(Math.abs(drift[1].x) > 0, 'drift сдвигается в середине');
const staticKeys = cameraPreset('static', { duration: 6, from: { x: 5, y: -6, zoom: 1.1 } });
assert.deepEqual(staticKeys, [{ t: 0, x: 5, y: -6, zoom: 1.1 }], 'static');
assert.equal(cameraPreset('push-in', { duration: 6, strength: 0.5 })[1].zoom, 1.125, 'strength масштабирует zoom');

console.log('check:shake OK (детерминизм, окно, непрерывность, порядок, пресеты)');
