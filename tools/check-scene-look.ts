// Образ сцены: применение стиля и выбор приёма камеры (engine/scene-look.ts).
import assert from 'node:assert';
import { createCanvas } from '@napi-rs/canvas';
import { createRenderCache, renderFrame, resolveCamera, validateScene, type SceneV1 } from '../engine/index.ts';
import { applySceneStyle, setSceneShot } from '../engine/scene-look.ts';
import { STYLE_MOODS, STYLE_PRESETS } from '../engine/styles.ts';

let failures = 0;
const ok = (c: boolean, l: string) => { if (c) console.log(`OK   ${l}`); else { failures++; console.error(`FAIL ${l}`); } };
const t = (l: string, fn: () => void) => { try { fn(); ok(true, l); } catch (e) { ok(false, `${l}: ${e instanceof Error ? e.message : String(e)}`); } };

const base = (): SceneV1 => ({
  version: 1, title: 'Образ', duration: 10,
  palette: { sky: ['#101010', '#202020'], sun: '#ffffff', custom: '#123456' },
  style: { grain: 0.5, vignette: 0.5, grade: { saturation: 0.2 }, bloom: { strength: 0.9 }, depthHaze: 0.9 },
  camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }, { t: 10, x: 10, y: 0, zoom: 1.5 }], shake: { amp: 5, freq: 3 } },
  assets: {},
  layers: [{ id: 'l', name: 'Слой', depth: 1, visible: true, objects: [{ id: 'sky', name: 'Небо', kind: 'sky', params: {} }] }],
} as unknown as SceneV1);

// ---- стиль ----
for (const preset of STYLE_PRESETS) for (const mood of STYLE_MOODS) {
  t(`${preset.id}/${mood}: результат валиден`, () => {
    const r = applySceneStyle(base(), preset.id, mood);
    assert.ok(r.ok);
    const v = validateScene(r.value);
    assert.ok(v.ok, JSON.stringify(v.ok ? [] : v.errors));
  });
}
t('вход не меняется', () => { const s = base(); const before = JSON.stringify(s); applySceneStyle(s, 'warm-dusk', 'dusk'); assert.equal(JSON.stringify(s), before); });
t('слои, камера и тряска не тронуты', () => {
  const s = base(); const r = applySceneStyle(s, 'cold-night', 'night'); assert.ok(r.ok);
  assert.deepEqual(r.value.layers, s.layers); assert.deepEqual(r.value.camera, s.camera); assert.equal(r.value.duration, s.duration);
});
t('палитра: слоты и небо стиля, чужой слот сохранён', () => {
  const preset = STYLE_PRESETS[0]; const r = applySceneStyle(base(), preset.id, 'dawn'); assert.ok(r.ok);
  assert.deepEqual(r.value.palette.sky, preset.palettes.dawn.sky); assert.equal(r.value.palette.sun, preset.palettes.dawn.sun); assert.equal(r.value.palette.custom, '#123456');
});
t('зерно, виньетка и метка пресета из стиля', () => {
  const preset = STYLE_PRESETS[1]; const r = applySceneStyle(base(), preset.id, 'night'); assert.ok(r.ok);
  assert.equal(r.value.style?.preset, preset.id); assert.equal(r.value.style?.grain, preset.grain); assert.equal(r.value.style?.vignette, preset.vignette);
});
t('прежние эффекты заменены эффектами стиля, а не сложены', () => {
  const preset = STYLE_PRESETS.find((p) => p.effects)!; const r = applySceneStyle(base(), preset.id, 'dusk'); assert.ok(r.ok);
  assert.deepEqual(r.value.style?.grade, preset.effects!.grade); assert.deepEqual(r.value.style?.bloom, preset.effects!.bloom); assert.equal(r.value.style?.depthHaze, preset.effects!.depthHaze);
});
t('у стиля без эффектов старые эффекты убираются', () => {
  const plain = STYLE_PRESETS.find((p) => !p.effects);
  if (!plain) return; // все пресеты с эффектами: проверять нечего
  const r = applySceneStyle(base(), plain.id, 'day'); assert.ok(r.ok);
  assert.equal(r.value.style?.grade, undefined); assert.equal(r.value.style?.bloom, undefined); assert.equal(r.value.style?.depthHaze, undefined);
});
t('повторное применение даёт тот же результат', () => {
  const a = applySceneStyle(base(), 'warm-dusk', 'dusk'); assert.ok(a.ok);
  const b = applySceneStyle(a.value, 'warm-dusk', 'dusk'); assert.ok(b.ok);
  assert.deepEqual(a.value, b.value);
});
t('результат не делит объекты с пресетом (правка сцены не портит пресет)', () => {
  const r = applySceneStyle(base(), STYLE_PRESETS[0].id, 'dawn'); assert.ok(r.ok);
  (r.value.palette.sky as string[])[0] = '#000000';
  assert.notEqual(STYLE_PRESETS[0].palettes.dawn.sky[0], '#000000');
});
t('смена стиля меняет кадр', () => {
  const draw = (s: SceneV1) => { const c = createCanvas(160, 90); const g = c.getContext('2d') as unknown as CanvasRenderingContext2D; renderFrame(g, s, 1, { w: 160, h: 90 }, { createCanvas: ((w: number, h: number) => createCanvas(w, h)) as any, catalog: {}, cache: createRenderCache() }); return Buffer.from(g.getImageData(0, 0, 160, 90).data); };
  const a = applySceneStyle(base(), 'warm-dusk', 'dusk'); const b = applySceneStyle(base(), 'cold-night', 'night'); assert.ok(a.ok && b.ok);
  assert.notEqual(draw(a.value).compare(draw(b.value)), 0);
});
t('ошибка: неизвестный стиль и настроение', () => {
  const a = applySceneStyle(base(), 'nope', 'dusk'); assert.ok(!a.ok && /nope/.test(a.message));
  const b = applySceneStyle(base(), 'warm-dusk', 'noon' as never); assert.ok(!b.ok && /noon/.test(b.message));
});

