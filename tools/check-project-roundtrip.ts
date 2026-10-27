// Круг «идея → промт → ответ ИИ → проект»: промт, пример ответа, ai:apply --new, обрезанный и неверный ответы.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildProjectPrompt, PROJECT_PROMPT_MAX_BYTES, validateProjectReply, type CatalogEntry } from '../engine/ai-project.ts';
import { readCatalogIds } from './catalog-ids.ts';

let errors = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); errors++; };
const catalogDir = path.resolve('catalog');
const index = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index.json'), 'utf8')) as Array<CatalogEntry & { file: string }>;
const catalogIndex = index.map((e) => ({ ...e, bounds: (JSON.parse(fs.readFileSync(path.join(catalogDir, e.file), 'utf8')) as { bounds: number[] }).bounds }));

// 1. промт
for (const format of ['16:9', '9:16'] as const) {
  const prompt = buildProjectPrompt({ idea: 'Что если бы киты летали над городом', format, scenes: 5, sceneSeconds: 8, catalogIndex });
  const bytes = Buffer.byteLength(prompt, 'utf8');
  if (bytes > PROJECT_PROMPT_MAX_BYTES) fail(`промт ${format} ${bytes} байт > ${PROJECT_PROMPT_MAX_BYTES}`);
  for (const e of catalogIndex) if (!prompt.includes(`- ${e.id}:`)) fail(`в промте нет модели ${e.id}`);
  for (const must of ['unitsPerMeter', 'sizeM', 'suggestions', 'transition', 'skyline', 'swim', 'crossfade', 'Что если бы киты летали над городом']) if (!prompt.includes(must)) fail(`в промте нет «${must}»`);
  if (/\d+\.\d{4,}/.test(prompt)) fail('в промте есть числа с >=4 знаками после запятой');
}
let emptyIdeaFailed = false;
try { buildProjectPrompt({ idea: '   ', catalogIndex }); } catch { emptyIdeaFailed = true; }
if (!emptyIdeaFailed) fail('пустая идея должна давать ошибку');

// 2. пример ответа
const examplePath = path.resolve('docs/examples/project-reply-example.json');
const exampleText = fs.readFileSync(examplePath, 'utf8');
const example = JSON.parse(exampleText) as { scenes: Array<{ scene: { world?: { unitsPerMeter: number } } }>; meta?: { suggestions?: unknown[] } };
const reply = validateProjectReply(example, { catalogIds: readCatalogIds() });
if (!reply.ok) fail(`пример не проходит проверку: ${JSON.stringify(reply.errors)}`);
if (reply.suggestions.length !== 1) fail(`в примере ожидается 1 предложение, найдено ${reply.suggestions.length}`);
if (example.scenes.length !== 3) fail('в примере ожидается 3 сцены');

// 3-5. CLI в временный каталог
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-project-'));
const run = (file: string, extra: string[] = []) => spawnSync(process.execPath, ['tools/ai-apply.ts', file, '--new', '--dir', tmp, ...extra], { encoding: 'utf8' });
const first = run(examplePath);
if (first.status !== 0) fail(`ai:apply --new не принял пример: ${first.stderr}`);
if (!/Предложено добавить в каталог/.test(first.stdout)) fail('ai:apply --new не напечатал список предложенных моделей');
const second = run(examplePath);
if (second.status !== 0) fail('повторный ai:apply --new упал');
const files = fs.readdirSync(tmp).filter((n) => n.endsWith('.project.json'));
if (files.length !== 2) fail(`ожидалось 2 файла проекта (имя и имя_2), найдено ${files.length}: ${files.join(', ')}`);

const truncatedPath = path.join(tmp, 'truncated.txt');
fs.writeFileSync(truncatedPath, exampleText.slice(0, Math.floor(exampleText.length * 0.6)), 'utf8');
const truncated = run(truncatedPath);
if (truncated.status === 0 || !/обрезан/.test(truncated.stderr)) fail(`обрезанный ответ должен давать ошибку «обрезан»: ${truncated.stderr}`);

const bad = JSON.parse(exampleText) as { scenes: Array<{ scene: { duration: number } }> };
bad.scenes[0].scene.duration = -5;
const badPath = path.join(tmp, 'bad.json');
fs.writeFileSync(badPath, JSON.stringify(bad), 'utf8');
const badRun = run(badPath);
if (badRun.status === 0 || !/FIX_REQUEST/.test(badRun.stderr)) fail(`неверный диапазон должен давать fix-request: ${badRun.stderr}`);
if (files.length === 2 && fs.readdirSync(tmp).filter((n) => n.endsWith('.project.json')).length !== 2) fail('при ошибках файл проекта не должен создаваться');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(errors === 0 ? 'check:project-roundtrip OK' : `check:project-roundtrip FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
