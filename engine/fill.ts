import type { Gradient } from './schema.ts';
import { col } from './color.ts';

/** Допустимое число остановок градиента (защита от раздутых файлов). */
export const GRADIENT_MAX_STOPS = 12;

export function isGradient(value: unknown): value is Gradient {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Градиент в координатах части (те же единицы, что у пути d; смещение part.off уже применено).
 * Цвета остановок: hex (#rgb, #rrggbb, #rrggbbaa) или слот палитры. Чистая функция от значений, без случайности.
 */
export function makeGradient(g: CanvasRenderingContext2D, fill: Gradient, pal: Record<string, unknown>): CanvasGradient {
  const gr = fill.type === 'radial'
    ? g.createRadialGradient(fill.c[0], fill.c[1], 0, fill.c[0], fill.c[1], fill.r)
    : g.createLinearGradient(fill.from[0], fill.from[1], fill.to[0], fill.to[1]);
  for (const [offset, color] of fill.stops) gr.addColorStop(Math.min(1, Math.max(0, offset)), col(color, pal));
  return gr;
}

/** Цвет первой остановки: для предпросмотров и подсчёта яркости, где градиент не нужен. */
export function gradientFirstColor(fill: Gradient, pal: Record<string, unknown>): string {
  return col(fill.stops[0]?.[1], pal);
}

export interface FillIssue { path: string; message: string; }

/** Проверка градиентной заливки. isColorOrSlot приходит из validate.ts, чтобы не дублировать правила цвета. */
export function validateGradient(value: unknown, path: string, isColorOrSlot: (v: unknown) => boolean): FillIssue[] {
  const issues: FillIssue[] = [];
  const add = (p: string, message: string) => issues.push({ path: p, message });
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(num);
  if (!isGradient(value)) { add(path, 'градиент должен быть объектом; пример: {"type":"linear","from":[0,-50],"to":[0,50],"stops":[[0,"#fff"],[1,"#000"]]}'); return issues; }
  const raw = value as unknown as Record<string, unknown>;
  if (raw.type === 'linear') {
    if (!pair(raw.from)) add(`${path}.from`, 'from должен быть массивом из 2 чисел; пример: [0, -50]');
    if (!pair(raw.to)) add(`${path}.to`, 'to должен быть массивом из 2 чисел; пример: [0, 50]');
    if (pair(raw.from) && pair(raw.to) && raw.from[0] === raw.to[0] && raw.from[1] === raw.to[1]) add(`${path}.to`, 'to не должен совпадать с from');
  } else if (raw.type === 'radial') {
    if (!pair(raw.c)) add(`${path}.c`, 'c (центр) должен быть массивом из 2 чисел; пример: [0, 0]');
    if (!num(raw.r) || raw.r <= 0) add(`${path}.r`, 'r должен быть числом больше нуля; пример: 80');
  } else add(`${path}.type`, 'type градиента должен быть linear или radial; пример: linear');
  const stops = raw.stops;
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > GRADIENT_MAX_STOPS) add(`${path}.stops`, `stops должен быть массивом из 2..${GRADIENT_MAX_STOPS} остановок [смещение, цвет]; пример: [[0,"#fff"],[1,"#000"]]`);
  else {
    let previous = 0;
    stops.forEach((stop, index) => {
      const at = `${path}.stops[${index}]`;
      if (!Array.isArray(stop) || stop.length !== 2) { add(at, 'остановка должна быть парой [смещение 0..1, цвет]; пример: [0.5, "#888"]'); return; }
      if (!num(stop[0]) || stop[0] < 0 || stop[0] > 1) add(`${at}[0]`, 'смещение должно быть числом 0..1');
      else { if (stop[0] < previous) add(`${at}[0]`, 'смещения должны не убывать'); previous = stop[0]; }
      if (!isColorOrSlot(stop[1])) add(`${at}[1]`, 'цвет остановки должен быть hex или слотом палитры; пример: #ff8800');
    });
  }
  for (const key of Object.keys(raw)) if (!['type', 'from', 'to', 'c', 'r', 'stops'].includes(key)) add(`${path}.${key}`, 'неизвестное поле градиента');
  return issues;
}
