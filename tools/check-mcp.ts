import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCore } from './mcp-core.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = createCore(root);

// ядро: имена файлов и проверка
assert.throws(() => core.projectFile('../evil'), /не подходит/, 'обход каталога отклонён');
assert.throws(() => core.projectFile('a/b'), /не подходит/, 'слэш в имени отклонён');
assert.ok(core.exportArgs('night-city-car', 'h').includes('--overwrite'), 'аргументы экспорта собираются');

// конфиг Open Code в корне репозитория указывает на существующий сервер
const opencode = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8')) as { mcp?: Record<string, { type?: string; command?: string[]; enabled?: boolean }> };
const entry = opencode.mcp?.['animation-motion'];
assert.ok(entry && entry.type === 'local' && entry.enabled === true, 'opencode.json: сервер animation-motion включён');
assert.deepEqual(entry.command, ['node', 'tools/mcp-server.ts'], 'opencode.json: команда запуска');
assert.ok(fs.existsSync(path.join(root, 'tools', 'mcp-server.ts')), 'opencode.json: файл сервера существует');

const client = new Client({ name: 'check', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['tools/mcp-server.ts'], cwd: root }));
const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> }>;
const body = (r: { content: Array<{ type: string; text?: string }> }) => r.content.find((c) => c.type === 'text')?.text ?? '';
const tmpName = `zz-mcp-check-${process.pid}`;
try {
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['export_video', 'get_schema', 'lint_project', 'list_audio', 'list_catalog', 'list_projects', 'render_frame', 'save_project', 'tts_synthesize', 'validate_project'], `набор инструментов: ${names}`);
  const ttsTool = tools.tools.find((t) => t.name === 'tts_synthesize');
  const ttsSchema = ttsTool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  assert.ok(ttsSchema?.properties?.text && ttsSchema.required?.includes('text'), 'tts_synthesize: text обязателен');
  assert.ok(ttsSchema?.properties?.adapter && ttsSchema?.properties?.lang && ttsSchema?.properties?.force, 'tts_synthesize: adapter, lang и force описаны');
  assert.equal((await call('tts_synthesize', { text: 'раз два', adapter: 'fake' })).isError, true, 'fake у настоящего сервера отключён');

  assert.ok(body(await call('get_schema')).includes('Схема сцены v1'), 'get_schema отдаёт документацию');
  const catalog = JSON.parse(body(await call('list_catalog'))) as Array<{ id: string }>;
  assert.ok(catalog.length > 0 && catalog.every((c) => c.id), 'list_catalog непустой');
  assert.ok((JSON.parse(body(await call('list_projects'))) as string[]).includes('night-city-car'), 'list_projects видит проекты');
  assert.ok(Array.isArray(JSON.parse(body(await call('list_audio')))), 'list_audio отдаёт массив путей');

  const good = JSON.parse(body(await call('validate_project', { file: 'night-city-car' })));
  assert.equal(good.ok, true, 'эталонный проект валиден');
  const bad = JSON.parse(body(await call('validate_project', { json: { version: 1, scenes: [] } })));
  assert.equal(bad.ok, false, 'пустой проект невалиден');
  assert.ok(bad.errors.length > 0 && bad.errors[0].message, 'ошибки с текстом');
  assert.equal((await call('validate_project', { file: 'nope' })).isError, true, 'нет такого проекта — isError');

  const linted = JSON.parse(body(await call('lint_project', { file: 'night-city-car' })));
  assert.equal(linted.ok, true, 'lint_project: эталонный проект без warn');
  assert.ok(Array.isArray(linted.issues), 'lint_project: issues — массив');

  assert.equal((await call('lint_project', { json: { version: 1, scenes: [] } })).isError, true, 'lint_project: невалидный — isError');

  const r0 = await call('render_frame', { file: 'night-city-car', t: 0, scale: 0.25 });
  const img0 = r0.content.find((c) => c.type === 'image');
  assert.ok(img0?.data && Buffer.from(img0.data, 'base64').subarray(1, 4).toString() === 'PNG', 'render_frame возвращает PNG');
  const r1 = await call('render_frame', { file: 'night-city-car', t: 3, scale: 0.25 });
  assert.notEqual(r0.content[0].data, r1.content[0].data, 'кадры в t=0 и t=3 различаются');
  const again = await call('render_frame', { file: 'night-city-car', t: 3, scale: 0.25 });
  assert.equal(r1.content[0].data, again.content[0].data, 'один t — один и тот же кадр');
  assert.equal((await call('render_frame', { json: { version: 1 } })).isError, true, 'невалидный JSON не рисуется');

  const project = JSON.parse(fs.readFileSync(path.join(root, 'projects', 'night-city-car.project.json'), 'utf8'));
  assert.equal((await call('save_project', { name: '../x', json: project })).isError, true, 'save: обход каталога отклонён');
  assert.equal((await call('save_project', { name: tmpName, json: { version: 1, scenes: [] } })).isError, true, 'save: невалидный не сохраняется');
  const saved = await call('save_project', { name: tmpName, json: project });
  assert.ok(!saved.isError && fs.existsSync(path.join(root, 'projects', `${tmpName}.project.json`)), 'save: валидный сохранён');
  assert.equal((await call('save_project', { name: tmpName, json: project })).isError, true, 'save: без overwrite не перезаписывает');
  assert.ok(!(await call('save_project', { name: tmpName, json: project, overwrite: true })).isError, 'save: overwrite работает');

  // Озвучка: у настоящего сервера fake запрещён, в тестовом режиме ядро пишет wav во временную папку.
  const hasFfmpeg = (() => { try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();
  const tmpAudio = fs.mkdtempSync(path.join(os.tmpdir(), 'am-mcp-tts-'));
  try {
    if (!hasFfmpeg) console.log('SKIP tts_synthesize fake: нет ffmpeg');
    else {
      const testCore = createCore(root, { audioDir: tmpAudio, allowFake: true });
      const result = await testCore.ttsSynthesize({ text: 'раз два три', adapter: 'fake' });
      assert.ok(result.file.startsWith('tts/') && fs.existsSync(path.join(tmpAudio, result.file)), 'fake пишет wav во временную папку');
      assert.equal(result.words.length, 3, 'tts_synthesize считает слова');
      assert.ok(result.durationSec > 0, 'tts_synthesize меряет длительность');
      assert.ok(testCore.listAudio().includes(result.file), 'list_audio видит синтезированный файл');
    }
  } finally {
    fs.rmSync(tmpAudio, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(path.join(root, 'projects', `${tmpName}.project.json`), { force: true });
  await client.close();
}
console.log('check:mcp PASS');
