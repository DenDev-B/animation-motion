// Промт «описание → модель каталога» для ИИ. Чистая функция: без файлов, без DOM, без случайности.
import { PALETTE_SLOTS } from './spec.ts';

export interface ModelPromptOptions {
  /** Что нарисовать, например «собака сбоку». */
  description: string;
  view?: 'side' | 'bottom' | 'front' | 'top' | 'three-quarter';
  /** Высота модели в метрах (необязательно, ИИ подберёт правдоподобную). */
  sizeM?: number;
  /** Смотрит ли модель вправо или влево (для вида side). */
  facing?: 'left' | 'right';
}

export const MODEL_PROMPT_MAX_BYTES = 14 * 1024;
export const MODEL_MAX_PARTS = 25;
export const MODEL_MAX_POINTS = 60;

/** Образец модели в промте: нейтральный предмет, не животное из каталога. */
export const MODEL_SAMPLE = {
  version: 1,
  id: 'sample-lamp',
  name: 'Лампа',
  bounds: [-60, -100, 120, 200],
  realSize: { heightM: 0.5 },
  meta: { view: 'front', tags: ['лампа', 'lamp', 'свет'], license: { name: 'own', attribution: false } },
  parts: [
    { id: 'base', name: 'Подставка', fill: '#3a3f45', d: 'M -40 100 L 40 100 L 30 80 L -30 80 Z' },
    { id: 'stem', name: 'Стойка', fill: '#59638f', d: 'M -6 80 L 6 80 L 6 -20 L -6 -20 Z' },
    { id: 'shade', name: 'Абажур', fill: '#ffd27a', d: 'M -55 -20 C -50 -70 -30 -95 0 -100 C 30 -95 50 -70 55 -20 Z' },
    { id: 'bulb', name: 'Лампочка', type: 'circle', cx: 0, cy: -10, r: 10, fill: '#fff6d5' },
  ],
} as const;

export function buildModelPrompt(opts: ModelPromptOptions): string {
  const description = (opts.description ?? '').trim().slice(0, 500);
  if (!description) throw new Error('Описание пустое: напишите, что нарисовать.');
  const view = opts.view ?? 'side';
  const size = opts.sizeM !== undefined && Number.isFinite(opts.sizeM) && opts.sizeM > 0 ? `${opts.sizeM} м` : 'правдоподобная для такого предмета (выбери сам и запиши в метрах)';
  return [
    'Роль: ты художник-векторщик и редактор JSON-моделей для программы animation-motion. Нарисуй одну модель для каталога. Ответ: один JSON-объект модели внутри одного блока кода ```json ... ``` (у блока кода в чате есть кнопка «Копировать») и больше ничего: ни текста до блока, ни после.',
    '## Формат модели',
    `Поля: version (всегда 1), id (латиница в нижнем регистре через дефис, например "dog"), name (название по-русски), bounds [x, y, ширина, высота] (границы всей модели; центр модели в точке (0,0), значит x = -ширина/2, y = -высота/2), realSize {"heightM": число} (реальная высота в метрах), meta {view, facing?, tags, license}, parts (части).`,
    `meta: view = одно из side|bottom|front|top|three-quarter; facing = left|right (куда смотрит модель, для side); tags = массив из 3-6 слов на русском и английском; license = {"name": "own", "attribution": false} (это твой рисунок, лицензия own).`,
    `Часть: {id (уникальный), name (по-русски), fill, d} или с type. fill это hex-цвет (#rgb, #rrggbb) или слот палитры (${PALETTE_SLOTS.join(', ')}) или "none". d это SVG-путь только из команд M L C Q Z. Дополнительно: type "circle" с cx, cy, r вместо d; type "line" для линии (d) с stroke {color, w}; stroke {color, w} для обводки (w > 0).`,
    '## Правила рисования',
    `- Система координат: ось X вправо, ось Y вниз, центр модели в (0,0). Высота модели по Y около 200 единиц (bounds[3] ≈ 200), ширина по пропорциям.`,
    `- Не более ${MODEL_MAX_PARTS} частей и не более ${MODEL_MAX_POINTS} точек в части. Контуры закрывай командой Z.`,
    '- Рисуй узнаваемый силуэт: крупные формы (тело, голова, конечности), затем детали (глаз, окно, колесо). Части в порядке от заднего к переднему.',
    '- Цвета: 3-6 разных оттенков, тёмный контур не обязателен. Не используй градиенты, фильтры, текст.',
    '- bounds должны точно описывать нарисованное: ничего не выходит за них и модель не сильно меньше них.',
    '- Никакой случайности и комментариев в JSON; все числа конечные.',
    '## Образец формата (другой предмет, повторять не надо)',
    '```json\n' + JSON.stringify(MODEL_SAMPLE, null, 2) + '\n```',
    '## Что нарисовать',
    `Описание: ${description}`,
    `Вид: ${view}${opts.facing ? `, смотрит ${opts.facing === 'right' ? 'вправо' : 'влево'}` : ''}`,
    `Реальная высота: ${size}`,
  ].join('\n\n');
}
