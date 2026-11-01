import { col, h2r, rgba } from './color.ts';
import type { CreateCanvas, RenderCache } from './kinds.ts';


/**
 * Световое средство: аддитивный конус (фара, прожектор, луч из окна) или пятно на поверхности (лужа света на дороге).
 * Конус считается один раз по пикселям в спрайт (кэш по параметрам): края сглажены формулой, без размытия и без накопления ошибок округления
 * от десятков слоёв; результат детерминирован и одинаков в браузере и в Node.
 * Конус направлен вправо от точки объекта; направление меняется полем rot объекта.
 */
export function drawLight(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache, createCanvas: CreateCanvas): void {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const color = col((p.color as string | undefined) ?? 'sun', pal);
  const a = Math.min(1, Math.max(0, num(p.a, 0.5)));
  const soft = Math.min(1, Math.max(0, num(p.soft, 0.6)));
  g.globalCompositeOperation = 'lighter';
  if (p.mode === 'pool') {
    const r = Math.max(1, num(p.r, 200));
    const squash = Math.max(0.05, num(p.squash, 0.35));
    g.save();
    g.scale(1, squash);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, rgba(color, a));
    gr.addColorStop(Math.max(0.01, 1 - soft), rgba(color, a * (1 - soft * 0.5)));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, r, 0, 7);
    g.fill();
    g.restore();
  } else {
    const sprite = coneSprite(p, color, a, soft, cache, createCanvas);
    g.drawImage(sprite.canvas, 0, -sprite.halfH, sprite.w, sprite.halfH * 2);
  }
  g.globalCompositeOperation = 'source-over';
}

const smooth = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/** Спрайт конуса: x от 0 (источник) до len, y от -halfH до halfH. Яркость = a · спад по длине · сглаженный край. */
function coneSprite(p: Record<string, unknown>, color: string, a: number, soft: number, cache: RenderCache, createCanvas: CreateCanvas): { canvas: HTMLCanvasElement; w: number; halfH: number } {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const len = Math.max(1, Math.round(num(p.len, 600)));
  const w = Math.max(1, num(p.w, 160));
  const w0 = Math.max(0.5, num(p.w0, 6));
  const halfH = Math.ceil(Math.max(w, w0)) + 2;
  const key = `light:${len}:${w}:${w0}:${a}:${soft}:${color}`;
  const cached = cache.bgCache.get(key) as { canvas: HTMLCanvasElement; w: number; halfH: number } | undefined;
  if (cached) return cached;
  const H = halfH * 2;
  const canvas = createCanvas(len, H);
  const c = canvas.getContext('2d')!;
  const im = c.createImageData(len, H);
  const rgb = h2r(color.startsWith('#') ? color : '#ffffff');
  for (let y = 0; y < H; y++) {
    const dy = Math.abs(y + 0.5 - halfH);
    for (let x = 0; x < len; x++) {
      const t = (x + 0.5) / len;
      const half = w0 + (w - w0) * t;
      const u = dy / half;
      const edge = soft <= 0 ? (u < 1 ? 1 : 0) : 1 - smooth((u - (1 - soft)) / soft);
      const alpha = a * Math.pow(1 - t, 1.4) * edge;
      const i = (y * len + x) * 4;
      im.data[i] = rgb[0]; im.data[i + 1] = rgb[1]; im.data[i + 2] = rgb[2];
      im.data[i + 3] = Math.round(alpha * 255);
    }
  }
  c.putImageData(im, 0, 0);
  const result = { canvas, w: len, halfH };
  cache.bgCache.set(key, result);
  return result;
}
