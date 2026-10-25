import fs from 'node:fs';
import path from 'node:path';

export interface Credit { id: string; name: string; author: string; license: string; source: string; own: boolean; }

export function collectCredits(project: any): Credit[] {
  const catalogMap: Record<string, any> = {};
  // load catalog from disk if possible
  try {
    const dir = path.join(process.cwd(), 'catalog');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
      const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      catalogMap[a.id] = a;
    }
  } catch {}
  const used = new Set<string>();
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [{ scene: project }];
  for (const s of scenes) {
    const scene = s?.scene ?? s;
    if (!scene?.layers) continue;
    for (const layer of scene.layers) {
      for (const obj of layer.objects ?? []) {
        if (obj?.kind === 'asset' && obj.asset) used.add(obj.asset);
      }
    }
  }
  const credits: Credit[] = [];
  for (const id of used) {
    const a = catalogMap[id] ?? (project?.assets?.[id]);
    if (!a) continue;
    const lic = a.meta?.license ?? {};
    credits.push({
      id: a.id,
      name: a.name,
      author: lic.author ?? (lic.name === 'own' ? 'project' : ''),
      license: lic.name ?? 'unknown',
      source: lic.source ?? '',
      own: lic.name === 'own',
    });
  }
  // dedupe by id
  const seen = new Set<string>();
  return credits.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export function formatCredits(credits: Credit[]): string {
  return credits.map((c) => `${c.id} — ${c.name}: ${c.own ? 'собственная модель' : 'лицензия ' + c.license}, автор ${c.author}, источник ${c.source}`).join('\n');
}
