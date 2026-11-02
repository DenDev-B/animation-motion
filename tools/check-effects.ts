import { createCanvas, Path2D } from '@napi-rs/canvas';
import { createRenderCache, renderFrame, validateScene, type SceneV1 } from '../engine/index.ts';
import { STYLE_PRESETS } from '../engine/styles.ts';
(globalThis as any).Path2D = Path2D;
const failures: string[] = [];
const ok = (c: boolean, l: string) => { if (!c) { failures.push(l); console.error(`FAIL ${l}`); } else console.log(`OK   ${l}`); };
const cc = ((w: number, h: number) => createCanvas(w, h)) as unknown as (w: number, h: number) => HTMLCanvasElement;
const sq = (half: number) => `M ${-half} ${-half} L ${half} ${-half} L ${half} ${half} L ${-half} ${half} Z`;
const model = (fill: string, half = 60) => ({ bounds: [-half, -half, half * 2, half * 2], parts: [{ id: 'p', name: 'p', d: sq(half), fill }] });
function scene(style: Record<string, unknown> | undefined, objects: unknown[] = [{ id: 'o', name: 'o', kind: 'shape', params: { model: model('#c83232') } }], depth = 1): SceneV1 {
  return { version: 1, title: 't', duration: 1, palette: { sky: ['#101010', '#101010'], haze: '#0000ff' }, ...(style ? { style } : {}), camera: { keys: [] }, assets: {},
    layers: [{ id: 'l', name: 'l', depth, visible: true, objects: [{ id: 'sky', name: 'sky', kind: 'sky' }, ...objects] }] } as unknown as SceneV1;
}
function render(s: SceneV1, w = 400, h = 400) {
  const c = createCanvas(w, h); const g = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(g, s, 0, { w, h }, { createCanvas: cc, catalog: {}, cache: createRenderCache() });
  return { g, png: c.toBuffer('image/png') };
}
const px = (r: { g: CanvasRenderingContext2D }, x: number, y: number) => Array.from(r.g.getImageData(x, y, 1, 1).data);

// без новых полей кадр прежний
const plain = render(scene(undefined));
ok(Buffer.compare(plain.png, render(scene({})).png) === 0, 'пустой style: кадр прежний');
ok(Buffer.compare(plain.png, render(scene({ grade: {}, depthHaze: 0 })).png) === 0, 'пустой grade и depthHaze=0: кадр прежний');
ok(validateScene(scene({ grade: { saturation: 1.1, tint: 'haze' }, bloom: { strength: 0.3 }, depthHaze: 0.4 })).ok, 'валидатор принимает grade/bloom/depthHaze');
for (const [label, style] of [['saturation > 2', { grade: { saturation: 3 } }], ['contrast < 0.5', { grade: { contrast: 0.1 } }], ['bad tint', { grade: { tint: 'nope' } }], ['bloom radius > 60', { bloom: { radius: 100 } }], ['depthHaze > 1', { depthHaze: 2 }], ['grade не объект', { grade: 5 }]] as Array<[string, Record<string, unknown>]>) ok(!validateScene(scene(style)).ok, `ошибка: ${label}`);

// цветокоррекция
const base = px(plain, 200, 200);
const gray = px(render(scene({ grade: { saturation: 0 } })), 200, 200);
ok(Math.abs(gray[0] - gray[1]) < 3 && Math.abs(gray[1] - gray[2]) < 3 && base[0] - base[1] > 60, `saturation=0 даёт серый (${gray})`);
const bright = px(render(scene({ grade: { brightness: 0.2 } })), 200, 200);
ok(bright[0] > base[0] || bright[1] > base[1], `brightness поднимает яркость (${base} → ${bright})`);
const tinted = px(render(scene({ grade: { tint: '#0000ff', tintAmount: 0.5 } })), 200, 200);
ok(tinted[2] > base[2] + 60, `tint добавляет синий (${base} → ${tinted})`);
const contrast = render(scene({ grade: { contrast: 1.8 } }));
ok(px(contrast, 200, 200)[0] > base[0], 'contrast усиливает яркую красную');

// свечение
const bulb = [{ id: 'b', name: 'b', kind: 'shape', params: { model: model('#ffffff', 50) } }];
const noBloom = render(scene(undefined, bulb));
const bloom = render(scene({ bloom: { threshold: 0.6, strength: 1, radius: 40 } }, bulb));
const near = [px(noBloom, 200, 200 + 28), px(bloom, 200, 200 + 28)];
const far = [px(noBloom, 20, 20), px(bloom, 20, 20)];
ok(near[1][0] > near[0][0] + 10, `bloom подсвечивает окрестность (${near[0]} → ${near[1]})`);
ok(Math.abs(far[1][0] - far[0][0]) <= 1, 'bloom не трогает далёкий фон');
const dark = render(scene({ bloom: { threshold: 0.9, strength: 1, radius: 30 } }));
ok(Buffer.compare(dark.png, plain.png) === 0 || Math.abs(px(dark, 200, 200)[0] - base[0]) <= 1, 'bloom не засвечивает то, что темнее порога');
ok(Buffer.compare(bloom.png, render(scene({ bloom: { threshold: 0.6, strength: 1, radius: 40 } }, bulb)).png) === 0, 'кадр с bloom воспроизводим');

// depthHaze
const deep = render(scene({ depthHaze: 1 }, undefined, 0.2));
const deepPx = px(deep, 200, 200);
ok(deepPx[2] > 150 && deepPx[0] < 100, `depthHaze=1 на слое глубины 0.2 уводит цвет к haze (${deepPx})`);
const front = render(scene({ depthHaze: 1 }, undefined, 1));
ok(Buffer.compare(front.png, plain.png) === 0, 'на слое depth=1 depthHaze ничего не меняет');
const explicit = render(scene({ depthHaze: 1 }, [{ id: 'o', name: 'o', kind: 'shape', params: { model: model('#c83232'), haze: 0 } }], 0.2));
ok(Buffer.compare(explicit.png, plain.png) === 0, 'явный params.haze=0 главнее depthHaze');

// пресеты
for (const preset of STYLE_PRESETS) {
  const fx = preset.effects;
  const v = validateScene(scene({ grain: preset.grain, vignette: preset.vignette, ...(fx ?? {}) }));
  ok(v.ok && v.warnings.length === 0, `пресет ${preset.id}: эффекты проходят валидатор без предупреждений`);
}
if (failures.length) { console.error(`check:effects FAIL (${failures.length})`); process.exit(1); }
console.log('check:effects PASS');
