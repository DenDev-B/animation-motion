import fs from 'node:fs';
import path from 'node:path';
import { buildPrompt, validateObject, validateProject, validateScene, type ProjectV1 } from '../engine/index.ts';
import { readCatalogIds } from './catalog-ids.ts';

const args = process.argv.slice(2);
const inputPath = args.find((value) => !value.startsWith('--'));
if (!inputPath) throw new Error('Использование: npm run ai:prompt -- <scene.json|project.json> [--task "..."] [--scene N]');
const taskIndex = args.indexOf('--task');
const sceneIndex = args.indexOf('--scene');
const task = taskIndex >= 0 ? args[taskIndex + 1] ?? '' : '';
const catalogIds = readCatalogIds();
const requestedScene = sceneIndex >= 0 ? Number(args[sceneIndex + 1]) : undefined;
const source = fs.readFileSync(path.resolve(inputPath), 'utf8');
const json = JSON.parse(source) as unknown;
let target = json;
let scope = 'сцена или проект';
if (requestedScene !== undefined) {
  if (!Number.isInteger(requestedScene) || requestedScene < 1) throw new Error('--scene должен быть номером сцены, начиная с 1');
  const result = validateProject(json, { catalogIds });
  if (!result.ok) throw new Error(result.errors.map(({ path: p, message }) => `${p}: ${message}`).join('\n'));
  const project = json as ProjectV1;
  if (!project.scenes[requestedScene - 1]) throw new Error(`В проекте нет сцены №${requestedScene}`);
  target = project.scenes[requestedScene - 1].scene;
  scope = `сцена ${requestedScene} проекта «${project.title}»`;
} else if (json && typeof json === 'object' && 'scenes' in json) {
  const result = validateProject(json, { catalogIds });
  if (!result.ok) throw new Error(result.errors.map(({ path: p, message }) => `${p}: ${message}`).join('\n'));
  scope = 'весь проект';
  if (Buffer.byteLength(source, 'utf8') > 60 * 1024) console.warn('Предупреждение: проект больше 60 КБ; используйте --scene N для компактного промта.');
} else {
  const result = json && typeof json === 'object' && 'kind' in json
    ? validateObject(json, { catalogIds })
    : validateScene(json, { catalogIds });
  if (!result.ok) throw new Error(result.errors.map(({ path: p, message }) => `${p}: ${message}`).join('\n'));
  scope = 'сцена';
}
const prompt = buildPrompt(target, { task, scope });
const catalogIndex = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'catalog', 'index.json'), 'utf8'));
const catalogBlock = '\n\nКаталог моделей (используй только эти id):\n' + catalogIndex.map((x: any) => `- ${x.id}: ${x.name}; теги: ${(x.tags || []).join(', ')}; realSize: ${JSON.stringify(x.realSize)}`).join('\n');
const promptWithCatalog = prompt + catalogBlock;
const output = path.resolve('out/ai/prompt.md');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, promptWithCatalog, 'utf8');
console.log(`AI_PROMPT: ${output} (${Buffer.byteLength(promptWithCatalog, 'utf8')} байт)`);
