import { createCanvas, Path2D } from '@napi-rs/canvas';
import { createRenderCache, renderFrame, validateScene, type SceneV1 } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;
const failures: string[] = [];
const ok = (c: boolean, l: string) => { if (!c) failures.push(l); else console.log(`OK   ${l}`); };
const box = 'M -100 -100 L 100 -100 L 100 100 L -100 100 Z';
const model = { bounds: [-100, -100, 200, 200], parts: [
  { id: 'a', name: 'a', d: box, fill: '#ff0000' },
  { id: 'b', name: 'b', d: 'M -20 -20 L 20 -20 L 20 20 L -20 20 Z', fill: { type: 'linear', from: [0, -20], to: [0, 20], stops: [[0, '#ff0000'], [1, '#ff0000']] } },
  { id: 'c', name: 'c', d: 'M 110 -20 L 140 -20 L 140 20 L 110 20 Z', fill: '#ff000080' },
] };
const scene = (haze?: number): SceneV1 => ({
  version: 1, title: 't', duration: 1, palette: { sky: ['#000000', '#000000'], haze: '#0000ff' }, camera: { keys: [] }, assets: {},
  layers: [{ id: 'l', name: 'l', depth: 1, visible: true, objects: [{ id: 'sky', name: 'sky', kind: 'sky' }, { id: 'o', name: 'o', kind: 'shape', params: { model, ...(haze === undefined ? {} : { haze }) } }] }],
} as unknown as SceneV1);
const cc = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
function px(s: SceneV1, x: number, y: number) {
  const c = createCanvas(400, 400); const g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(g, s, 0, { w: 400, h: 400 }, { createCanvas: cc, catalog: {}, cache: createRenderCache() });
  return { p: Array.from(g.getImageData(x, y, 1, 1).data), png: c.toBuffer('image/png') };
}
ok(validateScene(scene(0.5)).ok, 'haze 0.5 проходит validateScene');
ok(!validateScene(scene(1.5)).ok, 'ошибка: haze > 1');
const none = px(scene(), 170, 200), zero = px(scene(0), 170, 200);
ok(Buffer.compare(none.png, zero.png) === 0, 'haze=0 даёт кадр, идентичный отсутствию haze');
ok(none.p[0] > 240 && none.p[2] < 10, `без дымки цвет красный (${none.p})`);
const half = px(scene(0.5), 170, 200);
ok(half.p[0] > 100 && half.p[0] < 150 && half.p[2] > 100 && half.p[2] < 150, `haze=0.5 смешивает с синим (${half.p})`);
const full = px(scene(1), 170, 200);
ok(full.p[2] > 240 && full.p[0] < 10, `haze=1 даёт цвет дымки (${full.p})`);
const grad = px(scene(1), 200, 200);
ok(grad.p[2] > 240 && grad.p[0] < 10, `дымка действует и на градиент (${grad.p})`);
const alpha = px(scene(1), 250, 200);
ok(alpha.p[2] > 100 && alpha.p[2] < 160 && alpha.p[0] < 10, `полупрозрачность сохраняется под дымкой (${alpha.p})`);
if (failures.length) { console.error(`check:haze FAIL\n${failures.map((f) => ' - ' + f).join('\n')}`); process.exit(1); }
console.log('check:haze PASS');
