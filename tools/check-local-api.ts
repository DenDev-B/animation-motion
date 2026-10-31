// Локальный сервис: живые HTTP-запросы к ping/catalog/add/export на копии каталога во временной папке.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createLocalApi, LOCAL_API_VERSION, MAX_BODY_BYTES } from './local-api.ts';

let errors = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); errors++; };
const ok = (msg: string) => console.log('OK:', msg);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const realCatalog = path.resolve('catalog');
const realExportDir = path.resolve('out', 'export');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-local-api-'));
const root = tmp;
fs.cpSync(realCatalog, path.join(tmp, 'catalog'), { recursive: true });
const catalogDir = path.join(tmp, 'catalog');
const realExportBefore = fs.existsSync(realExportDir) ? fs.readdirSync(realExportDir).sort().join(',') : '';

let port = 0;
const api = createLocalApi({ root, getPort: () => port, exportScript: path.resolve('tools', 'export.ts') });
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
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json: {
    ok?: boolean;
    id?: string;
    version?: number;
    jobId?: string;
    state?: string;
    frame?: number;
    total?: number;
    file?: string;
    message?: string;
    errors?: Array<{ path: string; message: string }>;
  };
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
        const body = Buffer.concat(chunks);
        const text = body.toString('utf8');
        let json: Reply['json'] = {};
        try { json = JSON.parse(text) as Reply['json']; } catch { /* ответ проверяется статусом */ }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json, text });
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

