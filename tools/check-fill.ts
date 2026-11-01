import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { createRenderCache, renderFrame, validateAsset, validateScene, type CatalogAsset, type SceneV1 } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures: string[] = [];
const ok = (cond: boolean, label: string) => { if (!cond) failures.push(label); else console.log(`OK   ${label}`); };

const box = 'M -100 -100 L 100 -100 L 100 100 L -100 100 Z';
const model = (fill: unknown, extra: Record<string, unknown> = {}): CatalogAsset => ({ version: 1, id: 'g', name: 'g', bounds: [-100, -100, 200, 200], parts: [{ id: 'p', name: 'p', d: box, fill, ...extra }] } as unknown as CatalogAsset);
const linear = { type: 'linear', from: [0, -100], to: [0, 100], stops: [[0, '#ff0000'], [1, '#0000ff']] };
const radial = { type: 'radial', c: [0, 0], r: 100, stops: [[0, '#ffffff'], [1, '#00000000']] };

// валидатор: допустимые
ok(validateAsset(model(linear), { inline: true }).ok, 'linear валиден');
ok(validateAsset(model(radial), { inline: true }).ok, 'radial с прозрачной остановкой валиден');
ok(validateAsset(model({ ...linear, stops: [[0, 'rim'], [1, 'near']] }), { inline: true }).ok, 'слоты палитры в остановках валидны');
// валидатор: ошибки
const bad: Array<[string, unknown]> = [
  ['неизвестный type', { ...linear, type: 'conic' }],
  ['from = to', { ...linear, to: [0, -100] }],
  ['одна остановка', { ...linear, stops: [[0, '#fff']] }],
  ['смещение вне 0..1', { ...linear, stops: [[0, '#fff'], [1.5, '#000']] }],
  ['смещения убывают', { ...linear, stops: [[0.8, '#fff'], [0.2, '#000']] }],
  ['плохой цвет', { ...linear, stops: [[0, '#xyz'], [1, '#000']] }],
  ['radial r<=0', { ...radial, r: 0 }],
  ['лишнее поле', { ...linear, foo: 1 }],
  ['масса остановок', { ...linear, stops: Array.from({ length: 13 }, (_, i) => [i / 12, '#fff']) }],
];
for (const [label, fill] of bad) ok(!validateAsset(model(fill), { inline: true }).ok, `ошибка: ${label}`);
ok(!validateAsset({ ...model('#fff'), parts: [{ id: 'l', name: 'l', type: 'line', d: 'M 0 0 L 1 1', fill: linear, stroke: { color: '#fff', w: 2 } }] } as unknown as CatalogAsset, { inline: true }).ok, 'ошибка: градиент у line');

// рендер
const scene = (asset: CatalogAsset, color?: string): SceneV1 => ({
  version: 1, title: 't', duration: 1, palette: { sky: ['#202020', '#202020'], rim: '#ff00ff', near: '#00ff00' }, camera: { keys: [] }, assets: {},
  layers: [{ id: 'l', name: 'l', depth: 1, visible: true, objects: [{ id: 'o', name: 'o', kind: 'shape', ...(color ? { color } : {}), params: { model: asset } }] }],
} as unknown as SceneV1);
const cc = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
function render(s: SceneV1, w = 400, h = 400) {
  const c = createCanvas(w, h); const g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(g, s, 0, { w, h }, { createCanvas: cc, catalog: {}, cache: createRenderCache() });
  return { g, c };
}
const px = (g: CanvasRenderingContext2D, x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data);
// кадр 400x400: высота 1000 → K=0.4; центр (200,200); квадрат 200 → 80 пикселей; верх y≈168, низ y≈232
const a = render(scene(model(linear)));
const top = px(a.g, 200, 172), bottom = px(a.g, 200, 228);
ok(top[0] > 200 && top[2] < 60, `linear: верх красный (${top})`);
ok(bottom[2] > 200 && bottom[0] < 60, `linear: низ синий (${bottom})`);
const mid = px(a.g, 200, 200);
ok(mid[0] > 80 && mid[2] > 80, `linear: середина смешана (${mid})`);
const r = render(scene(model(radial)));
const centre = px(r.g, 200, 200), edge = px(r.g, 200 + 38, 200);
ok(centre[0] > 230 && edge[0] < centre[0] - 60, `radial: центр ярче края (${centre} / ${edge})`);
const flat = render(scene(model(linear), '#00ff00'));
const fp = px(flat.g, 200, 172);
ok(fp[1] > 240 && fp[0] < 10, `color у объекта перекрашивает градиент плоско (${fp})`);
const again = render(scene(model(linear)));
ok(Buffer.compare(a.c.toBuffer('image/png'), again.c.toBuffer('image/png')) === 0, 'кадр с градиентом воспроизводим');
const sceneValidation = validateScene(scene(model(linear)));
ok(sceneValidation.ok, 'сцена с градиентной моделью проходит validateScene');

// пример для глаз
const outDir = path.join(root, 'out'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'check-fill.png'), a.c.toBuffer('image/png'));
if (failures.length) { console.error(`check:fill FAIL\n${failures.map((f) => ' - ' + f).join('\n')}`); process.exit(1); }
console.log('check:fill PASS');
