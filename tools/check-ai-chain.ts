// Цепочка Gemini → Groq → ручной путь: без сети и без настоящих ключей (fetch подменён).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { callProvider, classifyHttpError, generateWithChain, ProviderError, MANUAL_HINT, type FetchFn, type ProviderSpec, type CheckResult } from '../engine/ai-chain.ts';
import { createLocalApi } from './local-api.ts';
import { parseEnv, loadProviders } from './env-local.ts';

const failures: string[] = [];
const ok = (c: boolean, l: string) => { if (!c) { failures.push(l); console.error(`FAIL ${l}`); } else console.log(`OK   ${l}`); };

type Mock = { status: number; body: string };
const reply = (status: number, body: unknown): Mock => ({ status, body: typeof body === 'string' ? body : JSON.stringify(body) });
const gemini = (text: string, finish = 'STOP') => reply(200, { candidates: [{ finishReason: finish, content: { parts: [{ text }] } }] });
const groq = (text: string, finish = 'stop') => reply(200, { choices: [{ finish_reason: finish, message: { content: text } }] });

function makeFetch(handler: (url: string, init: Parameters<FetchFn>[1], n: number) => Mock | Error) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const r = handler(url, init, calls.length);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  return { fn, calls };
}
const G: ProviderSpec = { id: 'gemini', apiKey: 'KEY_GEMINI_123', model: 'gemini-test' };
const Q: ProviderSpec = { id: 'groq', apiKey: 'KEY_GROQ_456', model: 'groq-test' };
const kindOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ProviderError ? e.kind : `other:${String(e)}`; } };

