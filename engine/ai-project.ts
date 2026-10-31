// Промт «идея → проект из нескольких сцен» и проверка ответа ИИ. Чистые функции: без файлов, без DOM, без случайности.
import { ANIM_SPEC, KIND_SPEC, PALETTE_SLOTS, TRANSITION_DIRS, TRANSITION_TYPES, type FieldSpec } from './spec.ts';
import { MOTION_PRESETS } from './motion.ts';
import { validateProject, type ProjectV1 } from './project.ts';
import type { ValidateOpts, ValidationError } from './validate.ts';
import { BRIEF_MAX_CHARS } from './ai-brief.ts';
import { getStyle, STYLE_PRESETS, styleBlock } from './styles.ts';

export interface CatalogEntry {
  id: string;
  name: string;
  tags?: string[];
  view?: string;
  realSize?: { heightM?: number; widthM?: number };
  /** Формат каталога [x, y, ширина, высота]; нужен, чтобы вычислить высоту в метрах, если задана только ширина. */
  bounds?: readonly number[];
  license?: string;
}

export interface ProjectPromptOptions {
  idea: string;
  format?: '16:9' | '9:16';
  fps?: 24 | 30 | 60;
  /** 2..12, по умолчанию 5. */
  scenes?: number;
  /** 4..20, по умолчанию 8. */
  sceneSeconds?: number;
  tone?: string;
  /** Готовое ТЗ режиссёра (Markdown после extractBrief), не длиннее BRIEF_MAX_CHARS. */
  brief?: string;
  /** id пресета из engine/styles.ts. */
  styleId?: string;
  catalogIndex: readonly CatalogEntry[];
}

/** Текст и счётчики ИИ не генерирует: автор добавляет титры в видеоредакторе (например CapCut). */
export const NO_TEXT_KINDS: readonly string[] = ['text', 'counter'];

export const PROJECT_PROMPT_MAX_BYTES = 28 * 1024;
export const IDEA_MAX_CHARS = 2000;

const clampInt = (v: number | undefined, lo: number, hi: number, def: number): number => {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, Math.round(v)));
};

const fieldLine = (f: FieldSpec): string => {
  let r = '';
  if (f.values) r = `{${f.values.join('|')}}`;
  else if (f.min !== undefined || f.max !== undefined) r = `${f.exclusiveMin ? '>' : ''}${f.min ?? ''}..${f.max ?? ''}`;
  const def = f.default === undefined ? '' : `=${JSON.stringify(f.default)}`;
  return `${f.name}:${f.type}${r}${def}`;
};

/** Высота модели в метрах: heightM, иначе из widthM и пропорций bounds. */
export function modelHeightM(e: CatalogEntry): number | undefined {
  const rs = e.realSize;
  if (rs?.heightM !== undefined) return rs.heightM;
  if (rs?.widthM !== undefined && e.bounds && e.bounds[2] > 0 && e.bounds[3] > 0) return Math.round((rs.widthM * e.bounds[3] / e.bounds[2]) * 100) / 100;
  return undefined;
}

export function catalogBlock(index: readonly CatalogEntry[]): string {
  if (index.length === 0) return '(каталог пуст: все объекты рисуй через kind "shape" и предложи их в meta.suggestions)';
  return index.map((e) => {
    const h = modelHeightM(e);
    const w = e.realSize?.widthM !== undefined ? Math.round(e.realSize.widthM * 100) / 100 : undefined;
    return `- ${e.id}: ${e.name}; вид: ${e.view ?? '?'}; высота ${h !== undefined ? `${Math.round(h * 100) / 100} м` : 'неизвестна'}${w !== undefined ? `, ширина ${w} м` : ''}; теги: ${(e.tags ?? []).join(', ')}`;
  }).join('\n');
}

