// Локальный сервис: живой HTTP-запросы к ping/catalog/add на копий каталога во временной папке.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createLocalApi, LOCAL_API_VERSION, MAX_BODY_BYTES } from './local-api.ts';

let errors = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); errors++; };
const ok = (msg: string) => console.log('OK:', msg);

const realCatalog = path.resolve('catalog');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-local-api-'));
const root = tmp;
fs.cpSync(realCatalog, path.join(tmp, 'catalog'), { recursive: true });
const catalogDir = path.join(tmp, 'catalog');

let port = 0;
const api = createLocalApi({ root, getPort: () => port });
const server = http.createServer((req, res) => {
  api.handle(req, res).then((handled) => {
    if (!handled) { res.statusCode = 404; res.end(''); }
  }, (error: unknown) => {
    res.statusCode = 500;
    res.end(String(error));
  });
});

interface Reply {
  status: number;
  json: { ok?: boolean; id?: string; version?: number; errors?: Array<{ path: string; message: string }> };
  text: string;
}

function request(options: { method: string; path: string; host?: string; origin?: string; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.host) headers.host = options.host;
    if (options.origin !== undefined) headers.origin = options.origin;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, method: options.method, path: options.path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Reply['json'] = {};
        try { json = JSON.parse(text) as Reply['json']; } catch { /* ответ проверяется статусом */ }
        resolve({ status: res.statusCode ?? 0, json, text });
      });
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const validModel = {
  version: 1,
  id: 'test-bell',
  name: 'Колокольчик',
  bounds: [-10, -10, 20, 20],
  realSize: { heightM: 0.3 },
  meta: { view: 'side', tags: ['тест'], license: { name: 'own', author: 'project', source: '', attribution: false } },
  parts: [{ id: 'body', d: 'M -10 -10 L 10 10 Z', fill: '#ffffff' }],
};
const postAdd = (model: unknown, overwrite = false, origin?: string) =>
  request({ method: 'POST', path: '/__api/catalog/add', origin, body: JSON.stringify({ model, overwrite }) });

