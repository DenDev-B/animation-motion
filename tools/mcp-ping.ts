// Быстрая проверка MCP-сервера для владельца: запускает его как клиент, перечисляет инструменты, рисует один кадр.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = ['export_video', 'get_schema', 'list_catalog', 'list_projects', 'render_frame', 'save_project', 'validate_project'];
const client = new Client({ name: 'mcp-ping', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['tools/mcp-server.ts'], cwd: root }));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  const missing = EXPECTED.filter((n) => !tools.includes(n));
  if (missing.length) throw new Error(`нет инструментов: ${missing.join(', ')}`);
  console.log(`MCP: сервер отвечает, инструментов ${tools.length}: ${tools.join(', ')}`);
  const frame = (await client.callTool({ name: 'render_frame', arguments: { file: 'night-city-car', t: 0, scale: 0.25 } })) as { isError?: boolean; content: Array<{ type: string; data?: string; text?: string }> };
  const image = frame.content.find((c) => c.type === 'image');
  if (frame.isError || !image?.data || Buffer.from(image.data, 'base64').subarray(1, 4).toString() !== 'PNG') throw new Error('render_frame не вернул PNG');
  console.log(`MCP: тестовый кадр нарисован (${frame.content.find((c) => c.type === 'text')?.text ?? ''})`);
  console.log('mcp:ping PASS');
} catch (e) {
  console.log(`mcp:ping FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
