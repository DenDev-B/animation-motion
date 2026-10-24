import type { RenderCache } from './kinds.ts';
import { clamp, lerp } from './math.ts';
import { col, rgba } from './color.ts';

function num(p: Record<string, unknown>, key: string, fallback: number): number {
  const value = p[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(p: Record<string, unknown>, key: string, fallback: string): string {
  const value = p[key];
  return typeof value === 'string' ? value : fallback;
}

function hash01(seed: number, index: number, salt: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0x27d4eb2f)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function wrap(value: number, min: number, size: number): number {
  return min + ((value - min) % size + size) % size;
}

interface Drop {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  len: number;
}

interface RainGeo {
  drops: Drop[];
}

function rainGeo(p: Record<string, unknown>, cache: RenderCache): RainGeo {
  const key = `rain:${JSON.stringify(p)}`;
  const hit = cache.bgCache.get(key);
  if (hit) return hit as RainGeo;
  const w = Math.max(0.001, num(p, 'w', 1600));
  const h = Math.max(0.001, num(p, 'h', 1000));
  const count = Math.max(1, Math.round(num(p, 'count', 600)));
  const seed = Math.round(num(p, 'seed', 1));
  const speed = num(p, 'speed', 1400);
  const angle = (num(p, 'angle', 12) * Math.PI) / 180;
  const len = num(p, 'len', 28);
  const vx = speed * Math.sin(angle);
  const vy = speed * Math.cos(angle);
  const drops: Drop[] = [];
  for (let i = 0; i < count; i++) {
    drops.push({
      x0: lerp(-w / 2, w / 2, hash01(seed, i, 1)),
      y0: lerp(-h / 2, h / 2, hash01(seed, i, 2)),
      vx,
      vy,
      len: len * (0.75 + 0.5 * hash01(seed, i, 3)),
    });
  }
  const geo = { drops };
  cache.bgCache.set(key, geo);
  return geo;
}

export type CreateCanvas = (w: number, h: number) => HTMLCanvasElement;

function rainSprite(p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache, createCanvas: CreateCanvas): { canvas: HTMLCanvasElement; w: number; h: number } {
  const key = `rain-sprite:${JSON.stringify([p, pal])}`;
  const hit = cache.bgCache.get(key);
  if (hit) return hit as { canvas: HTMLCanvasElement; w: number; h: number };
  const geo = rainGeo(p, cache);
  const w = Math.max(0.001, num(p, 'w', 1600));
  const h = Math.max(0.001, num(p, 'h', 1000));
  const width = num(p, 'width', 1.5);
  const alpha = clamp(num(p, 'alpha', 0.5));
  const color = col(str(p, 'color', '#dce8ff'), pal);
  const scale = 2;
  const canvas = createCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.strokeStyle = rgba(color, alpha);
  g.lineWidth = width;
  g.lineCap = 'round';
  const vlen = Math.hypot(geo.drops[0].vx, geo.drops[0].vy) || 1;
  g.beginPath();
  for (const drop of geo.drops) {
    const sx = drop.x0 + w / 2;
    const sy = drop.y0 + h / 2;
    const tx = (drop.vx / vlen) * drop.len;
    const ty = (drop.vy / vlen) * drop.len;
    const xs = [0];
    if (sx - tx < 0) xs.push(w);
    else if (sx - tx > w) xs.push(-w);
    const ys = [0];
    if (sy - ty < 0) ys.push(h);
    else if (sy - ty > h) ys.push(-h);
    for (const dx of xs) for (const dy of ys) {
      g.moveTo(sx + dx, sy + dy);
      g.lineTo(sx + dx - tx, sy + dy - ty);
    }
  }
  g.stroke();
  const sprite = { canvas, w, h };
  cache.bgCache.set(key, sprite);
  return sprite;
}

export function drawRain(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache, t: number, createCanvas: CreateCanvas): void {
  const sprite = rainSprite(p, pal, cache, createCanvas);
  const w = sprite.w;
  const h = sprite.h;
  const geo = rainGeo(p, cache);
  const drop = geo.drops[0];
  const offsetX = ((drop.vx * t) % w + w) % w;
  const offsetY = ((drop.vy * t) % h + h) % h;
  g.save();
  for (const dx of [-w, 0]) for (const dy of [-h, 0]) {
    g.drawImage(sprite.canvas, -w / 2 + offsetX + dx, -h / 2 + offsetY + dy, w, h);
  }
  g.restore();
}

interface Flake {
  x0: number;
  y0: number;
  r: number;
  phase: number;
}

interface SnowGeo {
  flakes: Flake[];
}

function snowGeo(p: Record<string, unknown>, cache: RenderCache): SnowGeo {
  const key = `snow:${JSON.stringify(p)}`;
  const hit = cache.bgCache.get(key);
  if (hit) return hit as SnowGeo;
  const w = Math.max(0.001, num(p, 'w', 1600));
  const h = Math.max(0.001, num(p, 'h', 1000));
  const count = Math.max(1, Math.round(num(p, 'count', 400)));
  const seed = Math.round(num(p, 'seed', 1));
  const minR = num(p, 'minR', 1.5);
  const maxR = Math.max(minR, num(p, 'maxR', 3.5));
  const flakes: Flake[] = [];
  for (let i = 0; i < count; i++) {
    flakes.push({
      x0: lerp(-w / 2, w / 2, hash01(seed, i, 1)),
      y0: lerp(-h / 2, h / 2, hash01(seed, i, 2)),
      r: lerp(minR, maxR, hash01(seed, i, 3)),
      phase: hash01(seed, i, 4) * Math.PI * 2,
    });
  }
  const geo = { flakes };
  cache.bgCache.set(key, geo);
  return geo;
}

export function drawSnow(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache, t: number): void {
  const geo = snowGeo(p, cache);
  const w = Math.max(0.001, num(p, 'w', 1600));
  const h = Math.max(0.001, num(p, 'h', 1000));
  const speed = num(p, 'speed', 90);
  const drift = num(p, 'drift', 40);
  const alpha = clamp(num(p, 'alpha', 0.8));
  const color = col(str(p, 'color', '#ffffff'), pal);
  g.save();
  g.fillStyle = rgba(color, alpha);
  g.beginPath();
  for (const flake of geo.flakes) {
    const x = wrap(flake.x0 + Math.sin(t * 0.9 + flake.phase) * drift, -w / 2, w);
    const y = wrap(flake.y0 + speed * t, -h / 2, h);
    g.moveTo(x + flake.r, y);
    g.arc(x, y, flake.r, 0, 7);
  }
  g.fill();
  g.restore();
}

interface Bird {
  x0: number;
  y0: number;
  phase: number;
  size: number;
}

interface BirdsGeo {
  birds: Bird[];
}

function birdsGeo(p: Record<string, unknown>, cache: RenderCache): BirdsGeo {
  const key = `birds:${JSON.stringify(p)}`;
  const hit = cache.bgCache.get(key);
  if (hit) return hit as BirdsGeo;
  const count = Math.max(1, Math.round(num(p, 'count', 8)));
  const spread = num(p, 'spread', 260);
  const size = num(p, 'size', 18);
  const seed = Math.round(num(p, 'seed', 1));
  const birds: Bird[] = [];
  for (let i = 0; i < count; i++) {
    birds.push({
      x0: lerp(-spread / 2, spread / 2, hash01(seed, i, 1)),
      y0: lerp(-spread / 4, spread / 4, hash01(seed, i, 2)),
      phase: hash01(seed, i, 3) * Math.PI * 2,
      size: size * (0.8 + 0.4 * hash01(seed, i, 4)),
    });
  }
  const geo = { birds };
  cache.bgCache.set(key, geo);
  return geo;
}

export function drawBirds(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache, t: number): void {
  const geo = birdsGeo(p, cache);
  const spread = num(p, 'spread', 260);
  const flap = Math.max(0.001, num(p, 'flap', 0.8));
  const speed = num(p, 'speed', 120);
  const dir = num(p, 'dir', 1) < 0 ? -1 : 1;
  const bob = num(p, 'bob', 12);
  const color = col(str(p, 'color', '#2b2b33'), pal);
  g.save();
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (const bird of geo.birds) {
    const x = wrap(bird.x0 + dir * speed * t, -spread / 2, spread);
    const y = bird.y0 + Math.sin(t * 0.8 + bird.phase) * bob * 0.5;
    const lift = bird.size * (0.12 + 0.4 * (0.5 + 0.5 * Math.sin((t / flap) * Math.PI * 2 + bird.phase)));
    g.lineWidth = Math.max(1, bird.size * 0.14);
    g.beginPath();
    g.moveTo(x - dir * bird.size, y);
    g.quadraticCurveTo(x - dir * bird.size * 0.5, y - lift, x, y);
    g.quadraticCurveTo(x + dir * bird.size * 0.5, y - lift, x + dir * bird.size, y);
    g.stroke();
  }
  g.restore();
}
