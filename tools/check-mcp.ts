import assert from 'node:assert';
import fs from 'node:fs';
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

const client = new Client({ name: 'check', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['tools/mcp-server.ts'], cwd: root }));
const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> }>;
const body = (r: { content: Array<{ type: string; text?: string }> }) => r.content.find((c) => c.type === 'text')?.text ?? '';
const tmpName = `zz-mcp-check-${process.pid}`;
try {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ['export_video', 'get_schema', 'list_catalog', 'list_projects', 'render_frame', 'save_project', 'validate_project'], `набор инструментов: ${tools}`);

  assert.ok(body(await call('get_schema')).includes('Схема сцены v1'), 'get_schema отдаёт документацию');
  const catalog = JSON.parse(body(await call('list_catalog'))) as Array<{ id: string }>;
  assert.ok(catalog.length > 0 && catalog.every((c) => c.id), 'list_catalog непустой');
  assert.ok((JSON.parse(body(await call('list_projects'))) as string[]).includes('night-city-car'), 'list_projects видит проекты');

  const good = JSON.parse(body(await call('validate_project', { file: 'night-city-car' })));
  assert.equal(good.ok, true, 'эталонный проект валиден');
  const bad = JSON.parse(body(await call('validate_project', { json: { version: 1, scenes: [] } })));
  assert.equal(bad.ok, false, 'пустой проект невалиден');
  assert.ok(bad.errors.length > 0 && bad.errors[0].message, 'ошибки с текстом');
  assert.equal((await call('validate_project', { file: 'nope' })).isError, true, 'нет такого проекта — isError');

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
} finally {
  fs.rmSync(path.join(root, 'projects', `${tmpName}.project.json`), { force: true });
  await client.close();
}
console.log('check:mcp PASS');
