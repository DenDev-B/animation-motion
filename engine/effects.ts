// Эффекты кадра для scene.style: цветокоррекция и свечение. Чистые функции от пикселей кадра, без случайности.
import { h2r } from './color.ts';
import type { CreateCanvas, RenderCache } from './kinds.ts';
import type { Grade, Bloom } from './schema.ts';

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Цветокоррекция: насыщенность → контраст → яркость → подмешивание оттенка. Меняет пиксели кадра на месте. */
export function applyGrade(g: CanvasRenderingContext2D, W: number, H: number, grade: Grade, pal: Record<string, unknown>): void {
  const saturation = grade.saturation ?? 1;
  const contrast = grade.contrast ?? 1;
  const brightness = (grade.brightness ?? 0) * 255;
  const tintAmount = grade.tint ? Math.min(1, Math.max(0, grade.tintAmount ?? 0.1)) : 0;
  if (saturation === 1 && contrast === 1 && brightness === 0 && tintAmount === 0) return;
  let tint: [number, number, number] = [0, 0, 0];
  if (tintAmount > 0) {
    const raw = grade.tint as string;
    const slot = pal[raw];
    tint = h2r(typeof slot === 'string' ? slot : raw);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const image = g.getImageData(0, 0, W, H);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gr = d[i + 1], b = d[i + 2];
    if (saturation !== 1) {
      const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      r = lum + (r - lum) * saturation; gr = lum + (gr - lum) * saturation; b = lum + (b - lum) * saturation;
    }
    if (contrast !== 1) { r = (r - 127.5) * contrast + 127.5; gr = (gr - 127.5) * contrast + 127.5; b = (b - 127.5) * contrast + 127.5; }
    if (brightness !== 0) { r += brightness; gr += brightness; b += brightness; }
    if (tintAmount > 0) { r += (tint[0] - r) * tintAmount; gr += (tint[1] - gr) * tintAmount; b += (tint[2] - b) * tintAmount; }
    d[i] = clamp255(r); d[i + 1] = clamp255(gr); d[i + 2] = clamp255(b);
  }
  g.putImageData(image, 0, 0);
}

/** Размытие прямоугольным окном по строкам и столбцам, два прохода (≈ гауссово), на Float32 по каналам. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): void {
  const tmp = new Float32Array(src.length);
  const size = radius * 2 + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let x = -radius; x <= radius; x++) sum += src[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 4 + c] = sum / size;
          sum += src[(y * w + Math.min(w - 1, x + radius + 1)) * 4 + c] - src[(y * w + Math.max(0, x - radius)) * 4 + c];
        }
      }
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = -radius; y <= radius; y++) sum += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c];
        for (let y = 0; y < h; y++) {
          src[(y * w + x) * 4 + c] = sum / size;
          sum += tmp[(Math.min(h - 1, y + radius + 1) * w + x) * 4 + c] - tmp[(Math.max(0, y - radius) * w + x) * 4 + c];
        }
      }
    }
  }
}

/** Свечение: яркие места кадра в уменьшенной копии размываются и добавляются обратно (additive). Радиус задаётся в пикселях кадра высотой 1000. */
export function applyBloom(g: CanvasRenderingContext2D, W: number, H: number, bloom: Bloom, cache: RenderCache, createCanvas: CreateCanvas): void {
  const strength = Math.min(1, Math.max(0, bloom.strength ?? 0.5));
  if (strength <= 0) return;
  const threshold = Math.min(0.99, Math.max(0, bloom.threshold ?? 0.7));
  const scale = 4;
  const w = Math.max(2, Math.round(W / scale));
  const h = Math.max(2, Math.round(H / scale));
  const radius = Math.max(1, Math.round(((bloom.radius ?? 16) * (H / 1000)) / scale));
  const key = `bloom:${w}x${h}`;
  let small = cache.bgCache.get(key) as HTMLCanvasElement | undefined;
  if (!small) { small = createCanvas(w, h); cache.bgCache.set(key, small); }
  const sg = small.getContext('2d')!;
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'copy';
  sg.globalAlpha = 1;
  sg.drawImage((g as unknown as { canvas: CanvasImageSource }).canvas, 0, 0, w, h);
  sg.globalCompositeOperation = 'source-over';
  const image = sg.getImageData(0, 0, w, h);
  const buf = new Float32Array(w * h * 4);
  for (let i = 0; i < image.data.length; i += 4) {
    const lum = (0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]) / 255;
    const k = lum > threshold ? (lum - threshold) / (1 - threshold) : 0;
    buf[i] = image.data[i] * k; buf[i + 1] = image.data[i + 1] * k; buf[i + 2] = image.data[i + 2] * k;
  }
  boxBlur(buf, w, h, radius);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = clamp255(buf[i]); image.data[i + 1] = clamp255(buf[i + 1]); image.data[i + 2] = clamp255(buf[i + 2]); image.data[i + 3] = 255;
  }
  sg.putImageData(image, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = strength;
  g.globalCompositeOperation = 'lighter';
  g.drawImage(small, 0, 0, W, H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