// ---- камера ----
t('shot: ключи убраны, droppedKeys=2, сцена валидна', () => {
  const r = setSceneShot(base(), { name: 'crash-zoom', t0: 8 }); assert.ok(r.ok);
  assert.equal(r.value.droppedKeys, 2); assert.equal(r.value.scene.camera.keys.length, 0); assert.equal(r.value.scene.camera.shot?.name, 'crash-zoom');
  const v = validateScene(r.value.scene); assert.ok(v.ok && v.warnings.every((w) => w.path !== 'camera.shot'), 'нет предупреждения «shot игнорируется»');
});
t('shot: движок строит ключи из приёма, тряска сцены сохранена', () => {
  const r = setSceneShot(base(), { name: 'push-in' }); assert.ok(r.ok);
  const cam = resolveCamera(r.value.scene.camera, 10); assert.ok(cam.keys.length >= 2); assert.ok(cam.shake);
});
t('shot: вход не меняется', () => { const s = base(); const before = JSON.stringify(s); setSceneShot(s, { name: 'drift' }); assert.equal(JSON.stringify(s), before); });
t('shot на сцене без ключей: droppedKeys=0', () => { const s = base(); s.camera.keys = []; const r = setSceneShot(s, { name: 'handheld' }); assert.ok(r.ok && r.value.droppedKeys === 0); });
t('shot=null убирает приём и не трогает ключи', () => {
  const a = setSceneShot(base(), { name: 'drift' }); assert.ok(a.ok);
  const b = setSceneShot(a.value.scene, null); assert.ok(b.ok && b.value.scene.camera.shot === undefined);
  const c = setSceneShot(base(), null); assert.ok(c.ok && c.value.scene.camera.keys.length === 2);
});
t('ошибки: имя, strength, t0, duration', () => {
  assert.ok(!setSceneShot(base(), { name: 'spin' as never }).ok);
  assert.ok(!setSceneShot(base(), { name: 'drift', strength: 9 }).ok);
  assert.ok(!setSceneShot(base(), { name: 'drift', strength: Number.NaN }).ok);
  assert.ok(!setSceneShot(base(), { name: 'drift', t0: 10 }).ok);
  assert.ok(!setSceneShot(base(), { name: 'drift', duration: 0 }).ok);
});

console.log(failures ? `check:scene-look FAIL (${failures})` : 'check:scene-look PASS');
process.exit(failures ? 1 : 0);
