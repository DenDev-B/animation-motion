import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { createRenderCache, renderFrame, validateScene, type SceneV1 } from '../engine/index.ts';
(globalThis as any).Path2D = Path2D;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures: string[] = [];
const ok = (c: boolean, l: string) => { if (!c) failures.push(l); else console.log(`OK   ${l}`); };
const scene = (obj: Record<string, unknown>): SceneV1 => ({
  version: 1, title: 't', duration: 1, palette: { sky: ['#000000', '#000000'], sun: '#ffd98a' }, camera: { keys: [] }, assets: {},
  layers: [{ id: 'l', name: 'l', depth: 1, visible: true, objects: [{ id: 'o', name: 'o', kind: 'light', x: -300, y: 0, ...obj }] }],
} as unknown as SceneV1);
const cc = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
function render(s: SceneV1) {
  const c = createCanvas(1000, 1000); const g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(g, s, 0, { w: 1000, h: 1000 }, { createCanvas: cc, catalog: {}, cache: createRenderCache() });
  return { g, c };
}
const lum = (g: CanvasRenderingContext2D, x: number, y: number) => { const d = g.getImageData(x, y, 1, 1).data; return d[0] + d[1] + d[2]; };

const cone = scene({ params: { mode: 'cone', a: 0.6, len: 600, w: 160, soft: 0.7 } });
ok(validateScene(cone).ok, 'light cone проходит validateScene');
const a = render(cone);
// центр кадра 500,500; объект в x=-300 → 200; конус вправо до 800
const near = lum(a.g, 260, 500), far = lum(a.g, 700, 500);
ok(near > far && far > 0, `свет гаснет вдоль луча (${near} > ${far} > 0)`);
ok(lum(a.g, 100, 500) === 0, 'за источником темно');
// поперёк луча на x=600: яркость убывает монотонно и без скачка
const cross: number[] = []; for (let y = 500; y <= 500 + 140; y += 5) cross.push(lum(a.g, 600, y));
let mono = true, maxStep = 0; for (let i = 1; i < cross.length; i++) { if (cross[i] > cross[i - 1] + 20) mono = false; maxStep = Math.max(maxStep, cross[i - 1] - cross[i]); }
ok(mono, 'поперёк луча яркость не растёт к краю');
ok(maxStep < cross[0] * 0.3, `нет жёсткого края: макс. шаг ${maxStep} < 25% центра ${cross[0]}`);
const hard = render(scene({ params: { mode: 'cone', a: 0.6, len: 600, w: 160, soft: 0 } }));
const hc: number[] = []; for (let y = 500; y <= 660; y += 2) hc.push(lum(hard.g, 600, y));
let hardStep = 0; for (let i = 1; i < hc.length; i++) hardStep = Math.max(hardStep, hc[i - 1] - hc[i]);
ok(hardStep > maxStep * 2, `soft=0 даёт резкий край (шаг ${hardStep} против ${maxStep})`);
// поворот
const rotated = render(scene({ rot: 90, params: { mode: 'cone', a: 0.6, len: 600, w: 160 } }));
ok(lum(rotated.g, 200, 700) > 0 && lum(rotated.g, 700, 500) === 0, 'rot=90 направляет конус вниз');
// пятно
const pool = render(scene({ params: { mode: 'pool', r: 200, squash: 0.3, a: 0.7 } }));
ok(lum(pool.g, 200, 500) > lum(pool.g, 330, 500) && lum(pool.g, 200, 500) > lum(pool.g, 200, 560) * 1, 'pool: центр ярче края');
ok(lum(pool.g, 200, 560) < lum(pool.g, 260, 500), 'pool сплющен по Y');
// аддитивность: на светлом фоне не темнее
const lit = scene({ params: { mode: 'cone', a: 0.5 } }); (lit.palette as any).sky = ['#404040', '#404040'];
(lit.layers[0].objects as any).unshift({ id: 's', name: 's', kind: 'sky' });
const lr = render(lit); ok(lum(lr.g, 300, 500) > lum(lr.g, 100, 500), 'additive: свет добавляется к фону');
ok(Buffer.compare(a.c.toBuffer('image/png'), render(cone).c.toBuffer('image/png')) === 0, 'кадр воспроизводим');
const bad = scene({ params: { mode: 'ray' } }); ok(!validateScene(bad).ok, 'ошибка: неизвестный mode');
const bad2 = scene({ params: { a: 2 } }); ok(!validateScene(bad2).ok, 'ошибка: a > 1');
fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out', 'check-light.png'), a.c.toBuffer('image/png'));
if (failures.length) { console.error(`check:light FAIL\n${failures.map((f) => ' - ' + f).join('\n')}`); process.exit(1); }
console.log('check:light PASS');
