import { ANIM_SPEC, KIND_SPEC, SCENE_SPEC } from './spec.ts';
import type { ValidationError } from './validate.ts';

export interface PromptOptions { task?: string; scope?: string; }

function describeFields(fields: readonly { name: string; type: string; min?: number; max?: number; default?: unknown; values?: readonly string[]; description: string }[]): string {
  return fields.map((field) => {
    const range = field.values ? ` (${field.values.join('|')})` : field.min !== undefined || field.max !== undefined ? ` (${field.min ?? '−∞'}..${field.max ?? '∞'})` : '';
    const fallback = field.default === undefined ? '' : `, по умолчанию ${JSON.stringify(field.default)}`;
    return `- ${field.name}: ${field.type}${range}${fallback} — ${field.description}`;
  }).join('\n');
}

export function buildPrompt(json: unknown, options: PromptOptions = {}): string {
  const kinds = Object.entries(KIND_SPEC).map(([kind, spec]) => `### ${kind}\n${spec.description}\n${describeFields(spec.params) || '- Параметров нет.'}`).join('\n\n');
  const animations = Object.entries(ANIM_SPEC).map(([type, fields]) => `- ${type}: ${fields.map((field) => `${field.name}${field.values ? ` (${field.values.join('|')})` : ''}`).join(', ')}`).join('\n');
  const sceneFields = describeFields(SCENE_SPEC.fields);
  return [
    'Роль: ты редактор JSON-сцен для animation-motion. Верни только один полный JSON-объект без Markdown и пояснений.',
    options.scope ? `Область редактирования: ${options.scope}.` : '',
    'Краткий справочник формата сцены v1:',
    sceneFields,
    'Объекты и их параметры:',
    kinds,
    'Анимации:',
    animations,
    'Жёсткие правила:',
    '- Не меняй version, не меняй и не дублируй существующие id.',
    '- Не добавляй комментарии; цвета задавай только hex (#rgb, #rrggbb, #rrggbbaa) или существующим слотом палитры.',
    '- Все числа должны быть конечными и находиться в допустимых диапазонах.',
    '- Анимации детерминированы; случайность разрешена только через seed.',
    '- Не добавляй неизвестные kind и сохраняй поля, которые не просили менять.',
    'Текущий JSON:',
    JSON.stringify(json, null, 2),
    `Задача: ${options.task ?? ''}`,
  ].filter(Boolean).join('\n\n');
}

function errorPosition(message: string, source: string): number {
  const match = message.match(/position\s+(\d+)/i);
  return match ? Math.min(Number(match[1]), source.length) : source.length;
}

function positionLabel(source: string, offset: number): string {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return `строка ${line}, столбец ${column}`;
}

export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Не найден JSON-объект в ответе ИИ.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { end = index + 1; break; }
  }
  const candidate = text.slice(start, end < 0 ? text.length : end);
  try {
    return JSON.parse(candidate) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const offset = errorPosition(message, candidate);
    const truncated = end < 0 || /unexpected end|end of json/i.test(message);
    throw new Error(`Ошибка разбора JSON (${positionLabel(candidate, offset)}): ${message}${truncated ? '; похоже, ответ обрезан' : ''}`);
  }
}

export function buildFixRequest(json: unknown, errors: readonly ValidationError[]): string {
  const source = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  const list = errors.map(({ path, message }) => `- ${path || '(корень)'}: ${message}`).join('\n');
  return [
    'Исправь перечисленные ошибки и верни ТОЛЬКО полный JSON целиком, без Markdown и пояснений.',
    'Не меняй version и не изменяй поля, не связанные с ошибками.',
    'Ошибки:',
    list || '- Ошибки не указаны.',
    'Исходный JSON:',
    source,
  ].join('\n\n');
}
