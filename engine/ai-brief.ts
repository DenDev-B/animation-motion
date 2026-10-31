// Промт «идея → ТЗ режиссёра», проверка и извлечение ответа. Чистые функции: без DOM, без файлов.
import { catalogBlock, IDEA_MAX_CHARS, type CatalogEntry } from './ai-project.ts';
import { KIND_NAMES, TRANSITION_DIRS, TRANSITION_TYPES } from './spec.ts';
import { MOTION_PRESETS } from './motion.ts';
import { getStyle, STYLE_PRESETS, styleBlock } from './styles.ts';
import type { ValidationError } from './validate.ts';

export const BRIEF_MAX_CHARS = 8000;

export const BRIEF_SECTIONS = [
  '1. Настроение и референсы',
  '2. Герой и персонажи',
  '3. Формат и стиль',
  '4. Локации',
  '5. Шоты',
  '6. Атмосфера',
  '7. Каталог и недостающее',
] as const;

const SHOT_HEADING_RE = /^###\s*Шот\s+\d+\b/gm;

export interface BriefPromptOptions {
  idea: string;
  format?: '16:9' | '9:16';
  fps?: 24 | 30 | 60;
  /** 2..12, по умолчанию 5. */
  scenes?: number;
  /** 4..20, по умолчанию 8. */
  sceneSeconds?: number;
  tone?: string;
  styleId?: string;
  catalogIndex: readonly CatalogEntry[];
}

const clampInt = (v: number | undefined, lo: number, hi: number, def: number): number => {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, Math.round(v)));
};

const kindList = (): string => KIND_NAMES.filter((k) => k !== 'text' && k !== 'counter').join(', ');

export function buildBriefPrompt(opts: BriefPromptOptions): string {
  const idea = (opts.idea ?? '').trim().slice(0, IDEA_MAX_CHARS);
  if (!idea) throw new Error('Идея пустая: опишите, о чём ролик.');
  const scenes = clampInt(opts.scenes, 2, 12, 5);
  const sec = clampInt(opts.sceneSeconds, 4, 20, 8);
  const format = opts.format ?? '16:9';
  const fps = opts.fps ?? 30;
  const tone = (opts.tone ?? '').trim().slice(0, 200);

  const blocks = [
    'Роль: ты сценарист-режиссёр. По идее ты пишешь ТЗ режиссёра для программы animation-motion: подробный документ, по которому потом соберут JSON ролика. Ты не пишешь JSON и не рисуешь кадры, ты объясняешь, что должно быть в кадре и как это движется.',
    '## Задача',
    `Сделай ролик из ровно ${scenes} сцен(ы), примерно по ${sec} секунд, формат ${format}, fps ${fps}. Одна сцена — один шот. История должна иметь завязку, развитие и финал, а не набор красивых картинок.${tone ? ` Тон и настроение: ${tone}.` : ''}`,
    '## Формат ответа',
    'Ответ: один документ Markdown в одном блоке кода ```markdown ... ```, без текста до и после блока. Внутри строго эта структура (заголовки не меняй):',
    '# ТЗ режиссёра: <название ролика>',
    ...BRIEF_SECTIONS.map((section) => `## ${section}`),
    '### Шот 1',
    'В разделе 5 у каждого шота должен быть ровно такой заголовок: `### Шот 1`, `### Шот 2` и так далее, по порядку. Внутри шота перечисли: длительность в секундах; камеру (медленный наезд, отъезд, сдвиг, редкая тряска); действие; скорость движения; палитру (два hex для неба и один hex-акцент); переход к следующему шоту.',
    '## Что писать в разделах',
    `1. Настроение и референсы: 3–4 ассоциации словами, без названий чужих фильмов, роликов и брендов.`,
    '2. Герой и персонажи: силуэт, 2–3 цвета в hex, размер в метрах, как движется. Главный герой один, остальные только если нужны истории.',
    '3. Формат и стиль: формат, fps, id выбранного стиля (если он задан ниже), зерно и виньетку.',
    `4. Локации: по каждой сцене время суток и фон по слоям от дальнего к ближнему.`,
    `5. Шоты: ровно ${scenes} шот(а), по одному на сцену, с заголовками \`### Шот N\`. В каждом шоте: длительность, камера, действие, скорость движения, два hex для неба и один hex-акцент, переход. Переход выбирай из списка движка: ${TRANSITION_TYPES.join(', ')}; направление для slide и wipe: ${TRANSITION_DIRS.join(', ')}.`,
    `6. Атмосфера: частицы, свет и дымка — только то, что движок умеет сейчас. Доступные kinds: ${kindList()}. Пресеты движения: ${MOTION_PRESETS.join(', ')}. Перечисли их коротко, без параметров, и не обещай туман на силуэтах, объёмные тени или другие эффекты, которых в списке нет.`,
    '7. Каталог и недостающее: какие id из каталога использовать; чего не хватает и что нарисовать через shape, как оно выглядит.',
    '## Жёсткие правила',
    '- Вместо слов «красиво», «ярко», «атмосферно» пиши конкретные цвета в hex и понятные действия.',
    '- Шотов не больше числа сцен и не меньше: один шот = одна сцена, по порядку.',
    '- Никаких противоречивых указаний: если в шоте ночь, то и палитра, и свет ночные.',
    '- У каждой сцены одно главное действие. Не пытайся уместить в шот несколько событий.',
    '- Текст, титры и подписи не планируй: их добавляют позже в видеоредакторе.',
    '- Не придумывай новые kinds, переходы, поля и пресеты движения: только из списков выше.',
    '## Каталог моделей',
    catalogBlock(opts.catalogIndex),
    'Для моделей из каталога используй их id. Если подходящей модели нет, опиши её словами в разделе 7 и укажи, что её нарисуют через kind "shape".',
  ];

  if (opts.styleId) {
    if (!getStyle(opts.styleId)) throw new Error(`Неизвестный стиль "${opts.styleId}". Доступные: ${STYLE_PRESETS.map((p) => p.id).join(', ')}`);
    blocks.push('## Стиль ролика (обязательный)', styleBlock(opts.styleId), `В разделе 3 укажи id стиля «${opts.styleId}», его зерно и виньетку. Палитры шотов держи в характере этого стиля.`);
  }

  blocks.push('## Идея ролика', idea);
  return blocks.filter(Boolean).join('\n\n');
}

