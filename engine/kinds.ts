import type { CatalogAsset, SceneObject } from './schema.ts';
import { lerp } from './math.ts';
import { col, mixc, rgba } from './color.ts';
import { rng } from './math.ts';

export interface RenderCache {
  cloudCache: Map<string, HTMLCanvasElement>;
  skyCache: Map<string, { B: Array<{ x: number; w: number; h: number; step?: { w: number; h: number }; ant?: number }>; WN: number[][]; W: number }>;
  noiseTile: HTMLCanvasElement | null;
}

export function createRenderCache(): RenderCache {
  return { cloudCache: new Map(), skyCache: new Map(), noiseTile: null };
}

export type CreateCanvas = (w: number, h: number) => HTMLCanvasElement;

export function cloudSprite(p: Record<string, unknown>, pal: Record<string, unknown>, cache: RenderCache, createCanvas: CreateCanvas): HTMLCanvasElement {
  const key = JSON.stringify([p, pal]);
  const cached = cache.cloudCache.get(key);
  if (cached) return cached;
  const S = 2;
  const w = ((p.w as number | undefined) ?? 400) as number;
  const h = ((p.h as number | undefined) ?? 140) as number;
  const n = ((p.puffs as number | undefined) ?? 9) as number;
  const r = rng(((p.seed as number | undefined) ?? 1) as number);
  const lit = mixc(col((p.lit as string | undefined) ?? 'cloudLight', pal), col('haze', pal), ((p.haze as number | undefined) ?? 0) as number);
  const sh = mixc(col((p.shade as string | undefined) ?? 'cloudShadow', pal), col('haze', pal), ((p.haze as number | undefined) ?? 0) as number);
  const c = createCanvas(Math.ceil(w * S), Math.ceil(h * S));
  const g = c.getContext('2d')!;
  g.scale(S, S);
  g.translate(w / 2, h);
  const cs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const rad = h * (.26 + .34 * Math.pow(Math.sin(Math.PI * u), .8) * (.6 + .4 * r()));
    cs.push([lerp(-0.4, 0.4, u) * w + (r() - 0.5) * w * 0.05, -rad * 0.72, rad]);
  }
  cs.push([(r() - 0.5) * w * 0.2, -h * 0.52, h * 0.46]);
  g.fillStyle = sh;
  for (const q of cs) { g.beginPath(); g.arc(q[0], q[1], q[2], 0, 7); g.fill(); }
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = lit;
  for (const q of cs) { g.beginPath(); g.arc(q[0], q[1] - h * 0.11, q[2] * 0.9, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(-w, 0, w * 2, h * 2);
  cache.cloudCache.set(key, c);
  return c;
}

export function skylineGeo(p: Record<string, unknown>, cache: RenderCache): { B: Array<{ x: number; w: number; h: number; step?: { w: number; h: number }; ant?: number }>; WN: number[][]; W: number } {
  const key = JSON.stringify(p);
  const cached = cache.skyCache.get(key);
  if (cached) return cached;
  const r = rng(((p.seed as number | undefined) ?? 1) as number);
  const W = ((p.w as number | undefined) ?? 2400) as number;
  const B: Array<{ x: number; w: number; h: number; step?: { w: number; h: number }; ant?: number }> = [];
  const WN: number[][] = [];
  let x = -W / 2;
  while (x < W / 2) {
    const w = lerp(((p.minW as number | undefined) ?? 44) as number, ((p.maxW as number | undefined) ?? 110) as number, r());
    const h = lerp(((p.minH as number | undefined) ?? 80) as number, ((p.maxH as number | undefined) ?? 300) as number, Math.pow(r(), 1.25));
    const b = {
      x, w, h,
      step: r() < 0.25 ? { w: w * lerp(0.4, 0.7, r()), h: h * lerp(0.08, 0.2, r()) } : undefined,
      ant: r() < 0.15 ? lerp(18, 60, r()) : undefined,
    };
    B.push(b);
    if ((p.windows ?? true) !== false && ((p.lit as number | undefined) ?? 0) > 0) {
      const cols = Math.floor((w - 8) / 14);
      const rows = Math.floor((h - 24) / 18);
      for (let cI = 0; cI < cols; cI++) for (let rI = 0; rI < rows; rI++) if (r() < ((p.lit as number | undefined) ?? 0)) WN.push([x + 7 + cI * 14, -h + 14 + rI * 18]);
    }
    x += w + lerp(0, 10, r());
  }
  const result = { B, WN, W };
  cache.skyCache.set(key, result);
  return result;
}

export function drawAsset(g: CanvasRenderingContext2D, o: SceneObject, a: CatalogAsset, t: number, pal: Record<string, unknown>) {
  for (const part of a.parts) {
    g.save();
    if (part.off) g.translate(part.off[0], part.off[1]);
    let pa: import('./schema.ts').Anim[] = [];
    if (o.partAnim) { const v = o.partAnim[part.id]; if (v) pa = v; }
    else if (part.anim) pa = part.anim as import('./schema.ts').Anim[];
    let rot = 0;
    for (const an of pa) if (an.type === 'swing') rot += (an.amp ?? 0) * Math.sin((t / (an.period ?? 4) + (an.phase ?? 0)) * 2 * Math.PI);
    if (rot) g.rotate(rot);
    const fill = col(o.color ?? part.fill, pal);
    if (part.type === 'circle') {
      g.fillStyle = fill;
      g.beginPath();
      g.arc(part.cx as number, part.cy as number, part.r as number, 0, 7);
      g.fill();
    } else if (part.type === 'line') {
      const st = part.stroke as { color: string; w: number } | undefined;
      g.strokeStyle = col(st?.color, pal);
      g.lineWidth = st?.w ?? 1;
      g.lineCap = 'round';
      g.stroke(new Path2D(part.d as string));
    } else {
      const P = new Path2D(part.d as string);
      if (part.fill !== 'none') {
        g.fillStyle = fill;
        g.fill(P);
      }
      if (part.stroke) {
        const st = part.stroke as { color: string; w: number };
        g.strokeStyle = col(st.color, pal);
        g.lineWidth = st.w;
        g.stroke(P);
      }
      if (part.rim && typeof pal.rim === 'string') {
        g.save();
        g.clip(P);
        const gr = g.createLinearGradient(0, part.rim[0], 0, part.rim[1]);
        gr.addColorStop(0, rgba(pal.rim, 0.9));
        gr.addColorStop(1, rgba(pal.rim, 0));
        g.fillStyle = gr;
        g.fillRect(-700, part.rim[0] - 4, 1400, part.rim[1] - part.rim[0] + 4);
        g.restore();
      }
    }
    g.restore();
  }
}

export function getNoise(cache: RenderCache, createCanvas: CreateCanvas): HTMLCanvasElement {
  if (cache.noiseTile) return cache.noiseTile;
  const c = createCanvas(160, 160);
  const g = c.getContext('2d')!;
  const im = g.createImageData(160, 160);
  const r = rng(77);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = r() * 255;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  cache.noiseTile = c;
  return c;
}
