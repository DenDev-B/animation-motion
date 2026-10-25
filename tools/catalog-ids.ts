import fs from 'node:fs';
import path from 'node:path';
import { validateAsset } from '../engine/validate.ts';

export function readCatalogIds(directory = path.resolve('catalog')): string[] {
  return fs.readdirSync(directory).filter((name) => name.endsWith('.json') && name !== 'index.json').map((name) => {
    const asset = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as { id?: unknown };
    const validation = validateAsset(asset);
    if (!validation.ok) throw new Error(`Модель ${name} не прошла валидацию: ${validation.errors.map(({ path: p, message }) => `${p}: ${message}`).join('; ')}`);
    return asset.id as string;
  });
}