/** Достаёт Markdown из блока кода; если блока нет, возвращает весь текст. */
export function extractBrief(text: string): string {
  const source = text ?? '';
  const markdown = /```(?:markdown|md)\s*\r?\n([\s\S]*?)```/i.exec(source);
  if (markdown) return markdown[1].trim();
  const any = /```[a-z]*\s*\r?\n([\s\S]*?)```/i.exec(source);
  if (any) return any[1].trim();
  const open = /```(?:markdown|md)?\s*\r?\n([\s\S]*)$/i.exec(source);
  if (open) return open[1].trim();
  return source.trim();
}

function sectionBody(text: string, index: number): string {
  const heading = BRIEF_SECTIONS[index];
  const start = text.search(new RegExp(`^##\\s*${heading.replace('.', '\\.')}\\s*$`, 'm'));
  if (start < 0) return '';
  const after = text.slice(start);
  const next = after.slice(1).search(/^##\s+\d+\./m);
  return next < 0 ? after : after.slice(0, next + 1);
}

/** Проверка ТЗ перед подстановкой в промт проекта. */
export function validateBrief(text: string, opts: { scenes?: number } = {}): { ok: boolean; errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const source = (text ?? '').trim();
  if (!source) {
    return { ok: false, errors: [{ path: '', message: 'ТЗ пустое: вставьте ответ ИИ целиком, он начинается с блока ```markdown' }], warnings };
  }
  if (source.length > BRIEF_MAX_CHARS) {
    errors.push({ path: '', message: `ТЗ длиннее ${BRIEF_MAX_CHARS} символов (${source.length}). Попросите ИИ сократить текст, оставив все 7 разделов и шоты.` });
  }
  const fences = (source.match(/```/g) ?? []).length;
  if (fences % 2 !== 0) {
    errors.push({ path: '', message: 'Блок кода обрезан: не хватает закрывающего ```. Скопируйте ответ ИИ целиком или попросите «продолжи и верни ТЗ целиком».' });
  }
  if (fences === 0) {
    errors.push({ path: '', message: 'Нет блока кода ```markdown. Попросите ИИ вернуть ТЗ одним блоком ```markdown ... ``` без текста вокруг.' });
  }
  if (/```json/i.test(source)) {
    errors.push({ path: '', message: 'В ТЗ не должно быть блока ```json: это документ Markdown, а не проект. Уберите JSON и оставьте только ТЗ.' });
  }
  for (const section of BRIEF_SECTIONS) {
    if (!new RegExp(`^##\\s*${section.replace('.', '\\.')}\\s*$`, 'm').test(source)) {
      errors.push({ path: section, message: `Нет раздела «## ${section}». Верните ответ ИИ целиком по структуре из промта.` });
    }
  }

  const shotsBody = sectionBody(source, 4);
  const headings = shotsBody.match(SHOT_HEADING_RE) ?? [];
  const shots = headings.length;
  if (opts.scenes !== undefined && shots !== opts.scenes) {
    warnings.push({ path: '## 5. Шоты', message: `Шотов ${shots}, а сцен ${opts.scenes}. Нужно ровно по одному шоту на сцену с заголовками «### Шот N».` });
  }
  if (shots === 0 && shotsBody) {
    warnings.push({ path: '## 5. Шоты', message: 'В разделе 5 не найдено ни одного заголовка «### Шот N». Начните каждый шот с такой строки.' });
  }
  const chunks = shotsBody.split(/^###\s*Шот\s+\d+\b.*$/m).slice(1);
  chunks.forEach((chunk, i) => {
    if (!/#[0-9a-f]{3,8}\b/i.test(chunk)) {
      warnings.push({ path: `## 5. Шоты, шот ${i + 1}`, message: 'В шоте нет ни одного hex-цвета. Добавьте два hex для неба и один hex-акцент.' });
    }
  });
  if (!/#[0-9a-f]{3,8}\b/i.test(source)) {
    warnings.push({ path: '', message: 'В ТЗ нет ни одного hex-цвета. Замените слова «ярко» и «красиво» конкретными цветами, например #f3b98a.' });
  }
  return { ok: errors.length === 0, errors, warnings };
}
