import fs from 'node:fs';
import path from 'node:path';
import { buildProjectPrompt, PROJECT_PROMPT_MAX_BYTES, type CatalogEntry } from '../engine/ai-project.ts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const idea = opt('--idea');
if (!idea) throw new Error('Использование: npm run ai:project-prompt -- --idea "текст" [--scenes 5] [--scene-seconds 8] [--format 16:9|9:16] [--fps 30] [--tone "..."]');
const format = opt('--format') ?? '16:9';
if (format !== '16:9' && format !== '9:16') throw new Error('--format должен быть 16:9 или 9:16');
const fps = opt('--fps') === undefined ? 30 : Number(opt('--fps'));
if (![24, 30, 60].includes(fps)) throw new Error('--fps должен быть 24, 30 или 60');
const catalogDir = path.resolve('catalog');
const index = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index.json'), 'utf8')) as Array<CatalogEntry & { file: string }>;
const catalogIndex: CatalogEntry[] = index.map((e) => {
  const model = JSON.parse(fs.readFileSync(path.join(catalogDir, e.file), 'utf8')) as { bounds?: number[] };
  return { ...e, bounds: model.bounds };
});
const prompt = buildProjectPrompt({
  idea, format, fps: fps as 24 | 30 | 60,
  scenes: opt('--scenes') === undefined ? undefined : Number(opt('--scenes')),
  sceneSeconds: opt('--scene-seconds') === undefined ? undefined : Number(opt('--scene-seconds')),
  tone: opt('--tone'), catalogIndex,
});
const bytes = Buffer.byteLength(prompt, 'utf8');
if (bytes > PROJECT_PROMPT_MAX_BYTES) throw new Error(`Промт ${bytes} байт, больше лимита ${PROJECT_PROMPT_MAX_BYTES}`);
const output = path.resolve('out/ai/project-prompt.md');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, prompt, 'utf8');
console.log(`AI_PROJECT_PROMPT: ${output} (${bytes} байт)`);
