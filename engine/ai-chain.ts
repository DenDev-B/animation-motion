// Вызов бесплатных ИИ с запасным: Gemini → Groq → сообщение о ручном пути. Без DOM и файлов; fetch приходит параметром.
import { buildFixRequest } from './ai-io.ts';
import type { ValidationError } from './validate.ts';

export type ProviderId = 'gemini' | 'groq';
export const PROVIDER_ORDER: readonly ProviderId[] = ['gemini', 'groq'];
export const PROVIDER_LABELS: Record<ProviderId, string> = { gemini: 'Gemini', groq: 'Groq' };
/** Названия моделей у бесплатных тарифов меняются: по умолчанию стоят эти, а менять их можно в .env.local. */
export const DEFAULT_MODELS: Record<ProviderId, string> = { gemini: 'gemini-2.5-flash', groq: 'llama-3.3-70b-versatile' };

export interface ProviderSpec { id: ProviderId; apiKey: string; model: string }

export type FailKind = 'key' | 'quota' | 'too_large' | 'model' | 'blocked' | 'request' | 'server' | 'network' | 'timeout' | 'empty' | 'truncated' | 'invalid';

export class ProviderError extends Error {
  readonly kind: FailKind;
  constructor(kind: FailKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface Attempt { provider: ProviderId; kind: FailKind | 'ok'; message: string }

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const REQUEST_TIMEOUT_MS = 120_000;
/** У Groq на бесплатном тарифе потолок 6–12 тыс. токенов в минуту, и запрошенный размер ответа в него входит: просим меньше. */
const MAX_TOKENS: Record<ProviderId, number> = { gemini: 16384, groq: 5000 };

const KIND_TEXT: Record<FailKind, string> = {
  key: 'ключ не принят (проверьте ключ в .env.local)',
  quota: 'исчерпан лимит бесплатного тарифа (подождите или используйте другой ИИ)',
  too_large: 'запрос слишком большой для бесплатного тарифа',
  model: 'модель не найдена (задайте актуальную модель в .env.local)',
  blocked: 'ответ заблокирован фильтром провайдера',
  request: 'провайдер отклонил запрос',
  server: 'сервис провайдера временно недоступен',
  network: 'нет связи с провайдером',
  timeout: 'провайдер не ответил вовремя',
  empty: 'провайдер вернул пустой ответ',
  truncated: 'ответ обрезан по длине',
  invalid: 'ответ не прошёл проверку проекта',
};

export function describeKind(kind: FailKind): string {
  return KIND_TEXT[kind];
}

function scrub(text: string, key: string): string {
  let out = key ? text.split(key).join('***') : text;
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

function upstreamMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } | string };
    if (typeof json.error === 'string') return json.error;
    if (json.error && typeof json.error.message === 'string') return json.error.message;
  } catch {
    // не JSON: берём как есть
  }
  return body;
}

/** Переводит HTTP-ответ с ошибкой в понятный вид; тело ответа провайдера обрезается, ключ из текста вырезается. */
export function classifyHttpError(provider: ProviderId, status: number, body: string, apiKey: string): ProviderError {
  const raw = upstreamMessage(body);
  const detail = scrub(raw, apiKey);
  const lower = raw.toLowerCase();
  let kind: FailKind;
  if (status === 401 || status === 403) kind = 'key';
  else if (status === 400 && (lower.includes('api key') || lower.includes('api_key'))) kind = 'key';
  else if (status === 404) kind = 'model';
  else if (status === 413 || (status === 429 && (lower.includes('too large') || lower.includes('tokens per minute') || lower.includes('input token')))) kind = 'too_large';
  else if (status === 429) kind = 'quota';
  else if (status >= 500) kind = 'server';
  else kind = 'request';
  return new ProviderError(kind, `${PROVIDER_LABELS[provider]}: ${KIND_TEXT[kind]}${detail ? ` — ${detail}` : ''} (HTTP ${status})`);
}

function extractGemini(provider: ProviderId, body: string, apiKey: string): string {
  let json: {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown }> } }>;
  };
  try {
    json = JSON.parse(body);
  } catch {
    throw new ProviderError('empty', `${PROVIDER_LABELS[provider]}: ${KIND_TEXT.empty}`);
  }
  if (json.promptFeedback?.blockReason) throw new ProviderError('blocked', `${PROVIDER_LABELS[provider]}: ${KIND_TEXT.blocked} (${scrub(json.promptFeedback.blockReason, apiKey)})`);
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
  if (!text.trim()) {
    const reason = candidate?.finishReason;
    throw new ProviderError(reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' ? 'blocked' : 'empty', `${PROVIDER_LABELS[provider]}: ${reason === 'SAFETY' ? KIND_TEXT.blocked : KIND_TEXT.empty}`);
  }
  if (candidate?.finishReason === 'MAX_TOKENS') throw new ProviderError('truncated', `${PROVIDER_LABELS[provider]}: ${KIND_TEXT.truncated}`);
  return text;
}

