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
expectFail(withBg('rain', { count: 0 }), 'rain count<1');
expectFail(withBg('rain', { count: 3001 }), 'rain count>3000');
expectFail(withBg('rain', { speed: 199 }), 'rain speed<200');
expectFail(withBg('rain', { speed: 3001 }), 'rain speed>3000');
expectFail(withBg('rain', { angle: -46 }), 'rain angle<-45');
expectFail(withBg('rain', { angle: 46 }), 'rain angle>45');
expectFail(withBg('rain', { len: 5 }), 'rain len<6');
expectFail(withBg('rain', { len: 81 }), 'rain len>80');
expectFail(withBg('rain', { width: 0.4 }), 'rain width<0.5');
expectFail(withBg('rain', { width: 4.1 }), 'rain width>4');
expectFail(withBg('rain', { alpha: 1.1 }), 'rain alpha>1');
expectFail(withBg('rain', { w: 0 }), 'rain w=0');
expectFail(withBg('snow', { count: 0 }), 'snow count<1');
expectFail(withBg('snow', { count: 2001 }), 'snow count>2000');
expectFail(withBg('snow', { speed: 19 }), 'snow speed<20');
expectFail(withBg('snow', { speed: 401 }), 'snow speed>400');
expectFail(withBg('snow', { drift: -1 }), 'snow drift<0');
expectFail(withBg('snow', { drift: 201 }), 'snow drift>200');
expectFail(withBg('snow', { minR: 0.7 }), 'snow minR<0.8');
expectFail(withBg('snow', { maxR: 6.1 }), 'snow maxR>6');
expectFail(withBg('snow', { minR: 4, maxR: 2 }), 'snow minR>maxR');
expectFail(withBg('snow', { alpha: -0.1 }), 'snow alpha<0');
expectFail(withBg('snow', { h: 0 }), 'snow h=0');
expectFail(withBg('birds', { count: 0 }), 'birds count<1');
expectFail(withBg('birds', { count: 61 }), 'birds count>60');
expectFail(withBg('birds', { spread: 49 }), 'birds spread<50');
expectFail(withBg('birds', { spread: 801 }), 'birds spread>800');
expectFail(withBg('birds', { size: 3 }), 'birds size<4');
expectFail(withBg('birds', { size: 61 }), 'birds size>60');
expectFail(withBg('birds', { flap: 0.1 }), 'birds flap<0.2');
expectFail(withBg('birds', { flap: 3.1 }), 'birds flap>3');
expectFail(withBg('birds', { bob: -1 }), 'birds bob<0');
expectFail(withBg('birds', { bob: 41 }), 'birds bob>40');
expectFail(withBg('birds', { dir: 0 }), 'birds dir=0');
expectFail(withBg('birds', { dir: 2 }), 'birds dir=2');
expectFail(withBg('text', { text: '' }), 'text empty');
expectFail(withBg('text', { text: 'x'.repeat(401) }), 'text length>400');
expectFail(withBg('text', {}), 'text missing');
expectFail(withBg('text', { text: 'A', size: 7 }), 'text size<8');
expectFail(withBg('text', { text: 'A', size: 401 }), 'text size>400');
expectFail(withBg('text', { text: 'A', weight: 500 }), 'text weight=500');
expectFail(withBg('text', { text: 'A', align: 'justify' }), 'text align=justify');
expectFail(withBg('text', { text: 'A', stroke: 21 }), 'text stroke>20');
expectFail(withBg('text', { text: 'A', shadow: 31 }), 'text shadow>30');
expectFail(withBg('text', { text: 'A', maxWidth: 0 }), 'text maxWidth=0');
expectFail(withBg('text', { text: 'A', lineHeight: 0.7 }), 'text lineHeight<0.8');
expectFail(withBg('text', { text: 'A', lineHeight: 2.1 }), 'text lineHeight>2');
expectFail(withBg('counter', { t0: 4, t1: 2 }), 'counter t1<t0');
expectFail(withBg('counter', { weight: 500 }), 'counter weight=500');
expectFail(withBg('counter', { thousands: '.' }), 'counter thousands="."');
expectFail(withBg('counter', { decimals: 5 }), 'counter decimals>4');
expectFail(withBg('counter', { decimals: -1 }), 'counter decimals<0');
expectFail(withBg('counter', { decimals: 1.5 }), 'counter decimals not integer');
expectFail(withBg('counter', { ease: 'unknown' }), 'counter ease unknown');
expectFail(withBg('counter', { t0: -1 }), 'counter t0<0');
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
expectAssetFail((a) => { a.realSize = null; }, 'asset realSize null');
expectAssetFail((a) => { a.realSize = {}; }, 'asset realSize empty');
expectAssetFail((a) => { a.realSize.heightM = 0; }, 'asset realSize heightM=0');
expectAssetFail((a) => { a.realSize.widthM = -1; }, 'asset realSize widthM<0');
expectAssetFail((a) => { a.realSize.heightM = '7'; }, 'asset realSize heightM string');

expectFail((s) => { s.world = 16; }, 'world not object');
expectFail((s) => { s.world = {}; }, 'world without unitsPerMeter');
expectFail((s) => { s.world = { unitsPerMeter: 0 }; }, 'world unitsPerMeter=0');
expectFail((s) => { s.world = { unitsPerMeter: -2 }; }, 'world unitsPerMeter<0');
expectFail((s) => { s.world = { unitsPerMeter: Number.NaN }; }, 'world unitsPerMeter NaN');
expectFail((s) => { objectAt(s, 'Кит').params = { sizeM: 15 }; }, 'sizeM without world');
const scaled = JSON.parse(JSON.stringify(actual));
scaled.world = { unitsPerMeter: 16 };
objectAt(scaled, 'Кит').params = { sizeM: 15 };
const scaledResult = validateScene(scaled, { catalogIds });
assert.ok(scaledResult.ok, `sizeM с world должен проходить: ${JSON.stringify(scaledResult.errors)}`);
expectFail((s) => { s.world = { unitsPerMeter: 16 }; objectAt(s, 'Кит').params = { sizeM: 0 }; }, 'sizeM=0');

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
