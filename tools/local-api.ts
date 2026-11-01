// Локальный сервис кнопок редактора: регистрируется только в dev-режиме Vite и только на localhost.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { addToCatalog } from '../engine/catalog-add.ts';
import { validateProject } from '../engine/project.ts';
import { formatFileToken, safeFileName } from './file-names.ts';

export const LOCAL_API_PREFIX = '/__api/';
export const LOCAL_API_VERSION = 1;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** id модели: те же символы, что оставляет slugify в addToCatalog, но без тихой правки. */
const MODEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** id задания экспорта генерирует сам сервис; в путях используем только его. */
const JOB_ID_RE = /^[a-z0-9]{1,32}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
const EXPORT_LOG_LIMIT = 4000;

export type ExportState = 'running' | 'done' | 'error' | 'cancelled';

export interface ApiIssue {
  path: string;
  message: string;
}

export interface ApiReply {
  ok: boolean;
  id?: string;
  version?: number;
  errors?: ApiIssue[];
}

export interface ExportStatusReply extends ApiReply {
  jobId?: string;
  state?: ExportState;
  frame?: number;
  total?: number;
  file?: string;
  message?: string;
}

export interface LocalApiOptions {
  /** Корень проекта: модели пишутся в <root>/catalog, видео — в <root>/out/export. */
  root: string;
  /** Фактический порт dev-сервера — сверяется с заголовком Host. */
  getPort: () => number;
  /** Скрипт экспорта; по умолчанию <root>/tools/export.ts, как его вызывает npm run export. */
  exportScript?: string;
}

export interface LocalApi {
  /** true, если запрос относился к /__api/ и на него уже отвечили. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** Останавливает только свои дочерние процессы экспорта. */
  close(): void;
}

class BodyTooLarge extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function sendJson(res: ServerResponse, status: number, reply: ApiReply | ExportStatusReply): void {
  const body = JSON.stringify(reply, null, 2);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body, 'utf8'));
  res.end(body);
}

function fail(res: ServerResponse, status: number, message: string, apiPath = ''): void {
  sendJson(res, status, { ok: false, errors: [{ path: apiPath, message }] });
}

function parseHost(raw: string): { name: string; port: string } | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return null;
  const bracket = /^\[([^\]]*)\](?::(\d+))?$/.exec(value);
  if (bracket) return { name: bracket[1], port: bracket[2] ?? '' };
  const plain = /^([^:]*)(?::(\d+))?$/.exec(value);
  if (!plain) return null;
  return { name: plain[1], port: plain[2] ?? '' };
}

function hostOf(req: IncomingMessage): { name: string; port: string } | null {
  return parseHost(String(req.headers.host ?? ''));
}

function isAllowedHost(req: IncomingMessage, port: number): boolean {
  const host = hostOf(req);
  if (!host || !LOOPBACK_HOSTS.has(host.name)) return false;
  return host.port === '' || host.port === String(port);
}

/** Браузер шлёт Origin у POST; чужой origin — это запрос с другой страницы. */
function isSameOrigin(req: IncomingMessage): boolean {
  const raw = String(req.headers.origin ?? '');
  if (!raw || raw === 'null') return true;
  let originHost: { name: string; port: string } | null = null;
  try {
    originHost = parseHost(new URL(raw).host);
  } catch {
    return false;
  }
  const host = hostOf(req);
  return !!originHost && !!host && originHost.name === host.name && originHost.port === host.port;
}

function readBody(req: IncomingMessage): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 'NaN');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume();
    return Promise.reject(new BodyTooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.resume();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(new BodyTooLarge()));
  });
}

/** addToCatalog берёт catalog/ из process.cwd(); вызов синхронный, поэтому переключение безопасно. */
function runInRoot<T>(root: string, fn: () => T): T {
  const previous = process.cwd();
  if (path.resolve(previous) === path.resolve(root)) return fn();
  process.chdir(root);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function modelSourceId(model: unknown): string {
  if (!isRecord(model)) return '';
  const id = typeof model.id === 'string' ? model.id.trim() : '';
  if (id) return id;
  return typeof model.name === 'string' ? model.name.trim() : '';
}

/** ASCII-вариант имени для content-disposition: символы вне 0x20–0x7E → «_», кавычки и «\» выбрасываем; пустое → video.mp4. */
function asciiFileName(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"' || ch === '\\') continue;
    out += code >= 0x20 && code <= 0x7e ? ch : '_';
  }
  return out || 'video.mp4';
}