function extractGroq(provider: ProviderId, body: string): string {
  let json: { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
  try {
    json = JSON.parse(body);
  } catch {
    throw new ProviderError('empty', `${PROVIDER_LABELS[provider]}: ${KIND_TEXT.empty}`);
  }
  const choice = json.choices?.[0];
  const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  if (!text.trim()) throw new ProviderError('empty', `${PROVIDER_LABELS[provider]}: ${KIND_TEXT.empty}`);
  if (choice?.finish_reason === 'length') throw new ProviderError('truncated', `${PROVIDER_LABELS[provider]}: ${KIND_TEXT.truncated}`);
  return text;
}

/** Один запрос к провайдеру. Ключ уходит только в заголовке; ошибки приходят как ProviderError. */
export async function callProvider(spec: ProviderSpec, prompt: string, fetchFn: FetchFn, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
  const isGemini = spec.id === 'gemini';
  const url = isGemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(spec.model)}:generateContent`
    : 'https://api.groq.com/openai/v1/chat/completions';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (isGemini) headers['x-goog-api-key'] = spec.apiKey;
  else headers.authorization = `Bearer ${spec.apiKey}`;
  const body = isGemini
    ? { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.6, maxOutputTokens: MAX_TOKENS.gemini } }
    : { model: spec.model, messages: [{ role: 'user', content: prompt }], temperature: 0.6, max_tokens: MAX_TOKENS.groq };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Awaited<ReturnType<FetchFn>>;
  let text: string;
  try {
    response = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    text = await response.text();
  } catch (error) {
    const aborted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    throw new ProviderError(aborted ? 'timeout' : 'network', `${PROVIDER_LABELS[spec.id]}: ${KIND_TEXT[aborted ? 'timeout' : 'network']}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw classifyHttpError(spec.id, response.status, text, spec.apiKey);
  return isGemini ? extractGemini(spec.id, text, spec.apiKey) : extractGroq(spec.id, text);
}

export interface CheckResult { ok: boolean; errors: ValidationError[]; /** разобранный JSON для запроса исправления; если не разобрался — исходный текст */ candidate?: unknown }

export interface ChainOptions {
  prompt: string;
  providers: ProviderSpec[];
  call: (spec: ProviderSpec, prompt: string) => Promise<string>;
  check: (text: string) => CheckResult;
  /** Сколько раз просить исправить ошибки проверки у того же провайдера, прежде чем перейти к следующему. */
  maxFixes?: number;
}

export type ChainResult =
  | { ok: true; text: string; provider: ProviderId; attempts: Attempt[] }
  | { ok: false; attempts: Attempt[]; message: string };

export const MANUAL_HINT = 'Скопируйте промт кнопкой «1. Копировать промт», вставьте его в любой браузерный ИИ (ChatGPT, Gemini, Claude) и вставьте ответ в поле ниже.';

export function failureMessage(attempts: readonly Attempt[], noKeys: boolean): string {
  if (noKeys) return `Ключи Gemini и Groq не найдены в .env.local. ${MANUAL_HINT}`;
  const lines = attempts.filter((a) => a.kind !== 'ok').map((a) => `${a.message}`);
  return `Автоматически создать проект не удалось: ${lines.join('; ')}. ${MANUAL_HINT}`;
}

export async function generateWithChain(opts: ChainOptions): Promise<ChainResult> {
  const attempts: Attempt[] = [];
  const maxFixes = opts.maxFixes ?? 2;
  if (opts.providers.length === 0) return { ok: false, attempts, message: failureMessage(attempts, true) };
  for (const spec of opts.providers) {
    try {
      let text = await opts.call(spec, opts.prompt);
      let result = opts.check(text);
      for (let fix = 0; !result.ok && fix < maxFixes; fix++) {
        text = await opts.call(spec, buildFixRequest(result.candidate ?? text, result.errors));
        result = opts.check(text);
      }
      if (result.ok) {
        attempts.push({ provider: spec.id, kind: 'ok', message: `${PROVIDER_LABELS[spec.id]}: готово` });
        return { ok: true, text, provider: spec.id, attempts };
      }
      const first = result.errors[0];
      attempts.push({ provider: spec.id, kind: 'invalid', message: `${PROVIDER_LABELS[spec.id]}: ${KIND_TEXT.invalid}${first ? ` (${first.path || 'корень'}: ${first.message})` : ''}` });
    } catch (error) {
      if (error instanceof ProviderError) attempts.push({ provider: spec.id, kind: error.kind, message: error.message });
      else attempts.push({ provider: spec.id, kind: 'request', message: `${PROVIDER_LABELS[spec.id]}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { ok: false, attempts, message: failureMessage(attempts, false) };
}
