import { createCanvas, Path2D } from '@napi-rs/canvas';
import { camAt } from '../engine/anim.ts';
import { cameraShot, CAMERA_SHOT_NAMES, createRenderCache, remapTime, renderFrame, validateScene, type SceneV1 } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;
const failures: string[] = [];
const ok = (c: boolean, l: string) => { if (!c) { failures.push(l); console.error(`FAIL ${l}`); } else console.log(`OK   ${l}`); };
const cc = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
const base = (extra: Record<string, unknown>): SceneV1 => ({ version: 1, title: 't', duration: 6, palette: { sky: ['#101010', '#202020'] }, camera: { keys: [] }, assets: {}, layers: [{ id: 'l', name: 'l', depth: 1, visible: true, objects: [{ id: 'm', name: 'm', kind: 'shape', anim: [{ type: 'move', from: [-300, 0], to: [300, 0], t0: 0, t1: 6, ease: 'lin' }], params: { model: { bounds: [-30, -30, 60, 60], parts: [{ id: 'p', name: 'p', d: 'M -30 -30 L 30 -30 L 30 30 L -30 30 Z', fill: '#ffffff' }] } } }] }], ...extra }) as unknown as SceneV1;
const frame = (s: SceneV1, t: number) => { const c = createCanvas(400, 400); const g = c.getContext('2d') as unknown as CanvasRenderingContext2D; renderFrame(g, s, t, { w: 400, h: 400 }, { createCanvas: cc, catalog: {}, cache: createRenderCache() }); return c.toBuffer('image/png'); };

// все приёмы дают валидные сцены и ключи в пределах длительности
for (const name of CAMERA_SHOT_NAMES) {
  const s = base({ camera: { keys: [], shot: { name, t0: 1, duration: 3 } } });
  ok(validateScene(s).ok, `shot ${name}: сцена валидна`);
  const r = cameraShot({ name, t0: 1, duration: 3 }, 6);
  ok(r.keys.length > 0 && r.keys.every((k, i) => k.t >= 0 && k.t <= 6 && (i === 0 || k.t > r.keys[i - 1].t) && k.zoom > 0), `shot ${name}: ключи упорядочены, zoom > 0`);
}
ok(!validateScene(base({ camera: { keys: [], shot: { name: 'nope' } } })).ok, 'неизвестный shot отклонён');
ok(!validateScene(base({ camera: { keys: [], shot: { name: 'push-in', strength: 9 } } })).ok, 'strength 9 отклонён');
ok(validateScene(base({ camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }], shot: { name: 'push-in' } } })).warnings.length > 0, 'shot вместе с keys даёт предупреждение');

// crash-zoom: быстрый рывок, потом почти покой
const crash = base({ camera: { keys: [], shot: { name: 'crash-zoom', t0: 1, duration: 3 } } });
const z = (t: number) => camAt(t, crash).zoom;
ok(z(0.5) === 1 && z(1) === 1, 'crash-zoom: до t0 камера стоит');
ok(z(1.35) > 1.55, `crash-zoom: за 0.35 с зум почти полный (${z(1.35).toFixed(3)})`);
ok(z(4) - z(1.35) < 0.08, 'crash-zoom: после рывка зум почти не меняется');
const whip = base({ camera: { keys: [], shot: { name: 'whip-pan', duration: 4 } } });
ok(camAt(0, whip).x === 0 && Math.abs(camAt(4, whip).x - 500) < 1e-6, 'whip-pan: приезжает на +500');
const hh = base({ camera: { keys: [], shot: { name: 'handheld' } } });
ok(camAt(1, hh).x !== camAt(1.3, hh).x, 'handheld: камера дрожит');
ok(Buffer.compare(frame(hh, 2), frame(hh, 2)) === 0, 'handheld: один и тот же кадр при повторе');

// ease ключа камеры
const eased = base({ camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }, { t: 2, x: 0, y: 0, zoom: 2, ease: 'lin' }] } });
ok(Math.abs(camAt(1, eased).zoom - 1.5) < 1e-9, 'ease lin: середина ровно 1.5');
const sineMid = base({ camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }, { t: 2, x: 0, y: 0, zoom: 2 }] } });
ok(Math.abs(camAt(0.5, sineMid).zoom - camAt(0.5, base({ camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }, { t: 2, x: 0, y: 0, zoom: 2, ease: 'sine' }] } })).zoom) < 1e-12, 'без ease = sine (старые сцены прежние)');
ok(!validateScene(base({ camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1, ease: 'bounce' }] } })).ok, 'неизвестный ease отклонён');

// timeRemap
const slow = base({ timeRemap: { keys: [[0, 0], [2, 2], [4, 3], [6, 5]] } });
ok(remapTime(slow, 1) === 1 && remapTime(slow, 3) === 2.5 && remapTime(slow, 4) === 3 && remapTime(slow, 5) === 4, 'линейная переразметка: 0.5× на участке 2–4');
ok(remapTime(base({}), 3.3) === 3.3, 'без timeRemap время не меняется');
ok(remapTime(slow, 7) === 6 && remapTime(slow, -1) === -1, 'вне ключей скорость 1');
const smooth = base({ timeRemap: { smooth: true, keys: [[0, 0], [2, 1], [4, 4], [6, 5]] } });
let mono = true, prev = -1;
for (let t = 0; t <= 6; t += 0.05) { const v = remapTime(smooth, t); if (v < prev - 1e-9) mono = false; prev = v; }
ok(mono, 'smooth не откатывает время назад');
ok(Math.abs(remapTime(smooth, 2) - 1) < 1e-9 && Math.abs(remapTime(smooth, 4) - 4) < 1e-9, 'smooth проходит через ключи');
const freeze = base({ timeRemap: { keys: [[0, 0], [2, 2], [4, 2], [6, 4]] } });
ok(Buffer.compare(frame(freeze, 2.5), frame(freeze, 3.9)) === 0, 'стоп-кадр: кадры 2.5 и 3.9 одинаковы');
ok(Buffer.compare(frame(freeze, 1), frame(freeze, 5)) !== 0, 'вне стопа кадры разные');
ok(Buffer.compare(frame(slow, 3), frame(base({}), 2.5)) === 0, 'кадр t=3 при замедлении равен кадру исходной сцены в 2.5');
ok(Buffer.compare(frame(base({}), 3), frame(base({ timeRemap: undefined }), 3)) === 0, 'сцены без timeRemap рисуются как раньше');
for (const [label, v] of [['t не растёт', { keys: [[0, 0], [0, 1]] }], ['s убывает', { keys: [[0, 2], [2, 1]] }], ['одна пара', { keys: [[0, 0]] }], ['t > duration', { keys: [[0, 0], [9, 9]] }], ['не объект', 5]] as Array<[string, unknown]>) ok(!validateScene(base({ timeRemap: v })).ok, `timeRemap ошибка: ${label}`);
ok(validateScene(slow).ok && validateScene(smooth).ok, 'корректные timeRemap приняты');

if (failures.length) { console.error(`\ncheck:camera-time: ${failures.length} провалов`); process.exit(1); }
console.log('\ncheck:camera-time PASS');