/** attachment с ASCII-именем и полной копией в UTF-8 (RFC 5987); имя файла на диске не меняется. */
export function contentDisposition(name: string): string {
  // encodeURIComponent оставляет ' ( ) * — их в attr-char нет, экранируем.
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFileName(name)}"; filename*=UTF-8''${encoded}`;
}

export function createLocalApi(options: LocalApiOptions): LocalApi {
  const root = path.resolve(options.root);
  const catalogDir = path.join(root, 'catalog');
  const exportDir = path.join(root, 'out', 'export');
  const exportTmpDir = path.join(exportDir, '.tmp');
  const exportScript = options.exportScript ? path.resolve(options.exportScript) : path.join(root, 'tools', 'export.ts');

  interface ExportJob {
    id: string;
    state: ExportState;
    frame: number;
    total: number;
    outFile: string;
    tmpProject: string;
    log: string;
    child: ChildProcess | null;
    message?: string;
  }

  const jobs = new Map<string, ExportJob>();

  function runningJob(): ExportJob | null {
    for (const job of jobs.values()) if (job.state === 'running') return job;
    return null;
  }

  function catalogIds(): string[] {
    let files: string[] = [];
    try {
      files = fs.readdirSync(catalogDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
    } catch {
      return [];
    }
    return files.map((f) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')) as { id?: string };
        return typeof parsed.id === 'string' && parsed.id ? parsed.id : f.replace(/\.json$/, '');
      } catch {
        return f.replace(/\.json$/, '');
      }
    });
  }

  function appendLog(job: ExportJob, text: string): void {
    job.log = (job.log + text).slice(-EXPORT_LOG_LIMIT);
    for (const line of text.split('\n')) {
      const step = /^\s*(\d+)\/(\d+)\s/.exec(line);
      if (step) {
        job.frame = Number(step[1]);
        job.total = Number(step[2]);
        continue;
      }
      const declared = /N=(\d+)/.exec(line);
      if (declared) job.total = Number(declared[1]);
    }
  }

  function lastLogLines(job: ExportJob, count: number): string {
    const lines = job.log.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.slice(-count).join('; ');
  }

  function cleanupJobFiles(job: ExportJob, removeVideo: boolean): void {
    try {
      fs.rmSync(job.tmpProject, { force: true });
    } catch {
      /* временный файл мог уже удалиться */
    }
    if (removeVideo) {
      try {
        fs.rmSync(job.outFile, { force: true });
      } catch {
        /* частичный файл мог не создаться */
      }
    }
  }

  async function handleExport(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let text: string;
    try {
      text = await readBody(req);
    } catch {
      fail(res, 413, `Тело запроса больше ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} МБ.`);
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      fail(res, 400, `Не удалось разобрать JSON тела запроса: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!isRecord(payload) || !isRecord(payload.project)) {
      fail(res, 400, 'Тело запроса должно быть объектом: {"project": …}.');
      return;
    }
    const project = payload.project;
    const check = validateProject(project, { catalogIds: catalogIds() });
    if (!check.ok) {
      sendJson(res, 200, { ok: false, errors: check.errors.map((e) => ({ path: String(e.path ?? ''), message: String(e.message ?? '') })) });
      return;
    }
    if (runningJob()) {
      sendJson(res, 409, { ok: false, errors: [{ path: '', message: 'Уже собирается другое видео. Дождитесь конца или отмените его.' }] });
      return;
    }
    let jobId = `e${Date.now().toString(36)}`;
    while (jobs.has(jobId)) jobId = `e${Math.floor(Math.random() * 1e6).toString(36)}`;
    const format = project.format === '9:16' ? '9:16' : '16:9';
    const title = typeof project.title === 'string' ? project.title : 'project';
    const tmpProject = path.join(exportTmpDir, `${jobId}.project.json`);
    const outFile = path.join(exportDir, `${safeFileName(title)}_${formatFileToken(format)}_${jobId}.mp4`);
    fs.mkdirSync(exportTmpDir, { recursive: true });
    fs.writeFileSync(tmpProject, JSON.stringify(project, null, 2), 'utf8');
    const job: ExportJob = { id: jobId, state: 'running', frame: 0, total: 0, outFile, tmpProject, log: '', child: null };
    jobs.set(jobId, job);
    // Свой stdin, свои каналы вывода; переменные окружения те же, что у dev-сервера (ffmpeg ищется в PATH).
    const child = spawn(process.execPath, [exportScript, '--project', tmpProject, '--out', outFile], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.child = child;
    child.stdout?.on('data', (chunk: Buffer) => appendLog(job, chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => appendLog(job, chunk.toString('utf8')));
    child.on('error', (error: Error) => {
      if (job.state === 'cancelled') return;
      job.state = 'error';
      job.message = `Экспорт не запущен: ${error.message}`;
      job.child = null;
      cleanupJobFiles(job, true);
    });
    child.on('close', (code) => {
      job.child = null;
      // ffmpeg мог дописать частичный файл после отмены — убираем, когда процесс точно завершился.
      if (job.state === 'cancelled') {
        cleanupJobFiles(job, true);
        return;
      }
      if (code === 0 && fs.existsSync(outFile)) {
        job.state = 'done';
        job.frame = job.total || job.frame;
      } else {
        job.state = 'error';
        job.message = `ffmpeg/export завершились с кодом ${code}. ${lastLogLines(job, 3)}`;
        cleanupJobFiles(job, true);
      }
      cleanupJobFiles(job, false);
    });
    sendJson(res, 200, { ok: true, jobId });
  }

  function jobFromUrl(req: IncomingMessage, res: ServerResponse): ExportJob | null {
    const raw = req.url ?? '';
    const query = raw.slice(raw.indexOf('?') + 1);
    const id = new URLSearchParams(query).get('id') ?? '';
    if (!JOB_ID_RE.test(id)) {
      fail(res, 400, 'Некорректный id задания: его выдаёт сам сервис экспорта.');
      return null;
    }
    const job = jobs.get(id);
    if (!job) {
      fail(res, 404, `Задание «${id}» не найдено: возможно, dev-сервер перезапускался.`);
      return null;
    }
    return job;
  }

  function statusReply(job: ExportJob): ExportStatusReply {
    return {
      ok: true,
      state: job.state,
      frame: job.frame,
      total: job.total,
      file: path.relative(root, job.outFile).split(path.sep).join('/'),
      ...(job.message ? { message: job.message } : {}),
    };
  }

  function handleExportCancel(req: IncomingMessage, res: ServerResponse): void {
    const job = jobFromUrl(req, res);
    if (!job) return;
    if (job.state !== 'running') {
      sendJson(res, 200, { ...statusReply(job), message: `Экспорт уже завершён (состояние «${job.state}»).` });
      return;
    }
    job.state = 'cancelled';
    job.message = 'Экспорт отменён.';
    const child = job.child;
    job.child = null;
    child?.kill();
    cleanupJobFiles(job, true);
    sendJson(res, 200, statusReply(job));
  }

  function handleExportFile(req: IncomingMessage, res: ServerResponse): void {
    const job = jobFromUrl(req, res);
    if (!job) return;
    if (job.state !== 'done' || !fs.existsSync(job.outFile)) {
      fail(res, 404, `Видео ещё не готово (состояние «${job.state}»).`);
      return;
    }
    const name = path.basename(job.outFile);
    res.statusCode = 200;
    res.setHeader('content-type', 'video/mp4');
    res.setHeader('content-length', fs.statSync(job.outFile).size);
    res.setHeader('content-disposition', contentDisposition(name));
    fs.createReadStream(job.outFile).pipe(res);
  }

  async function handleCatalogAdd(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let text: string;
    try {
      text = await readBody(req);
    } catch {
      fail(res, 413, `Тело запроса больше ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} МБ.`);
      return;
    }
    if (!text.trim()) {
      fail(res, 400, 'Пустое тело запроса: нужен JSON вида {"model": …, "overwrite": false}.');
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      fail(res, 400, `Не удалось разобрать JSON тела запроса: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!isRecord(payload)) {
      fail(res, 400, 'Тело запроса должно быть объектом: {"model": …, "overwrite": false}.');
      return;
    }
    const model = payload.model;
    const overwrite = payload.overwrite === true;
    const sourceId = modelSourceId(model);
    if (sourceId && !MODEL_ID_RE.test(sourceId)) {
      sendJson(res, 200, { ok: false, errors: [{ path: 'id', message: `id модели «${sourceId}» недопустим: нужны строчные латинские буквы, цифры, дефис или подчёркивание (например whale-2), без пути и точек.` }] });
      return;
    }
    let result: ReturnType<typeof addToCatalog>;
    try {
      result = runInRoot(root, () => addToCatalog(model, { overwrite }));
    } catch (error) {
      fail(res, 500, `Запись в каталог не удалась: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!result.ok) {
      sendJson(res, 200, { ok: false, errors: result.errors.map((e: ApiIssue) => ({ path: String(e.path ?? ''), message: String(e.message ?? '') })) });
      return;
    }
    if (!MODEL_ID_RE.test(result.id) || !fs.existsSync(path.join(catalogDir, `${result.id}.json`))) {
      fail(res, 500, `Модель записана с недопустимым id «${result.id}».`, 'id');
      return;
    }
    sendJson(res, 200, { ok: true, id: result.id });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const raw = req.url ?? '';
    const queryIndex = raw.indexOf('?');
    const pathname = queryIndex < 0 ? raw : raw.slice(0, queryIndex);
    if (!pathname.startsWith(LOCAL_API_PREFIX)) return false;
    const route = pathname.slice(LOCAL_API_PREFIX.length);
    if (!isAllowedHost(req, options.getPort())) {
      fail(res, 403, 'Сервис доступен только по localhost или 127.0.0.1: заголовок Host не совпал.');
      return true;
    }
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(req)) {
      fail(res, 403, 'Запрос пришёл с другой страницы: проверка Origin не пройдена.');
      return true;
    }
    if (method === 'GET' && route === 'ping') {
      sendJson(res, 200, { ok: true, version: LOCAL_API_VERSION });
      return true;
    }
    if (method === 'POST' && route === 'catalog/add') {
      await handleCatalogAdd(req, res);
      return true;
    }
    if (method === 'POST' && route === 'export') {
      await handleExport(req, res);
      return true;
    }
    if (method === 'GET' && route === 'export/status') {
      const job = jobFromUrl(req, res);
      if (job) sendJson(res, 200, statusReply(job));
      return true;
    }
    if (method === 'POST' && route === 'export/cancel') {
      handleExportCancel(req, res);
      return true;
    }
    if (method === 'GET' && route === 'export/file') {
      handleExportFile(req, res);
      return true;
    }
    const knownRoutes = ['ping', 'catalog/add', 'export', 'export/status', 'export/cancel', 'export/file'];
    if (knownRoutes.includes(route)) {
      fail(res, 405, `Метод ${method} для /${LOCAL_API_PREFIX}${route} не поддерживается.`);
      return true;
    }
    fail(res, 404, `Неизвестный эндпоинт /${LOCAL_API_PREFIX}${route}.`);
    return true;
  }

  /** Дёргает kill() только по сохранённым handle своих дочерних процессов. */
  function close(): void {
    for (const job of jobs.values()) {
      if (job.state !== 'running') continue;
      job.state = 'cancelled';
      job.message = 'Экспорт остановлен вместе с dev-сервером.';
      const child = job.child;
      job.child = null;
      child?.kill();
      cleanupJobFiles(job, true);
    }
  }

  return { handle, close };
}

export function localApiPlugin(): Plugin {
  return {
    name: 'animation-motion-local-api',
    apply: 'serve',
    configureServer(server) {
      const host = server.config.server.host;
      const loopback = host === undefined || host === '' || host === 'localhost' || host === '127.0.0.1';
      if (!loopback) {
        server.config.logger.warn('Локальный сервис /__api/ не зарегистрирован: dev-сервер слушает не только localhost (host = ' + String(host) + ').');
        return;
      }
      let port = Number(server.config.server.port) || 5173;
      const api = createLocalApi({ root: server.config.root, getPort: () => port });
      const syncPort = () => {
        const address = server.httpServer?.address();
        if (address && typeof address === 'object') port = address.port;
      };
      server.httpServer?.on('listening', syncPort);
      server.httpServer?.on('close', () => api.close());
      server.middlewares.use((req, res, next) => {
        api.handle(req, res).then(
          (handled) => { if (!handled) next(); },
          (error: unknown) => fail(res, 500, `Сервис не справился: ${error instanceof Error ? error.message : String(error)}`),
        );
      });
      return () => {
        syncPort();
      };
    },
  };
}