export function buildProjectPrompt(opts: ProjectPromptOptions): string {
  const idea = (opts.idea ?? '').trim().slice(0, IDEA_MAX_CHARS);
  if (!idea) throw new Error('Идея пустая: опишите, о чём ролик.');
  const scenes = clampInt(opts.scenes, 2, 12, 5);
  const sec = clampInt(opts.sceneSeconds, 4, 20, 8);
  const format = opts.format ?? '16:9';
  const fps = opts.fps ?? 30;
  const portrait = format === '9:16';

  const brief = (opts.brief ?? '').trim();
  if (brief.length > BRIEF_MAX_CHARS) throw new Error(`ТЗ длиннее ${BRIEF_MAX_CHARS} символов (${brief.length}): сократите текст до вставки в промт.`);
  if (opts.styleId && !getStyle(opts.styleId)) throw new Error(`Неизвестный стиль "${opts.styleId}". Доступные: ${STYLE_PRESETS.map((p) => p.id).join(', ')}`);
  const briefSection = brief
    ? ['## ТЗ режиссёра (следуй ему)', brief, 'Правила: один шот = одна сцена по порядку; палитра из hex шота; длительность, камера, переход — из шота; при нехватке kind бери ближайший.']
    : [];
  const style = opts.styleId ? getStyle(opts.styleId)! : undefined;
  const styleSection = style
    ? ['## Стиль ролика', styleBlock(style.id), `В каждой сцене: style.preset = "${style.id}", style.grain = ${style.grain}, style.vignette = ${style.vignette}; палитры — в характере стиля.`]
    : [];

  const kinds = Object.entries(KIND_SPEC).filter(([k]) => !NO_TEXT_KINDS.includes(k)).map(([k, s]) => `- ${k}: ${s.description} ${s.params.length ? `Параметры: ${s.params.map(fieldLine).join('; ')}.` : 'Параметров нет.'}`).join('\n');
  const anims = Object.entries(ANIM_SPEC).map(([t, f]) => `- ${t}: ${f.map(fieldLine).join('; ')}`).join('\n');

  const text = [
    'Роль: ты сценарист-режиссёр и редактор JSON-проектов для программы animation-motion. По идее ты делаешь короткий ролик из нескольких сцен, которые вместе рассказывают одну историю (завязка, развитие, финал). Весь ответ: один полный JSON-объект проекта внутри одного блока кода ```json ... ``` (в чате у блока кода есть кнопка «Копировать»), без пояснений и без комментариев в JSON.',
    '## Что нужно сделать',
    `Проект: version 1, title на русском, fps ${fps}, format "${format}", ровно ${scenes} сцен(ы) по ~${sec} секунд (допустимо 4..20, сумма по смыслу истории). У каждой сцены: id ("s1", "s2"...), name на русском, scene (полная сцена формата v1) и transition (у первой сцены {"type":"cut"}).`,
    tone(opts.tone),
    '## Формат сцены v1',
    `Сцена: version 1, title, duration (сек, >0), palette, style {grain 0.03..0.10 (по умолчанию 0.06; больше выглядит грязно), vignette 0.1..0.4}, world {unitsPerMeter}, camera {verticalFit, keys:[{t,x,y,zoom>0}], shake?}, assets {} (оставь пустым), layers (от дальнего к ближнему).`,
    `palette: sky (массив минимум из 2 hex-цветов, градиент сверху вниз) и необязательные слоты-цвета: ${PALETTE_SLOTS.filter((s) => s !== 'sky').join(', ')}. Цвета только hex (#rgb, #rrggbb, #rrggbbaa) или имя слота. Для каждой сцены своя палитра по настроению (рассвет, день, закат, ночь, туман...), но всё в одной стилистике.`,
    `Слой: {id, name, depth (параллакс: 0 фон, 1 действие, >1 передний план), visible: true, objects}. Объект: {id, name, kind, x, y, s (масштаб >0), rot (градусы), alpha 0..1, color?, asset?, params?, anim?}. Все id уникальны во всём проекте (добавляй номер сцены: "s2-cloud-1").`,
    `Координаты: единицы виртуального кадра высотой 1000, центр (0,0), ось Y вниз. ${portrait ? 'Формат вертикальный: видимая ширина примерно ±280, ключевые объекты держи в x от -250 до 250, камеру приближай осторожно.' : 'Формат горизонтальный: видно примерно x от -890 до 890, y от -500 до 500.'}`,
    '## Виды объектов (kind) и параметры',
    kinds,
    '## Анимации объекта (anim — массив)',
    anims,
    'ВАЖНО про anim move: from и to это СМЕЩЕНИЯ от позиции объекта (x, y), а не абсолютные координаты. Объект стоит в (x, y), а анимация добавляет к ним смещение. Чтобы машина проехала слева направо по дороге на y=280: поставь x: 0, y: 280 и anim {"type":"move","from":[-420,0],"to":[420,0],"t0":0,"t1":8}. Если поставить x: -420 и from [-420,280], объект улетит за кадр.',
    `В anim swing amp — угол в радианах, по модулю не больше 0.6. Деревья, людей и животных оживляй через params.motion (${MOTION_PRESETS.join('|')}), а не swing на целом asset.`,
    `Пресет движения для asset и shape: params.motion = {preset: ${MOTION_PRESETS.join('|')}, speed 0.2..4, amp 0..3, phase 0..1, dir -1|1} или массив таких. Пресет «оживляет» тело на месте (шаг, взмах, плавание); перемещение по сцене задавай отдельно anim move.`,
    `Камера: verticalFit всегда 0.52 (не меняй, это масштаб для вертикального кадра), keys по времени, например [{"t":0,"x":-60,"y":0,"zoom":1},{"t":${sec},"x":60,"y":-10,"zoom":1.2}]. В каждой сцене лёгкое движение камеры (медленный наезд или сдвиг); тряску shake используй только для ударов и взрывов.`,
    `Переходы transition между сценами: type ${TRANSITION_TYPES.join('|')}; duration в секундах (не больше половины меньшей из двух соседних сцен), dir ${TRANSITION_DIRS.join('|')} для slide/wipe, color hex для dip. Чередуй переходы по смыслу (crossfade для плавной смены, dip для смены времени, slide/wipe для динамики).`,
    '## Масштаб в метрах',
    'Задай в каждой сцене world.unitsPerMeter (типично 16 для городской сцены; меньше число значит крупный план, больше значит дальний). Для объектов kind asset укажи params.sizeM: ВЫСОТА модели в метрах (не ширина). Размеры берутся из списка каталога ниже; тогда объекты получаются в правильных пропорциях друг к другу.',
    '## Модели каталога (используй только эти id в asset)',
    catalogBlock(opts.catalogIndex),
    'Для kind "asset" пиши "asset": "<id из списка>". Выбирай вид модели под сцену (side для движения вбок).',
    '## Если нужной модели нет в каталоге',
    'Нарисуй её сам через kind "shape": params.model = {"bounds":[x,y,w,h],"parts":[{"id":"body","name":"Тело","fill":"#hex","d":"M 0 0 C ... Z"}]}. bounds в формате [x, y, ширина, высота] с центром модели в (0,0), модель высотой около 200 единиц; d это SVG-путь (команды M L C Q Z), 1..10 частей, простые узнаваемые силуэты; цвета только hex. Типы частей: path (по умолчанию), circle (cx, cy, r), line. Для shape sizeM не используется: размер задай полем s.',
    'Каждую такую модель добавь в meta проекта: "meta": {"suggestions": [{"id": "dog", "description": "что это за модель", "view": "side", "sizeM": 0.6}]} (id латиницей через дефис). Если всё есть в каталоге, meta не нужен.',
    '## Жёсткие правила',
    '- Ответ: один блок кода ```json с JSON проекта (один объект) и больше ничего: ни текста до блока, ни после, ни нескольких блоков. Если ответ длинный, не сокращай и не пиши «...»: JSON должен быть полным.',
    '- В каждой сцене: kind "sky" (фон), фон по смыслу (mountains, hills, skyline, cloud, stars, rain, snow), 1..3 смысловых объекта, лёгкое движение камеры. Не перегружай: до 25 объектов в сцене.',
    '- Не создавай объекты kind "text" и "counter": титры и подписи автор добавит позже в видеоредакторе. Смысл сцены передавай картинкой, объектами и движением.',
    '- Никакой случайности: геометрия задаётся seed (целое число), анимации только из списка выше.',
    '- Все числа конечные и в допустимых диапазонах; id сцен, слоёв и объектов уникальны во всём проекте.',
    '- Не придумывай kind, поля, переходы и id моделей, которых нет в справочнике выше.',
    ...briefSection,
    ...styleSection,
    '## Идея ролика',
    idea,
  ].filter(Boolean).join('\n\n');
  return text;
}

