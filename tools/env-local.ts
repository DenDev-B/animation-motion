// Чтение .env.local: простые строки KEY=VALUE. Ключи читает только локальный сервис, в браузер они не попадают.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MODELS, PROVIDER_ORDER, type ProviderId, type ProviderSpec, type ReasoningEffort } from '../engine/ai-chain.ts';

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

const KEY_NAMES: Record<ProviderId, { key: string; model: string; maxTokens: string }> = {
  gemini: { key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL', maxTokens: 'GEMINI_MAX_TOKENS' },
  groq: { key: 'GROQ_API_KEY', model: 'GROQ_MODEL', maxTokens: 'GROQ_MAX_TOKENS' },
};

/** Целое 1000–65536; мусор и выход за границы — undefined, тогда берётся значение по умолчанию. */
function parseMaxTokens(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= 1000 && value <= 65536 ? value : undefined;
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

/** Одно из low|medium|high; мусор — undefined, тогда берётся значение по умолчанию. */
function parseReasoningEffort(raw: string): ReasoningEffort | undefined {
  return REASONING_EFFORTS.find((effort) => effort === raw);
}

/** Значение НЕ-секретной настройки: сначала .env.local, потом окружение. Пустая строка, если нигде нет. */
export function loadSetting(root: string, name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (readEnvFile(root)[name] ?? env[name] ?? '').trim();
}

function readEnvFile(root: string): Record<string, string> {
  try {
    return parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
  } catch {
    // файла нет: берём только переменные окружения
    return {};
  }
}

/** Список настроенных провайдеров в порядке Gemini → Groq. Файл читается при каждом запросе: правка ключа не требует перезапуска. */
export function loadProviders(root: string, env: NodeJS.ProcessEnv = process.env): ProviderSpec[] {
  const file = readEnvFile(root);
  const pick = (name: string): string => (file[name] ?? env[name] ?? '').trim();
  const list: ProviderSpec[] = [];
  for (const id of PROVIDER_ORDER) {
    const apiKey = pick(KEY_NAMES[id].key);
    if (!apiKey) continue;
    const spec: ProviderSpec = { id, apiKey, model: pick(KEY_NAMES[id].model) || DEFAULT_MODELS[id] };
    const maxTokens = parseMaxTokens(pick(KEY_NAMES[id].maxTokens));
    if (maxTokens !== undefined) spec.maxTokens = maxTokens;
    if (id === 'groq') {
      const reasoningEffort = parseReasoningEffort(pick('GROQ_REASONING_EFFORT'));
      if (reasoningEffort !== undefined) spec.reasoningEffort = reasoningEffort;
    }
    list.push(spec);
  }
  return list;
}
