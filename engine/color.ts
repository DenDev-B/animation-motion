import { lerp } from './math.ts';

export function h2r(h: string): [number, number, number] {
  h = String(h).replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export function rgba(h: string, a: number): string {
  const c = h2r(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
export function mixc(a: string, b: string, k: number): string {
  const x = h2r(a);
  const y = h2r(b);
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], k))).join(',')})`;
}
/**
 * Смешение цвета с цветом дымки с сохранением альфы (#rrggbbaa). Для не-hex значений и k<=0 возвращает цвет без изменений.
 */
export function hazeMix(color: string, haze: string, k: number): string {
  if (!(k > 0) || !/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(color)) return color;
  const body = color.slice(1);
  const alpha = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
  const m = mixc(color, haze, Math.min(1, k));
  return alpha >= 1 ? m : m.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
}
export function col(v: string | undefined, pal: Record<string, unknown>): string {
  if (v === undefined) return '#888888';
  const slot = pal[v];
  return typeof slot === 'string' ? slot : v;
}
