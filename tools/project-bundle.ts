import fs from 'node:fs';
import path from 'node:path';
import { resolveAsset } from '../engine/catalog.ts';

const args = process.argv.slice(2);
const input = args[0];
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex+1] : null;
if (!input) throw new Error('Usage: npm run project:bundle -- <project.json> [--out path]');
const project = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));

// load catalog
const catalogMap: Record<string, any> = {};
const dir = path.join(process.cwd(), 'catalog');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  catalogMap[a.id] = a;
}

// embed used assets into project.assets
project.assets = project.assets || {};
const used = new Set<string>();
for (const s of project.scenes ?? []) {
  for (const layer of s.scene?.layers ?? []) {
    for (const obj of layer.objects ?? []) {
      if (obj?.kind === 'asset' && obj.asset) used.add(obj.asset);
    }
  }
}
for (const id of used) {
  if (!project.assets[id]) {
    project.assets[id] = resolveAsset(id, null, catalogMap);
  }
}

const name = path.basename(input, path.extname(input));
const outDir = path.join(process.cwd(), 'out', 'bundle');
fs.mkdirSync(outDir, { recursive: true });
const outFile = outPath ? path.resolve(outPath) : path.join(outDir, name + '.json');
fs.writeFileSync(outFile, JSON.stringify(project, null, 2), 'utf8');
console.log('BUNDLE:', outFile);
