// MCP-сервер движка (stdio): Open Code, Claude Code и любой MCP-клиент могут создавать, проверять и смотреть проекты.
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCore } from './mcp-core.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = createCore(root);
const server = new McpServer({ name: 'animation-motion', version: '1.0.0' });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] });
const source = { file: z.string().optional().describe('имя проекта в projects/ (без .project.json)'), json: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe('проект или сцена целиком (объект или строка JSON)') };

server.registerTool('get_schema', { description: 'Полное описание формата сцены и проекта (SCHEMA-v1). Прочитайте перед созданием проекта.', inputSchema: {} }, async () => { try { return text(core.getSchema()); } catch (e) { return fail(e); } });
server.registerTool('list_catalog', { description: 'Модели каталога: id, название, вид, теги, размер в метрах. В сцене используются как kind "asset" с params.asset = id.', inputSchema: {} }, async () => text(core.listCatalog()));
server.registerTool('list_projects', { description: 'Проекты в папке projects/.', inputSchema: {} }, async () => text(core.listProjects()));
server.registerTool('validate_project', { description: 'Проверить проект или сцену. Возвращает ok, errors и warnings с путями и подсказками как исправить.', inputSchema: source }, async (a) => { try { const { parsed: _p, ...r } = core.validate(a); return text(r); } catch (e) { return fail(e); } });
server.registerTool('render_frame', { description: 'Нарисовать один кадр проекта или сцены и вернуть картинку PNG, чтобы увидеть результат. t — секунды от начала проекта.', inputSchema: { ...source, t: z.number().min(0).optional(), format: z.enum(['h', 'v']).optional().describe('h = 16:9, v = 9:16'), scale: z.number().min(0.1).max(1).optional().describe('масштаб от 1920x1080 (по умолчанию 0.5)') } }, async (a) => {
  try {
    const r = core.render({ file: a.file, json: a.json }, { t: a.t, format: a.format, scale: a.scale });
    return { content: [{ type: 'image' as const, data: r.png.toString('base64'), mimeType: 'image/png' }, { type: 'text' as const, text: `кадр t=${r.t.toFixed(2)} с из ${r.duration.toFixed(2)} с, ${r.w}x${r.h}` }] };
  } catch (e) { return fail(e); }
});
server.registerTool('save_project', { description: 'Проверить и сохранить проект в projects/<name>.project.json. Не перезаписывает существующий без overwrite.', inputSchema: { name: z.string(), json: source.json, overwrite: z.boolean().optional() } }, async (a) => { try { if (a.json === undefined) throw new Error('укажите json'); return text(core.save(a.name, a.json, a.overwrite)); } catch (e) { return fail(e); } });
server.registerTool('export_video', { description: 'Вывести проект в MP4 (нужен ffmpeg). Длинные проекты считаются минуты; результат — файл в out/mcp/.', inputSchema: { file: z.string().describe('имя проекта в projects/'), format: z.enum(['h', 'v']).optional() } }, async (a) => {
  try {
    const args = core.exportArgs(a.file, a.format);
    const result = await new Promise<{ code: number | null; log: string }>((resolve) => {
      const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', (d) => { log += d; });
      child.stderr.on('data', (d) => { log += d; });
      child.on('error', (e) => resolve({ code: -1, log: String(e) }));
      child.on('close', (code) => resolve({ code, log }));
    });
    const tail = result.log.trim().split('\n').slice(-12).join('\n');
    return result.code === 0 ? text(`готово:\n${tail}`) : fail(`экспорт не удался (код ${result.code}):\n${tail}`);
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
