import fs from 'node:fs';
import path from 'node:path';
import { buildFixRequest, extractJson, validateObject, validateProject, validateScene, type ProjectV1, type ValidationError } from '../engine/index.ts';
import { readCatalogIds } from './catalog-ids.ts';

const args = process.argv.slice(2);
const responsePath = args.find((value) => !value.startsWith('--'));
if (!responsePath) throw new Error('Использование: npm run ai:apply -- <ответ-ИИ.txt|json> [--into <файл>] [--scene N]');
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const intoPath = option('--into');
const sceneNumber = option('--scene') === undefined ? undefined : Number(option('--scene'));
const catalogIds = readCatalogIds();
const responseText = fs.readFileSync(path.resolve(responsePath), 'utf8');
let candidate: unknown;
try { candidate = extractJson(responseText); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }

let finalJson: unknown = candidate;
let validation: { ok: boolean; errors: ValidationError[]; warnings: ValidationError[] };
if (sceneNumber !== undefined) {
  if (!intoPath || !Number.isInteger(sceneNumber) || sceneNumber < 1) throw new Error('--scene требует --into <project.json> и номер начиная с 1');
  const targetPath = path.resolve(intoPath);
  const base = JSON.parse(fs.readFileSync(targetPath, 'utf8')) as unknown;
  const projectCheck = validateProject(base, { catalogIds });
  if (!projectCheck.ok) validation = projectCheck;
  else {
    const project = structuredClone(base) as ProjectV1;
    if (!project.scenes[sceneNumber - 1]) throw new Error(`В проекте нет сцены №${sceneNumber}`);
    project.scenes[sceneNumber - 1].scene = candidate as ProjectV1['scenes'][number]['scene'];
    finalJson = project;
    validation = validateProject(project, { catalogIds });
  }
} else if (candidate && typeof candidate === 'object' && 'scenes' in candidate) validation = validateProject(candidate, { catalogIds });
else if (candidate && typeof candidate === 'object' && 'kind' in candidate) validation = validateObject(candidate, { catalogIds });
else validation = validateScene(candidate, { catalogIds });

if (!validation.ok) {
  const fixPath = path.resolve('out/ai/fix-request.md');
  fs.mkdirSync(path.dirname(fixPath), { recursive: true });
  fs.writeFileSync(fixPath, buildFixRequest(candidate, validation.errors), 'utf8');
  console.error(validation.errors.map(({ path: p, message }) => `${p || '(корень)'}: ${message}`).join('\n'));
  console.error(`FIX_REQUEST: ${fixPath}`);
  process.exit(1);
}
const basePath = path.resolve(intoPath ?? responsePath);
const parsed = path.parse(basePath);
const outputPath = path.join(parsed.dir, `${parsed.name}.applied.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(finalJson, null, 2)}\n`, 'utf8');
console.log(`AI_APPLY: ${outputPath}`);
if (validation.warnings.length) console.log(`WARNINGS:\n${validation.warnings.map(({ path: p, message }) => `  ${p}: ${message}`).join('\n')}`);
else console.log('WARNINGS: none');
