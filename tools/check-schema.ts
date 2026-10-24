import fs from 'node:fs';
import assert from 'node:assert';
import path from 'node:path';
import { validateAsset, validateScene } from '../engine/validate.ts';
import { validateProject, type ProjectV1 } from '../engine/project.ts';
import { extractDemoScene } from '../tools/extract-m0-scene.ts';
import type { SceneV1 } from '../engine/schema.ts';

const catalogDir = 'catalog';
const catalog = Object.fromEntries(fs.readdirSync(catalogDir).filter((name) => name.endsWith('.json')).map((name) => {
  const asset = JSON.parse(fs.readFileSync(path.join(catalogDir, name), 'utf8')) as { id: string };
  const result = validateAsset(asset);
  assert.ok(result.ok, `${name} не проходит validateAsset: ${JSON.stringify(result.errors)}`);
  return [asset.id, asset];
}));
const catalogIds = Object.keys(catalog);
function jsonFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(fullPath) : entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : [];
  });
}
const { scene: expected } = extractDemoScene();
const raw = JSON.parse(fs.readFileSync('scenes/whale-demo.json', 'utf8')) as unknown;
const actual = raw as SceneV1;

// (а) сцена проходит валидацию
const ok = validateScene(actual, { catalogIds });
assert.ok(ok.ok, `whale-demo.json не проходит валидацию: ${JSON.stringify(ok.errors)}`);

const sceneFiles = jsonFiles('scenes');
for (const file of sceneFiles) {
  const scene = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  const result = validateScene(scene, { catalogIds });
  assert.ok(result.ok, `${file} не проходит валидацию: ${JSON.stringify(result.errors)}`);
}
for (const file of fs.readdirSync('projects').filter((name) => name.endsWith('.json'))) {
  const project = JSON.parse(fs.readFileSync(path.join('projects', file), 'utf8')) as ProjectV1;
  const result = validateProject(project, { catalogIds });
  assert.ok(result.ok, `${file} не проходит валидацию: ${JSON.stringify(result.errors)}`);
}

// (б) отрицательные проверки
function expectFail(modifier: (s: any) => void, label: string) {
  const s = JSON.parse(JSON.stringify(actual));
  modifier(s);
  const res = validateScene(s, { catalogIds });
  assert.ok(!res.ok, `${label}: ожидалась ошибка, сцена прошла`);
  assert.ok(res.errors.length > 0, `${label}: ошибок нет`);
}

const objectAt = (s: any, name: string) => s.layers.flatMap((layer: any) => layer.objects).find((object: any) => object.name === name);
const cloud = (s: any) => s.layers.flatMap((layer: any) => layer.objects).find((object: any) => object.kind === 'cloud');
const skyline = (s: any) => s.layers.flatMap((layer: any) => layer.objects).find((object: any) => object.kind === 'skyline');

// Негативные проверки диапазонов анимации, камеры, объектов, kind, палитры и стиля.
expectFail((s) => { objectAt(s, 'Кит').anim[1].period = 0; }, 'bob period=0');
expectFail((s) => { objectAt(s, 'Кит').anim[2].period = 0; }, 'swing period=0');
expectFail((s) => { objectAt(s, 'Кит').anim.push({ type: 'pulse', period: 0 }); }, 'pulse period=0');
expectFail((s) => { objectAt(s, 'Кит').anim[0].ease = 'unknown'; }, 'ease unknown');
expectFail((s) => { objectAt(s, 'Кит').anim[0].t0 = 8; objectAt(s, 'Кит').anim[0].t1 = 4; }, 'move t0>t1');
expectFail((s) => { objectAt(s, 'Кит').anim.push({ type: 'fade', t0: 8, t1: 4 }); }, 'fade t0>t1');
expectFail((s) => { objectAt(s, 'Кит').anim.push({ type: 'fade', from: -0.1 }); }, 'fade from<0');
expectFail((s) => { objectAt(s, 'Кит').anim.push({ type: 'fade', to: 1.1 }); }, 'fade to>1');
expectFail((s) => { s.camera.keys[0].zoom = 0; }, 'camera zoom=0');
expectFail((s) => { s.camera.keys[1].t = s.camera.keys[0].t; }, 'camera duplicate t');
expectFail((s) => { s.camera.keys[1].t = -1; }, 'camera t before zero');
expectFail((s) => { s.camera.keys[1].t = s.duration + 1; }, 'camera t after duration');
expectFail((s) => { objectAt(s, 'Кит').s = 0; }, 'object s=0');
expectFail((s) => { objectAt(s, 'Кит').alpha = -0.1; }, 'object alpha<0');
expectFail((s) => { objectAt(s, 'Кит').alpha = 1.1; }, 'object alpha>1');
expectFail((s) => { s.layers[0].depth = Number.NaN; }, 'layer depth non-finite');
expectFail((s) => { cloud(s).params.w = 0; }, 'cloud w=0');
expectFail((s) => { cloud(s).params.h = 0; }, 'cloud h=0');
expectFail((s) => { cloud(s).params.puffs = 1.5; }, 'cloud puffs not integer');
expectFail((s) => { cloud(s).params.haze = 1.1; }, 'cloud haze>1');
expectFail((s) => { skyline(s).params.minW = skyline(s).params.maxW + 1; }, 'skyline minW>maxW');
expectFail((s) => { skyline(s).params.windows = 1; }, 'skyline windows not boolean');
let bgObject = 0;
const withBg = (kind: string, params: Record<string, unknown>) => (s: any) => {
  s.layers[0].objects.push({ id: `bg-${kind}-${bgObject++}`, name: kind, kind, params });
};
expectFail(withBg('mountains', { peaks: 2 }), 'mountains peaks<3');
expectFail(withBg('mountains', { peaks: 41 }), 'mountains peaks>40');
expectFail(withBg('mountains', { peaks: 8.5 }), 'mountains peaks not integer');
expectFail(withBg('mountains', { rough: -0.1 }), 'mountains rough<0');
expectFail(withBg('mountains', { rough: 1.1 }), 'mountains rough>1');
expectFail(withBg('mountains', { snow: 1.1 }), 'mountains snow>1');
expectFail(withBg('mountains', { minH: 300, maxH: 100 }), 'mountains minH>maxH');
expectFail(withBg('mountains', { w: 0 }), 'mountains w=0');
expectFail(withBg('hills', { amp: 9 }), 'hills amp<10');
expectFail(withBg('hills', { amp: 201 }), 'hills amp>200');
expectFail(withBg('hills', { waves: 0 }), 'hills waves<1');
expectFail(withBg('hills', { waves: 9 }), 'hills waves>8');
expectFail(withBg('hills', { w: 0 }), 'hills w=0');
expectFail(withBg('stars', { count: 0 }), 'stars count<1');
expectFail(withBg('stars', { count: 2001 }), 'stars count>2000');
expectFail(withBg('stars', { count: 1.5 }), 'stars count not integer');
expectFail(withBg('stars', { minR: 0.4 }), 'stars minR<0.5');
expectFail(withBg('stars', { maxR: 4.1 }), 'stars maxR>4');
expectFail(withBg('stars', { minR: 3, maxR: 2 }), 'stars minR>maxR');
expectFail(withBg('stars', { twinkle: -0.1 }), 'stars twinkle<0');
expectFail(withBg('stars', { bias: 1.1 }), 'stars bias>1');
expectFail(withBg('stars', { h: 0 }), 'stars h=0');
expectFail((s) => { const glow = s.layers.flatMap((l: any) => l.objects).find((o: any) => o.kind === 'glow'); glow.params.a = 1.1; }, 'glow alpha>1');
expectFail((s) => { s.style.grain = -0.1; }, 'grain<0');
expectFail((s) => { s.style.vignette = 1.1; }, 'vignette>1');
expectFail((s) => { s.palette.sky = ['#123']; }, 'sky has one color');
expectFail((s) => { s.palette.sun = '#abcd'; }, 'color length 4');
expectFail((s) => { s.palette.sun = '#abcde'; }, 'color length 5');
expectFail((s) => { s.palette.sun = '#abcdefg'; }, 'color length 7');