async function main() {
  // --- разбор ответов провайдеров ---
  const okG = makeFetch(() => gemini('привет'));
  ok(await callProvider(G, 'p', okG.fn) === 'привет', 'Gemini: текст ответа извлечён');
  ok(!okG.calls[0].url.includes('KEY_GEMINI') && okG.calls[0].headers['x-goog-api-key'] === 'KEY_GEMINI_123', 'Gemini: ключ только в заголовке, не в URL');
  ok(okG.calls[0].url.includes('gemini-test:generateContent'), 'Gemini: модель в адресе');
  const okQ = makeFetch(() => groq('ответ'));
  ok(await callProvider(Q, 'p', okQ.fn) === 'ответ', 'Groq: текст ответа извлечён');
  ok(okQ.calls[0].headers.authorization === 'Bearer KEY_GROQ_456' && JSON.parse(okQ.calls[0].body).model === 'groq-test', 'Groq: ключ в Authorization, модель в теле');
  const kinds: Array<[string, ProviderSpec, Mock | Error, string]> = [
    ['Gemini 429 → quota', G, reply(429, { error: { message: 'Quota exceeded' } }), 'quota'],
    ['Gemini 400 API key not valid → key', G, reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), 'key'],
    ['Gemini 403 → key', G, reply(403, { error: { message: 'denied' } }), 'key'],
    ['Gemini 404 → model', G, reply(404, { error: { message: 'model not found' } }), 'model'],
    ['Gemini 503 → server', G, reply(503, { error: { message: 'overloaded' } }), 'server'],
    ['Gemini blockReason → blocked', G, reply(200, { promptFeedback: { blockReason: 'SAFETY' } }), 'blocked'],
    ['Gemini MAX_TOKENS → truncated', G, gemini('{"a":', 'MAX_TOKENS'), 'truncated'],
    ['Gemini пустой ответ → empty', G, reply(200, { candidates: [] }), 'empty'],
    ['Groq 413 → too_large', Q, reply(413, { error: { message: 'Request too large' } }), 'too_large'],
    ['Groq 429 tokens per minute → too_large', Q, reply(429, { error: { message: 'Rate limit reached ... tokens per minute (TPM): Limit 12000, Requested 20000' } }), 'too_large'],
    ['Groq 429 обычный → quota', Q, reply(429, { error: { message: 'Rate limit reached for requests per day' } }), 'quota'],
    ['Groq 401 → key', Q, reply(401, { error: { message: 'Invalid API Key' } }), 'key'],
    ['Groq length → truncated', Q, groq('{', 'length'), 'truncated'],
    ['сеть недоступна → network', G, new Error('ECONNRESET'), 'network'],
  ];
  for (const [label, spec, mock, expected] of kinds) ok(await kindOf(callProvider(spec, 'p', makeFetch(() => mock).fn)) === expected, label);
  const hang: FetchFn = (_url, init) => new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  ok(await kindOf(callProvider(G, 'p', hang, 30)) === 'timeout', 'таймаут → timeout');
  const leak = classifyHttpError('gemini', 400, JSON.stringify({ error: { message: 'bad key KEY_GEMINI_123 here' } }), 'KEY_GEMINI_123');
  ok(!leak.message.includes('KEY_GEMINI_123'), 'ключ вырезается из текста ошибки');

  // --- цепочка ---
  const goodCheck = (text: string): CheckResult => (text.includes('GOOD') ? { ok: true, errors: [] } : { ok: false, errors: [{ path: 'x', message: 'плохо' }], candidate: { bad: true } });
  const noop = (): never => { throw new Error('не должен вызываться'); };
  const dispatch = (map: Record<string, (n: number, body: string) => Mock | Error>) => makeFetch((url, init, n) => (url.includes('googleapis') ? map.gemini(n, init.body) : map.groq(n, init.body)));
  const callWith = (f: FetchFn) => (spec: ProviderSpec, p: string) => callProvider(spec, p, f);

  let m = dispatch({ gemini: () => gemini('GOOD'), groq: noop });
  let r = await generateWithChain({ prompt: 'p', providers: [G, Q], call: callWith(m.fn), check: goodCheck });
  ok(r.ok && r.provider === 'gemini' && m.calls.length === 1, 'Gemini справился: Groq не вызывается');

  m = dispatch({ gemini: () => reply(429, { error: { message: 'quota' } }), groq: () => groq('GOOD') });
  r = await generateWithChain({ prompt: 'p', providers: [G, Q], call: callWith(m.fn), check: goodCheck });
  ok(r.ok && r.provider === 'groq' && r.attempts[0].kind === 'quota', 'лимит Gemini → ответ даёт Groq');

  m = dispatch({ gemini: (n) => (n === 1 ? gemini('плохо') : gemini('GOOD')), groq: noop });
  r = await generateWithChain({ prompt: 'p', providers: [G, Q], call: callWith(m.fn), check: goodCheck });
  ok(r.ok && r.provider === 'gemini' && m.calls.length === 2 && m.calls[1].body.includes('Исправь перечисленные ошибки'), 'ошибки проверки → запрос исправления тому же провайдеру');

  m = dispatch({ gemini: () => gemini('плохо'), groq: () => groq('GOOD') });
  r = await generateWithChain({ prompt: 'p', providers: [G, Q], call: callWith(m.fn), check: goodCheck });
  ok(r.ok && r.provider === 'groq' && m.calls.filter((c) => c.url.includes('googleapis')).length === 3, 'после 2 неудачных исправлений Gemini → Groq');

  m = dispatch({ gemini: () => reply(503, { error: { message: 'down' } }), groq: () => reply(429, { error: { message: 'Request too large' } }) });
  r = await generateWithChain({ prompt: 'p', providers: [G, Q], call: callWith(m.fn), check: goodCheck });
  ok(!r.ok && r.attempts.length === 2 && r.message.includes(MANUAL_HINT) && r.message.includes('Gemini') && r.message.includes('Groq'), 'оба не справились → сообщение про ручной путь');
  ok(!r.ok && !r.message.includes('KEY_'), 'в сообщении нет ключей');

  r = await generateWithChain({ prompt: 'p', providers: [], call: noop, check: goodCheck });
  ok(!r.ok && r.message.includes('.env.local') && r.message.includes(MANUAL_HINT), 'нет ключей → сообщение про .env.local и ручной путь');

  m = dispatch({ gemini: () => reply(503, { error: { message: 'down' } }), groq: () => groq('GOOD') });
  r = await generateWithChain({ prompt: 'p', providers: [Q], call: callWith(m.fn), check: goodCheck });
  ok(r.ok && r.provider === 'groq' && m.calls.length === 1, 'настроен только Groq: Gemini не вызывается');

  // --- .env.local ---
  const env = parseEnv('﻿# комментарий\r\nGEMINI_API_KEY="abc"\r\nexport GROQ_API_KEY=xyz # хвост\nGEMINI_MODEL=m1\nпусто\n');
  ok(env.GEMINI_API_KEY === 'abc' && env.GROQ_API_KEY === 'xyz' && env.GEMINI_MODEL === 'm1', 'parseEnv: кавычки, export, комментарии, CRLF, BOM');

  // --- локальный сервис ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-ai-'));
  fs.cpSync(path.resolve('catalog'), path.join(tmp, 'catalog'), { recursive: true });
  const project = fs.readFileSync(path.resolve('projects', 'night-city-car.project.json'), 'utf8');
  const goodText = `ТЗ не нужно.\n\`\`\`json\n${project}\n\`\`\``;
  let port = 0;
  let mock = dispatch({ gemini: () => gemini(goodText), groq: () => groq(goodText) });
  const api = createLocalApi({ root: tmp, getPort: () => port, aiFetch: (url, init) => mock.fn(url, init), env: {} });
  const server = http.createServer((req, res) => { api.handle(req, res).then((h) => { if (!h) { res.statusCode = 404; res.end(); } }, (e) => { res.statusCode = 500; res.end(String(e)); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  const call = (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; text: string; json: any }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path: `/__api/${route}`, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json: unknown = null; try { json = JSON.parse(text); } catch { /* не JSON */ } resolve({ status: res.statusCode ?? 0, text, json }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  try {
    let s = await call('GET', 'ai/status');
    ok(s.json.ok && s.json.providers.every((p: any) => p.configured === false), 'status без ключей: оба не настроены');
    let g = await call('POST', 'ai/generate', { prompt: 'сделай проект' });
    ok(g.json.ok === false && g.json.manual === true && g.json.message.includes('.env.local'), 'generate без ключей → ручной путь');
    fs.writeFileSync(path.join(tmp, '.env.local'), 'GEMINI_API_KEY=SECRET_G_999\nGROQ_API_KEY=SECRET_Q_999\n');
    s = await call('GET', 'ai/status');
    ok(s.json.providers.every((p: any) => p.configured === true) && !s.text.includes('SECRET'), 'status с ключами: настроены, ключи не показаны');
    g = await call('POST', 'ai/generate', { prompt: 'сделай проект' });
    ok(g.json.ok === true && g.json.provider === 'gemini' && g.json.text.includes('"version"'), 'generate: Gemini вернул валидный проект');
    ok(!g.text.includes('SECRET'), 'generate: ключи не попали в ответ');
    mock = dispatch({ gemini: () => reply(429, { error: { message: 'quota' } }), groq: () => groq(goodText) });
    g = await call('POST', 'ai/generate', { prompt: 'сделай проект' });
    ok(g.json.ok === true && g.json.provider === 'groq', 'generate: лимит Gemini → ответ Groq через сервис');
    mock = dispatch({ gemini: () => reply(503, { error: { message: 'KEY SECRET_G_999 down' } }), groq: () => groq('{"version":1') });
    g = await call('POST', 'ai/generate', { prompt: 'сделай проект' });
    ok(g.json.ok === false && g.json.manual === true && g.json.message.includes(MANUAL_HINT) && !g.text.includes('SECRET'), 'generate: оба не справились → ручной путь без ключей в тексте');
    const c = await call('POST', 'ai/check');
    ok(c.json.ok && c.json.results.length === 2 && !c.text.includes('SECRET'), 'check: результат по каждому провайдеру, без ключей');
    ok((await call('POST', 'ai/generate', { prompt: '' })).status === 400, 'generate: пустой промт → 400');
    ok((await call('POST', 'ai/generate', { prompt: 'x' }, { origin: 'http://evil.example' })).status === 403, 'generate: чужой Origin → 403');
    ok((await call('POST', 'ai/generate', { prompt: 'x' }, { host: 'evil.example' })).status === 403, 'generate: чужой Host → 403');
    ok((await call('GET', 'ai/generate')).status === 405, 'generate: GET → 405');
    ok(loadProviders(tmp, {}).length === 2, 'loadProviders читает .env.local');
  } finally {
    server.close(); api.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures.length) { console.error(`check:ai-chain FAIL (${failures.length})`); process.exit(1); }
  console.log('check:ai-chain PASS');
}
main().catch((e) => { console.error(e); process.exit(1); });
