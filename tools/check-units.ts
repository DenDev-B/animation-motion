import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { unitsPerMeter, metersToUnits, unitsToMeters, assetScaleForMeters } from '../engine/units.ts';
import { validateAsset } from '../engine/validate.ts';
import type { CatalogAsset } from '../engine/schema.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog: Record<string, CatalogAsset> = {};
for (const file of fs.readdirSync(path.join(root, 'catalog')).filter((name) => name.endsWith('.json') && name !== 'index.json')) {
  const asset = JSON.parse(fs.readFileSync(path.join(root, 'catalog', file), 'utf8')) as CatalogAsset;
  const result = validateAsset(asset);
  assert.ok(result.ok, `${file}: ${JSON.stringify(result.errors)}`);
  catalog[asset.id] = asset;
}

const world = { world: { unitsPerMeter: 16 } };
assert.equal(unitsPerMeter(world), 16, 'unitsPerMeter из scene.world');
assert.equal(unitsPerMeter({}), 1000, 'unitsPerMeter по умолчанию');
assert.equal(metersToUnits(7, 16), 112, 'metersToUnits');
assert.equal(unitsToMeters(112, 16), 7, 'unitsToMeters');

const sizes: Array<[string, number]> = [['human', 1.75], ['house', 7], ['plane', 12], ['whale', 6.58]];
for (const [id, sizeM] of sizes) {
  const asset = catalog[id];
  assert.ok(asset, `${id} отсутствует в каталоге`);
  const scale = assetScaleForMeters(asset, sizeM, world);
  const renderedHeightM = unitsToMeters(asset.bounds[3] * scale, unitsPerMeter(world));
  assert.ok(Math.abs(renderedHeightM - sizeM) / sizeM <= 0.01, `${id}: ${renderedHeightM} м вместо ${sizeM} м`);
}

const human = catalog.human.realSize!.heightM!;
const whaleLength = catalog.whale.realSize!.widthM!;
const ratio = whaleLength / human;
assert.ok(Math.abs(ratio - 8.57) <= 0.01, `человек/кит: 1 : ${ratio.toFixed(2)} вместо 1 : 8.57`);

for (const [id, asset] of Object.entries(catalog)) {
  if (!asset.realSize?.widthM || !asset.realSize.heightM) continue;
  const boundsRatio = asset.bounds[2] / asset.bounds[3];
  const realRatio = asset.realSize.widthM / asset.realSize.heightM;
  assert.ok(Math.abs(boundsRatio - realRatio) / realRatio <= 0.01, `${id}: пропорции bounds и realSize расходятся`);
}

console.log(`check:units OK (${Object.keys(catalog).length} моделей, человек/кит 1 : ${ratio.toFixed(2)})`);
