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
export function col(v: string | undefined, pal: Record<string, unknown>): string {
  if (v === undefined) return '#888888';
  const slot = pal[v];
  return typeof slot === 'string' ? slot : v;
}
