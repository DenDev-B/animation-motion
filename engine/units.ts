import type { CatalogAsset, SceneV1 } from './schema.ts';

export type WorldScene = Pick<SceneV1, 'world'>;

export function unitsPerMeter(scene: WorldScene): number {
  return scene.world?.unitsPerMeter ?? 1000;
}

export function metersToUnits(meters: number, units: number): number {
  return meters * units;
}

export function unitsToMeters(units: number, perMeter: number): number {
  return units / perMeter;
}

export function assetScaleForMeters(asset: Pick<CatalogAsset, 'bounds'>, sizeM: number, scene: WorldScene): number {
  return metersToUnits(sizeM, unitsPerMeter(scene)) / asset.bounds[3];
}
