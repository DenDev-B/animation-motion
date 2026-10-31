// Проверка ответа ИИ: swing.amp в радианах и не больше 0.6, иначе params.motion sway.
import fs from 'node:fs';
import path from 'node:path';
import { buildProjectPrompt, PROJECT_PROMPT_MAX_BYTES, validateProjectReply } from '../engine/ai-project.ts';
import { readCatalogIds } from './catalog-ids.ts';

let errors = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); errors++; };
const catalogIds = readCatalogIds();
const exampleText = fs.readFileSync(path.resolve('docs/examples/project-reply-example.json'), 'utf8');

type MutableProject = {
  scenes: Array<{
    scene: {
      layers: Array<{ objects: Array<Record<string, unknown>> }>;
    };
  }>;
};
const fresh = (): MutableProject => JSON.parse(exampleText) as MutableProject;
const firstObject = (project: MutableProject): Record<string, unknown> => project.scenes[0].scene.layers[0].objects[0];

// 1. amp 2 (и -2) — ошибка с понятным текстом про радианы и sway
for (const amp of [2, -2]) {
  const project = fresh();
  firstObject(project).anim = [{ type: 'swing', amp }];
  const result = validateProjectReply(project, { catalogIds });
  const issue = result.errors.find((e) => /swing\.amp/.test(e.message) && /радиан/.test(e.message) && /params\.motion/.test(e.message));
  if (!issue) fail(`swing amp ${amp} должен давать ошибку про радианы и params.motion; получено: ${JSON.stringify(result.errors)}`);
  if (!/\.amp$/.test(issue?.path ?? '')) fail(`путь ошибки swing amp ${amp} должен указывать на .amp, получено: ${issue?.path}`);
}

// 2. amp 0.3 — допустимо
{
  const project = fresh();
  firstObject(project).anim = [{ type: 'swing', amp: 0.3 }];
  const result = validateProjectReply(project, { catalogIds });
  if (!result.ok || result.errors.length) fail(`swing amp 0.3 должен проходить: ${JSON.stringify(result.errors)}`);
}

// 3. ответ с params.motion sway — ок
{
  const project = fresh();
  const object = firstObject(project);
  delete object.anim;
  object.params = { ...(object.params as Record<string, unknown> | undefined), motion: { preset: 'sway', speed: 1, amp: 1 } };
  const result = validateProjectReply(project, { catalogIds });
  if (!result.ok || result.errors.length) fail(`params.motion sway должен проходить: ${JSON.stringify(result.errors)}`);
}

// 4. вложенный partAnim тоже проверяется
{
  const project = fresh();
  const object = firstObject(project);
  object.partAnim = { body: [{ type: 'swing', amp: 2 }] };
  const result = validateProjectReply(project, { catalogIds });
  if (!result.errors.some((e) => /partAnim\.body/.test(e.path))) fail(`вложенный partAnim swing amp 2 должен давать ошибку: ${JSON.stringify(result.errors)}`);
}

// 5. промт: правило есть, размер не вырос
{
  const prompt = buildProjectPrompt({ idea: 'тест swing', format: '16:9', scenes: 3, sceneSeconds: 6, catalogIndex: [] });
  if (!/swing amp — угол в радианах/.test(prompt)) fail('в промте нет правила про swing.amp в радианах');
  if (!/params\.motion \(walk\|run\|fly\|swim\|hop\|sway\)/.test(prompt)) fail('в промте нет списка params.motion для деревьев/людей/животных');
  const bytes = Buffer.byteLength(prompt, 'utf8');
  if (bytes > PROJECT_PROMPT_MAX_BYTES) fail(`промт ${bytes} байт > ${PROJECT_PROMPT_MAX_BYTES}`);
}

console.log(errors === 0 ? 'check:swing-range OK' : `check:swing-range FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