try {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  const localHost = `127.0.0.1:${port}`;

  // 1. ping
  const ping = await request({ method: 'GET', path: '/__api/ping', host: localHost });
  if (ping.status !== 200 || ping.json.ok !== true || ping.json.version !== LOCAL_API_VERSION) fail(`ping: ${ping.status} ${ping.text.slice(0, 120)}`);
  else ok(`ping: ok, version ${ping.json.version}`);

  // 2. корректная модель
  const added = await postAdd(validModel, false, 'http://' + localHost);
  if (added.status !== 200 || added.json.ok !== true || added.json.id !== 'test-bell') fail(`добавление модели: ${added.status} ${added.text.slice(0, 200)}`);
  else if (!fs.existsSync(path.join(catalogDir, 'test-bell.json'))) fail('файл catalog/test-bell.json не создан');
  else ok(`модель добавлена: ${added.json.id}`);

  const indexAfterAdd = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index.json'), 'utf8')) as Array<{ id: string }>;
  if (!indexAfterAdd.some((e) => e.id === 'test-bell')) fail('catalog/index.json не пополнился новой моделью');
  else ok('catalog/index.json обновлён');

  // 3. некорректная модель
  const before = fs.readdirSync(catalogDir).join(',');
  const bad = await postAdd({ ...validModel, id: 'test-bad', bounds: [0, 0, 0, 0], parts: [] });
  if (bad.status !== 200 || bad.json.ok !== false) fail(`некорректная модель должна отклоняться: ${bad.status} ${bad.text.slice(0, 200)}`);
  else if (!bad.json.errors?.length) fail('у отклонённой модели нет списка ошибок');
  else if (!/bounds|parts/.test(bad.json.errors.map((e) => `${e.path} ${e.message}`).join(' '))) fail(`ошибки не про содержимое модели: ${JSON.stringify(bad.json.errors)}`);
  else ok(`некорректная модель отклонена: ${bad.json.errors[0].message.slice(0, 60)}…`);
  if (fs.readdirSync(catalogDir).join(',') !== before) fail('некорректная модель что-то записала в каталог');

  // 4. перезапись только с overwrite
  const renamed = { ...validModel, name: 'Колокольчик второй' };
  const second = await postAdd(renamed);
  if (second.json.ok !== true || second.json.id !== 'test-bell_2') fail(`без overwrite ожидался id test-bell_2, получено ${JSON.stringify(second.json)}`);
  const firstText = fs.readFileSync(path.join(catalogDir, 'test-bell.json'), 'utf8');
  if (!firstText.includes('Колокольчик"')) fail('без overwrite существующая модель перезаписана');
  else ok('без overwrite создана копия с суффиксом _2');
  const forced = await postAdd(renamed, true);
  if (forced.json.ok !== true || forced.json.id !== 'test-bell') fail(`с overwrite ожидался id test-bell, получено ${JSON.stringify(forced.json)}`);
  const afterForce = fs.readFileSync(path.join(catalogDir, 'test-bell.json'), 'utf8');
  if (!afterForce.includes('Колокольчик второй')) fail('с overwrite модель не перезаписалась');
  else ok('с overwrite модель перезаписана');

  // 5. чужой Host и чужой порт
  const foreignHost = await request({ method: 'GET', path: '/__api/ping', host: 'example.com:' + port });
  if (foreignHost.status !== 403) fail(`чужой Host должен давать 403, получено ${foreignHost.status}`);
  else ok('чужой Host: 403');
  const foreignPort = await request({ method: 'GET', path: '/__api/ping', host: 'localhost:1' });
  if (foreignPort.status !== 403) fail(`Host с чужим портом должен давать 403, получено ${foreignPort.status}`);
  else ok('Host с чужим портом: 403');

  // 6. чужой Origin у POST
  const foreignOrigin = await postAdd(validModel, false, 'http://evil.example');
  if (foreignOrigin.status !== 403) fail(`чужой Origin должен давать 403, получено ${foreignOrigin.status} ${foreignOrigin.text.slice(0, 120)}`);
  else ok('чужой Origin у POST: 403');

  // 7. слишком большое тело
  const huge = await postAdd({ note: 'x'.repeat(MAX_BODY_BYTES + 1024) });
  if (huge.status !== 413) fail(`тело больше лимита должно давать 413, получено ${huge.status}`);
  else ok('тело больше 5 МБ: 413');

  // 8. id с путём
  const escaping = await postAdd({ ...validModel, id: '../x' });
  if (escaping.json.ok !== false || !escaping.json.errors?.some((e) => /id/.test(e.path) || /id/.test(e.message))) fail(`id «../x» должен отклоняться: ${escaping.text.slice(0, 200)}`);
  else ok('id «../x» отклонён');
  for (const outside of [path.join(tmp, 'x.json'), path.join(catalogDir, 'x.json')]) {
    if (fs.existsSync(outside)) fail(`файл попал в некаталожную папку: ${outside}`);
  }

  // 9. методы и неизвестный эндпоинт
  const wrongMethod = await request({ method: 'GET', path: '/__api/catalog/add', host: localHost });
  if (wrongMethod.status !== 405) fail(`GET на catalog/add должен давать 405, получено ${wrongMethod.status}`);
  else ok('GET на catalog/add: 405');
  const unknown = await request({ method: 'GET', path: '/__api/nope', host: localHost });
  if (unknown.status !== 404) fail(`неизвестный эндпоинт должен давать 404, получено ${unknown.status}`);
  else ok('неизвестный эндпоинт: 404');
  const notApi = await request({ method: 'GET', path: '/index.html', host: localHost });
  if (notApi.status !== 404) fail('запрос вне /__api/ должен уйти мимо сервиса');
  else ok('запрос вне /__api/ обслужен не сервисом');

  if (fs.existsSync(path.join(realCatalog, 'test-bell.json'))) fail('тест записал модель в настоящий catalog/');
} finally {
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(errors === 0 ? 'check:local-api OK' : `check:local-api FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