function tone(t: string | undefined): string {
  const v = (t ?? '').trim().slice(0, 200);
  return v ? `Тон и настроение: ${v}.` : '';
}

// ---------- проверка ответа ----------

export interface Suggestion { id: string; description: string; view?: string; sizeM?: number }

export interface ProjectReplyResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  suggestions: Suggestion[];
}

const SUGGESTION_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

const SWING_AMP_LIMIT = 0.6;
const SWING_AMP_MESSAGE = 'swing.amp измеряется в радианах (допустимо до 0.6). Для покачивания дерева/человека используй params.motion: sway';

/** Любой список anim в объекте: сам anim, partAnim по частям и части моделей внутри сцены. */
function checkAnimList(list: unknown, path: string, errors: ValidationError[]): void {
  if (!Array.isArray(list)) return;
  list.forEach((a, ai) => {
    if (!a || typeof a !== 'object') return;
    const m = a as Record<string, unknown>;
    if (m.type === 'swing' && typeof m.amp === 'number' && Number.isFinite(m.amp) && Math.abs(m.amp) > SWING_AMP_LIMIT) {
      errors.push({ path: `${path}[${ai}].amp`, message: SWING_AMP_MESSAGE });
    }
  });
}

/** Типичные ошибки ИИ, которые валидатор схемы пропускает: абсолютные координаты в move, странный verticalFit и amp у swing. */
function checkSceneSanity(json: unknown, errors: ValidationError[]): void {
  const scenes = json && typeof json === 'object' ? (json as Record<string, unknown>).scenes : undefined;
  if (!Array.isArray(scenes)) return;
  scenes.forEach((entry, si) => {
    const scene = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).scene as Record<string, unknown> | undefined : undefined;
    if (!scene || typeof scene !== 'object') return;
    const cam = scene.camera as Record<string, unknown> | undefined;
    if (cam && typeof cam.verticalFit === 'number' && (cam.verticalFit < 0.2 || cam.verticalFit > 1.2)) {
      errors.push({ path: `scenes[${si}].scene.camera.verticalFit`, message: `verticalFit должен быть от 0.2 до 1.2 (обычно 0.52), получено ${cam.verticalFit}; пример: 0.52` });
    }
    const assets = scene.assets;
    if (assets && typeof assets === 'object' && !Array.isArray(assets)) {
      for (const [assetId, rawAsset] of Object.entries(assets as Record<string, unknown>)) {
        const asset = rawAsset && typeof rawAsset === 'object' ? rawAsset as Record<string, unknown> : undefined;
        const parts = asset && Array.isArray(asset.parts) ? asset.parts : [];
        parts.forEach((part, pi) => {
          if (!part || typeof part !== 'object') return;
          checkAnimList((part as Record<string, unknown>).anim, `scenes[${si}].scene.assets.${assetId}.parts[${pi}].anim`, errors);
        });
      }
    }
    const layers = Array.isArray(scene.layers) ? scene.layers : [];
    layers.forEach((layer, li) => {
      const objects = layer && typeof layer === 'object' && Array.isArray((layer as Record<string, unknown>).objects) ? (layer as { objects: unknown[] }).objects : [];
      objects.forEach((o, oi) => {
        if (!o || typeof o !== 'object') return;
        const obj = o as Record<string, unknown>;
        const objectPath = `scenes[${si}].scene.layers[${li}].objects[${oi}]`;
        if (typeof obj.kind === 'string' && NO_TEXT_KINDS.includes(obj.kind)) {
          errors.push({ path: `${objectPath}.kind`, message: `объекты kind "${obj.kind}" не нужны: титры добавляются позже в видеоредакторе; удали этот объект (и пустой слой, если в нём больше ничего нет)` });
        }
        const x = typeof obj.x === 'number' ? obj.x : 0;
        const y = typeof obj.y === 'number' ? obj.y : 0;
        checkAnimList(obj.anim, `${objectPath}.anim`, errors);
        if (obj.partAnim && typeof obj.partAnim === 'object' && !Array.isArray(obj.partAnim)) {
          for (const [partId, list] of Object.entries(obj.partAnim as Record<string, unknown>)) {
            checkAnimList(list, `${objectPath}.partAnim.${partId}`, errors);
          }
        }
        if (!Array.isArray(obj.anim)) return;
        obj.anim.forEach((a, ai) => {
          if (!a || typeof a !== 'object') return;
          const m = a as Record<string, unknown>;
          if (m.type !== 'move' || !Array.isArray(m.from) || m.from.length !== 2) return;
          const fx = m.from[0], fy = m.from[1];
          if ((x !== 0 || y !== 0) && typeof fx === 'number' && typeof fy === 'number' && Math.abs(fx - x) < 1 && Math.abs(fy - y) < 1) {
            errors.push({ path: `${objectPath}.anim[${ai}].from`, message: 'move.from и move.to это смещения от x,y объекта, а не абсолютные координаты (здесь from равен самой позиции объекта, и объект улетит за кадр); поставь x и y в точку покоя, а from/to задай смещениями, например from [-400,0], to [400,0]' });
          }
        });
      });
    });
  });
}