const withWarnings = JSON.parse(JSON.stringify(actual));
withWarnings.futureScene = true;
withWarnings.layers[0].futureLayer = true;
withWarnings.layers[0].objects[0].futureObject = true;
const warningResult = validateScene(withWarnings, { catalogIds });
assert.equal(warningResult.ok, true, 'неизвестные ключи должны быть warning, не errors');
assert.ok(warningResult.warnings.length >= 3, 'ожидались warnings неизвестных ключей');

function expectAssetFail(modifier: (asset: any) => void, label: string) {
  const asset = JSON.parse(JSON.stringify(catalog.whale));
  modifier(asset);
  const result = validateAsset(asset);
  assert.equal(result.ok, false, `${label}: модель прошла`);
  assert.ok(result.errors.length > 0, `${label}: ошибок нет`);
}
expectAssetFail((a) => { a.version = 2; }, 'asset version');
expectAssetFail((a) => { a.id = ''; }, 'asset id');
expectAssetFail((a) => { a.name = ''; }, 'asset name');
expectAssetFail((a) => { a.bounds = [0, 0, 10]; }, 'asset bounds length');
expectAssetFail((a) => { a.bounds[2] = 0; }, 'asset bounds width');
expectAssetFail((a) => { a.parts = []; }, 'asset parts empty');
expectAssetFail((a) => { a.parts[1].id = a.parts[0].id; }, 'asset duplicate part id');
expectAssetFail((a) => { a.parts[0].type = 'triangle'; }, 'asset part type');
expectAssetFail((a) => { a.parts[0].d = 12; }, 'asset path d');
expectAssetFail((a) => { a.parts[0].off = [1]; }, 'asset off tuple');
expectAssetFail((a) => { a.parts[0].fill = '#abcd'; }, 'asset fill color');
expectAssetFail((a) => { a.parts[0].stroke = { color: 'rim', w: 0 }; }, 'asset stroke width');
expectAssetFail((a) => { a.parts[0].type = 'circle'; a.parts[0].cx = 0; a.parts[0].cy = 0; a.parts[0].r = 0; }, 'asset circle radius');

expectFail((s) => { s.layers.push({ ...s.layers[0] }); }, 'дубль id');
expectFail((s) => { s.layers[0].objects[0].kind = 'unknown' as never; }, 'неизвестный kind');
expectFail((s) => { delete s.palette; }, 'нет palette');
expectFail((s) => { s.version = 2; }, 'version 2');
expectFail((s) => { s.layers[0].objects.push({ id: 'obj-x', name: 'x', kind: 'asset', asset: 'nope' }); }, 'asset на несуществующий id');
expectFail((s) => { s.layers[0].objects[0].anim = [{ type: 'wiggle' }] as never; }, 'неизвестный anim.type');

// (в) структура совпадает с demo() M0 (id игнорируются)
function stripIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIds);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'id') continue;
      if (val === undefined) continue;
      out[k] = stripIds(val);
    }
    return out;
  }
  return v;
}

assert.strictEqual(JSON.stringify(stripIds(actual)), JSON.stringify(stripIds(expected)));

console.log(`check:schema OK (${catalogIds.length} catalog, ${sceneFiles.length} scenes, ${fs.readdirSync('projects').filter((name) => name.endsWith('.json')).length} projects, 42+ negative cases)`);
