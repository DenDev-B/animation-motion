// Чтение .env.local: простые строки KEY=VALUE. Ключи читает только локальный сервис, в браузер они не попадают.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MODELS, PROVIDER_ORDER, type ProviderId, type ProviderSpec } from '../engine/ai-chain.ts';

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

const KEY_NAMES: Record<ProviderId, { key: string; model: string }> = {
  gemini: { key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' },
  groq: { key: 'GROQ_API_KEY', model: 'GROQ_MODEL' },
};

/** Список настроенных провайдеров в порядке Gemini → Groq. Файл читается при каждом запросе: правка ключа не требует перезапуска. */
export function loadProviders(root: string, env: NodeJS.ProcessEnv = process.env): ProviderSpec[] {
  let file: Record<string, string> = {};
  try {
    file = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
  } catch {
    // файла нет: берём только переменные окружения
  }
  const pick = (name: string): string => (file[name] ?? env[name] ?? '').trim();
  const list: ProviderSpec[] = [];
  for (const id of PROVIDER_ORDER) {
    const apiKey = pick(KEY_NAMES[id].key);
    if (!apiKey) continue;
    list.push({ id, apiKey, model: pick(KEY_NAMES[id].model) || DEFAULT_MODELS[id] });
  }
  return list;
}