/** Проверка ответа ИИ: валидатор проекта плюс необязательное поле meta.suggestions. */
export function validateProjectReply(json: unknown, opts: ValidateOpts = {}): ProjectReplyResult {
  const base = validateProject(json, opts);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  const suggestions: Suggestion[] = [];
  checkSceneSanity(json, errors);
  const meta = json && typeof json === 'object' ? (json as Record<string, unknown>).meta : undefined;
  if (meta !== undefined) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) errors.push({ path: 'meta', message: 'meta должен быть объектом; пример: {"suggestions":[{"id":"dog","description":"собака сбоку"}]}' });
    else {
      const list = (meta as Record<string, unknown>).suggestions;
      if (list !== undefined) {
        if (!Array.isArray(list)) errors.push({ path: 'meta.suggestions', message: 'suggestions должен быть массивом; пример: [{"id":"dog","description":"собака сбоку"}]' });
        else list.forEach((raw, i) => {
          const p = `meta.suggestions[${i}]`;
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push({ path: p, message: 'элемент должен быть объектом {id, description}' }); return; }
          const s = raw as Record<string, unknown>;
          if (typeof s.id !== 'string' || !SUGGESTION_ID_RE.test(s.id)) errors.push({ path: `${p}.id`, message: 'id должен быть латиницей в нижнем регистре через дефис; пример: dog' });
          if (typeof s.description !== 'string' || !s.description.trim()) errors.push({ path: `${p}.description`, message: 'description должен быть непустой строкой; пример: собака сбоку' });
          if (s.view !== undefined && !['side', 'bottom', 'front', 'top', 'three-quarter'].includes(String(s.view))) errors.push({ path: `${p}.view`, message: 'view должен быть side|bottom|front|top|three-quarter' });
          if (s.sizeM !== undefined && (typeof s.sizeM !== 'number' || !Number.isFinite(s.sizeM) || s.sizeM <= 0)) errors.push({ path: `${p}.sizeM`, message: 'sizeM должен быть числом больше нуля; пример: 0.6' });
          if (typeof s.id === 'string' && typeof s.description === 'string') {
            if ((opts.catalogIds ?? []).includes(s.id)) warnings.push({ path: `${p}.id`, message: `модель "${s.id}" уже есть в каталоге; предложение лишнее` });
            suggestions.push({ id: s.id, description: s.description, view: s.view as string | undefined, sizeM: s.sizeM as number | undefined });
          }
        });
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, suggestions };
}

/** Уникальное имя файла проекта: slug, затем slug_2, slug_3 ... Без двоеточий и пробелов (Windows). */
export function uniqueProjectSlug(title: string, taken: ReadonlySet<string>): string {
  const base = (title.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'project';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  throw new Error('Не удалось подобрать имя проекта');
}

export function formatSuggestions(list: readonly Suggestion[]): string {
  if (list.length === 0) return '';
  return ['Предложено добавить в каталог:', ...list.map((s) => `- ${s.id}: ${s.description}${s.view ? ` (вид: ${s.view})` : ''}${s.sizeM ? `, ~${s.sizeM} м` : ''}`)].join('\n');
}

export type { ProjectV1 };
