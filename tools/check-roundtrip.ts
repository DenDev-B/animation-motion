import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildFixRequest, buildPrompt, extractJson } from '../engine/ai-io.ts';
import { validateScene } from '../engine/validate.ts';

const scene = JSON.parse(fs.readFileSync('scenes/whale-demo.json', 'utf8')) as Record<string, any>;
const prompt = buildPrompt(scene, { task: 'добавь облако' });
assert.ok(prompt.includes(JSON.stringify(scene, null, 2)), 'prompt должен содержать исходный JSON');
assert.ok(prompt.includes('### cloud'), 'prompt должен содержать справочник формата');
assert.ok(prompt.includes('Задача: добавь облако'));
assert.deepEqual(extractJson(`Ответ:\n\`\`\`json\n${JSON.stringify(scene)}\n\`\`\`\nГотово.`), scene);
assert.deepEqual(extractJson(`Начало ${JSON.stringify(scene)} конец`), scene);

assert.throws(() => extractJson('{"version":1,"layers":['), (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.match(error.message, /похоже, ответ обрезан/);
  assert.match(error.message, /строка \d+, столбец \d+/);
  return true;
});

const invalid = structuredClone(scene);
invalid.layers[0].objects[0].params = { surprise: 1 };
const validation = validateScene(invalid, { catalogIds: ['whale'] });
assert.equal(validation.ok, true, 'неизвестное поле даёт предупреждение, не ошибку');
assert.ok(validation.warnings.length > 0);
const broken = structuredClone(scene);
broken.layers.find((layer: any) => layer.objects.some((object: any) => object.kind === 'cloud')).objects.find((object: any) => object.kind === 'cloud').params.w = 0;
const brokenResult = validateScene(broken, { catalogIds: ['whale'] });
assert.equal(brokenResult.ok, false);
const fix = buildFixRequest(broken, brokenResult.errors);
assert.ok(fix.includes('layers['));
assert.ok(fix.includes('верни ТОЛЬКО полный JSON'));

const roundtripDir = path.resolve('out/ai/check-roundtrip');
fs.mkdirSync(roundtripDir, { recursive: true });
const replyPath = path.join(roundtripDir, 'reply.txt');
fs.writeFileSync(replyPath, `Ответ модели:\n\`\`\`json\n${JSON.stringify(scene)}\n\`\`\`\nГотово.`, 'utf8');
const applied = spawnSync(process.execPath, ['tools/ai-apply.ts', replyPath], { encoding: 'utf8' });
assert.equal(applied.status, 0, `ai:apply завершился ошибкой: ${applied.stderr}\n${applied.stdout}`);
const appliedPath = path.join(roundtripDir, 'reply.applied.json');
assert.deepEqual(JSON.parse(fs.readFileSync(appliedPath, 'utf8')), scene);
const promptRun = spawnSync(process.execPath, ['tools/ai-prompt.ts', 'scenes/whale-demo.json', '--task', 'проверка'], { encoding: 'utf8' });
assert.equal(promptRun.status, 0, `ai:prompt завершился ошибкой: ${promptRun.stderr}\n${promptRun.stdout}`);
assert.ok(fs.readFileSync('out/ai/prompt.md', 'utf8').includes('проверка'));

const shapeRun = spawnSync(process.execPath, ['tools/ai-prompt.ts', 'scenes/fixtures/shape-sun-moon.json', '--task', 'добавь кольцо вокруг луны'], { encoding: 'utf8' });
assert.equal(shapeRun.status, 0, `ai:prompt для shape завершился ошибкой: ${shapeRun.stderr}\n${shapeRun.stdout}`);
const shapePrompt = fs.readFileSync('out/ai/prompt.md', 'utf8');
assert.ok(shapePrompt.includes('### shape'), 'промт shape должен содержать справочник по kind shape');
assert.ok(shapePrompt.includes('Задача: добавь кольцо вокруг луны'));

console.log('check:roundtrip PASS');
