export function resolveAsset(id: string, scene: { assets?: Record<string, any> } | null | undefined, catalogMap: Record<string, any> | Map<string, any>): any {
  if (scene?.assets && scene.assets[id]) return scene.assets[id];
  const fromCatalog = catalogMap instanceof Map ? catalogMap.get(id) : (catalogMap as any)?.[id];
  if (fromCatalog) return fromCatalog;
  throw new Error(`Ассет "${id}" не найден. Доступные: ${Object.keys(catalogMap instanceof Map ? Object.fromEntries(catalogMap) : (catalogMap || {})).slice(0, 20).join(', ')}`);
}
