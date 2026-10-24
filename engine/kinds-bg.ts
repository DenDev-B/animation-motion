import type { RenderCache } from './kinds.ts';
import { lerp, rng, clamp } from './math.ts';
import { col, mixc, rgba } from './color.ts';

type Point = [number, number];

function num(p: Record<string, unknown>, key: string, fallback: number): number {
  const value = p[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(p: Record<string, unknown>, key: string, fallback: string): string {
  const value = p[key];
  return typeof value === 'string' ? value : fallback;
}

function closedPath(g: CanvasRenderingContext2D, points: Point[]): void {
  g.beginPath();
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
  g.closePath();
}

export interface MountainsGeo {
  points: Point[];
  caps: Point[][];
}

export function mountainsGeo(p: Record<string, unknown>, cache: RenderCache): MountainsGeo {
  const key = `mountains:${JSON.stringify(p)}`;
  const hit = cache.bgCache.get(key);
  if (hit) return hit as MountainsGeo;
  const W = Math.max(1, num(p, 'w', 2400));
  const minH = Math.max(0, num(p, 'minH', 60));
  const maxH = Math.max(minH, num(p, 'maxH', 260));
  const peaks = Math.max(1, Math.round(num(p, 'peaks', 8)));
  const rough = clamp(num(p, 'rough', 0.5));
  const snow = clamp(num(p, 'snow', 0));
  const r = rng(Math.round(num(p, 'seed', 1)));
  const step = W / peaks;
  const points: Point[] = [[-W / 2, -minH * (0.15 + r() * 0.25)]];
  const peakIndexes: number[] = [];
  for (let i = 0; i < peaks; i++) {
    const x = -W / 2 + step * (i + 0.5) + (r() - 0.5) * step * 0.4 * rough;
    const h = lerp(minH, maxH, Math.pow(r(), 0.85));
    if (i > 0) {
      const previousX = points[points.length - 1][0];
      const vx = (previousX + x) / 2 + (r() - 0.5) * step * 0.25 * rough;
      const vy = -Math.min(minH * 0.85, lerp(0, Math.min(minH, h) * 0.45, (0.25 + 0.75 * r()) * rough));
      points.push([vx, vy]);
    }
    peakIndexes.push(points.length);
    points.push([x, -h]);
  }
  points.push([W / 2, -minH * (0.15 + r() * 0.25)]);
  const caps: Point[][] = [];
  if (snow > 0) {
    for (const index of peakIndexes) {
      const [x, y] = points[index];
      const capH = -y * 0.55 * snow;
      if (capH < 1) continue;
      const edge = (neighbour: Point): Point => {
        const t = capH / Math.max(1e-6, neighbour[1] - y);
        return [x + (neighbour[0] - x) * t, y + capH];
      };
      caps.push([[x, y], edge(points[index - 1]), edge(points[index + 1])]);
    }
  }
  const geo = { points: [...points, [W / 2, 1500] as Point, [-W / 2, 1500] as Point], caps };
  cache.bgCache.set(key, geo);
  return geo;
}

export function drawMountains(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache): void {
  const geo = mountainsGeo(p, cache);
  const haze = clamp(num(p, 'haze', 0));
  const base = mixc(col(str(p, 'color', 'far'), pal), col('haze', pal), haze);
  closedPath(g, geo.points);
  g.fillStyle = base;
  g.fill();
  if (geo.caps.length) {
    g.fillStyle = mixc(col('cloudLight', pal), col('haze', pal), haze * 0.35);
    for (const cap of geo.caps) {
      closedPath(g, cap);
      g.fill();
    }
  }
}

export interface HillsGeo {
  points: Point[];
}

export function hillsGeo(p: Record<string, unknown>, cache: RenderCache): HillsGeo {
  const key = `hills:${JSON.stringify(p)}`;
  const hit = cache.bgCache.get(key);
  if (hit) return hit as HillsGeo;
  const W = Math.max(1, num(p, 'w', 2400));
  const amp = Math.max(0, num(p, 'amp', 60));
  const waves = Math.max(1, Math.round(num(p, 'waves', 3)));
  const r = rng(Math.round(num(p, 'seed', 1)));
  const terms: Array<{ freq: number; phase: number; weight: number }> = [];
  let total = 0;
  for (let i = 0; i < waves; i++) {
    const weight = 1 / Math.pow(i + 1, 1.15);
    terms.push({ freq: i + 1 + (r() - 0.5) * 0.4, phase: r() * Math.PI * 2, weight });
    total += weight;
  }
  const samples = Math.max(64, waves * 32);
  const points: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const wave = terms.reduce((sum, term) => sum + term.weight * Math.sin(2 * Math.PI * term.freq * u + term.phase), 0) / total;
    points.push([-W / 2 + W * u, -(amp * 0.5 + amp * 0.5 * wave)]);
  }
  const geo = { points: [...points, [W / 2, 1500] as Point, [-W / 2, 1500] as Point] };
  cache.bgCache.set(key, geo);
  return geo;
}

export function drawHills(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache): void {
  const geo = hillsGeo(p, cache);
  const haze = clamp(num(p, 'haze', 0));
  closedPath(g, geo.points);
  g.fillStyle = mixc(col(str(p, 'color', 'mid'), pal), col('haze', pal), haze);
  g.fill();
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  a: number;
}

export interface StarsGeo {
  stars: Star[];
}

export function starsGeo(p: Record<string, unknown>, cache: RenderCache): StarsGeo {
  const key = `stars:${JSON.stringify(p)}`;
  const hit = cache.bgCache.get(key);
  if (hit) return hit as StarsGeo;
  const W = Math.max(1, num(p, 'w', 2400));
  const H = Math.max(1, num(p, 'h', 1000));
  const count = Math.max(1, Math.round(num(p, 'count', 300)));
  const minR = Math.max(0.01, num(p, 'minR', 0.8));
  const maxR = Math.max(minR, num(p, 'maxR', 2.2));
  const bias = clamp(num(p, 'bias', 0.5));
  const r = rng(Math.round(num(p, 'seed', 1)));
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: lerp(-W / 2, W / 2, r()),
      y: -H * (1 - Math.pow(r(), 1 + bias * 2)),
      r: lerp(minR, maxR, Math.pow(r(), 1.7)),
      phase: r() * Math.PI * 2,
      speed: 0.8 + r() * 1.4,
      a: 0.55 + 0.45 * r(),
    });
  }
  const geo = { stars };
  cache.bgCache.set(key, geo);
  return geo;
}

export function drawStars(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache, t: number): void {
  const geo = starsGeo(p, cache);
  const twinkle = clamp(num(p, 'twinkle', 0.3));
  const base = col(str(p, 'color', '#fff6d5'), pal);
  for (const star of geo.stars) {
    const tw = 0.5 + 0.5 * Math.sin(t * star.speed + star.phase);
    g.fillStyle = rgba(base, star.a * (1 - twinkle * 0.7 * tw));
    g.beginPath();
    g.arc(star.x, star.y, star.r, 0, 7);
    g.fill();
  }
}
