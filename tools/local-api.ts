// Локальный сервис кнопок редактора: регистрируется только в dev-режиме Vite и только на localhost.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { addToCatalog } from '../engine/catalog-add.ts';

export const LOCAL_API_PREFIX = '/__api/';
export const LOCAL_API_VERSION = 1;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** id модели: те же символы, что оставляет slugify в addToCatalog, но без тихой правки. */
const MODEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

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

export interface LocalApiOptions {
  /** Корень проекта: модели пишутся в <root>/catalog. */
  root: string;
  /** Фактический порт dev-сервера — сверяется с заголовком Host. */
  getPort: () => number;
}

export interface LocalApi {
  /** true, если запрос относился к /__api/ и на него уже отвечили. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

class BodyTooLarge extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function sendJson(res: ServerResponse, status: number, reply: ApiReply): void {
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

export function createLocalApi(options: LocalApiOptions): LocalApi {
  const catalogDir = path.join(options.root, 'catalog');

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
      result = runInRoot(options.root, () => addToCatalog(model, { overwrite }));
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
    if (route === 'ping' || route === 'catalog/add') {
      fail(res, 405, `Метод ${method} для /${LOCAL_API_PREFIX}${route} не поддерживается.`);
      return true;
    }
    fail(res, 404, `Неизвестный эндпоинт /${LOCAL_API_PREFIX}${route}.`);
    return true;
  }

  return { handle };
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