/** Есть ли утилита в PATH; экспорт без ffmpeg проверяется честно и печатает «пропущено». */
function hasTool(name: string): boolean {
  try {
    return spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

function probeVideo(file: string): Record<string, string> | null {
  try {
    const result = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,nb_frames',
      '-of', 'json', file,
    ], { encoding: 'utf8' });
    if (result.status !== 0) return null;
    return (JSON.parse(result.stdout) as { streams: Array<Record<string, string>> }).streams[0] ?? null;
  } catch {
    return null;
  }
}

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

  // 10. экспорт MP4: самый короткий легальный проект (1 сцена, 1 с, 24 fps)
  const shortProject = {
    version: 1,
    title: 'api-export-short',
    fps: 24,
    format: '16:9',
    scenes: [{
      id: 'one',
      name: 'Одна сцена',
      transition: { type: 'cut' },
      scene: {
        version: 1,
        title: 'Фон',
        duration: 1,
        palette: { sky: ['#123456', '#654321'] },
        camera: { keys: [] },
        assets: {},
        layers: [],
      },
    }],
  };
  const longProject = {
    ...shortProject,
    title: 'api-export-long',
    fps: 60,
    scenes: [{ ...shortProject.scenes[0], scene: { ...shortProject.scenes[0].scene, duration: 5 } }],
  };
  const postExport = (proj: unknown) => request({ method: 'POST', path: '/__api/export', body: JSON.stringify({ project: proj }) });
  const exportStatus = (id: string) => request({ method: 'GET', path: `/__api/export/status?id=${id}` });

  const badBody = await request({ method: 'POST', path: '/__api/export', body: '{"project": 5}' });
  if (badBody.json.ok !== false) fail(`проект-число должен отклоняться: ${badBody.text.slice(0, 160)}`);
  else ok('экспорт с некорректным проектом отклонён');
  const badId = await request({ method: 'GET', path: '/__api/export/status?id=../../etc' });
  if (badId.status !== 400 && badId.status !== 404) fail(`чужой id задания должен отклоняться, получено ${badId.status}`);
  else ok(`чужой id задания: ${badId.status}`);

  if (!hasTool('ffmpeg')) {
    ok('пропущено: нет ffmpeg');
  } else {
    const started = await postExport(shortProject);
    const jobId = started.json.jobId ?? '';
    if (started.status !== 200 || started.json.ok !== true || !jobId) fail(`экспорт не принят: ${started.status} ${started.text.slice(0, 200)}`);
    else {
      ok(`экспорт принят: задание ${jobId}`);
      const busy = await postExport(shortProject);
      if (busy.status !== 409) fail(`второй экспорт одновременно должен давать 409, получено ${busy.status}`);
      else ok('второй экспорт одновременно: 409');
      let last = await exportStatus(jobId);
      const deadline = Date.now() + 180000;
      while (last.json.state === 'running' && Date.now() < deadline) {
        await sleep(200);
        last = await exportStatus(jobId);
      }
      if (last.json.state !== 'done') fail(`экспорт не завершился: ${last.text.slice(0, 200)}`);
      else {
        ok(`экспорт завершён: кадр ${last.json.frame} из ${last.json.total}`);
        if (last.json.total !== 24) fail(`прогресс не досчитался 24 кадров: ${last.json.total}`);
        const rel = String(last.json.file);
        const videoPath = path.resolve(root, rel);
        if (!rel.startsWith('out/export/') || !videoPath.startsWith(path.resolve(root))) fail(`видео попало не во временный out/export: ${rel}`);
        else if (!fs.existsSync(videoPath)) fail(`видео не записано: ${rel}`);
        else {
          const download = await request({ method: 'GET', path: `/__api/export/file?id=${jobId}` });
          const magic = download.body.subarray(4, 8).toString('latin1');
          if (download.status !== 200 || magic !== 'ftyp') fail(`скачивание не отдаёт MP4: код ${download.status}, сигнатура ${magic}`);
          else if (!/video\/mp4/.test(String(download.headers['content-type']))) fail(`content-type не video/mp4: ${download.headers['content-type']}`);
          else ok(`скачивание MP4: ${download.body.length} байт, имя файла из content-disposition`);
          const probe = probeVideo(videoPath);
          if (!probe) fail('ffprobe не прочитал готовое видео');
          else if (Number(probe.width) !== 1920 || Number(probe.height) !== 1080 || Number(probe.nb_frames) !== 24) fail(`ffprobe: ${JSON.stringify(probe)}`);
          else ok(`ffprobe: ${probe.width}x${probe.height}, ${probe.nb_frames} кадров, ${probe.codec_name}`);
        }
      }

      const long = await postExport(longProject);
      const longId = long.json.jobId ?? '';
      if (!longId) fail(`второй (длинный) экспорт не принят: ${long.status} ${long.text.slice(0, 200)}`);
      else {
        await sleep(1200);
        const cancel = await request({ method: 'POST', path: `/__api/export/cancel?id=${longId}` });
        if (cancel.json.state !== 'cancelled') fail(`отмена не сработала: ${cancel.text.slice(0, 200)}`);
        else ok('отмена: состояние cancelled');
        const afterCancel = await exportStatus(longId);
        if (afterCancel.json.state !== 'cancelled') fail(`после отмены состояние «${afterCancel.json.state}»`);
        let partial = 'есть';
        for (let i = 0; i < 100; i++) {
          partial = fs.readdirSync(path.join(root, 'out', 'export')).filter((f) => f.includes(longId)).join(',');
          if (!partial) break;
          await sleep(100);
        }
        if (partial) fail(`после отмены остался файл: ${partial}`);
        else ok('после отмены частичный файл удалён');
        const again = await postExport(shortProject);
        if (again.status !== 200 || !again.json.jobId) fail(`после отмены слот не освободился: ${again.status} ${again.text.slice(0, 160)}`);
        else ok('после отмены принимается новый экспорт');
        await request({ method: 'POST', path: `/__api/export/cancel?id=${again.json.jobId ?? ''}` });
      }
    }
  }

  if (fs.existsSync(path.join(realCatalog, 'test-bell.json'))) fail('тест записал модель в настоящий catalog/');
  const realExportAfter = fs.existsSync(realExportDir) ? fs.readdirSync(realExportDir).sort().join(',') : '';
  if (realExportAfter !== realExportBefore) fail('тест записал видео в настоящий out/export');
  else ok('настоящий out/export не тронут');
} finally {
  api.close();
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(errors === 0 ? 'check:local-api OK' : `check:local-api FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
