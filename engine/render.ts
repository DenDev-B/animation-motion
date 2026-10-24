import type { SceneV1 } from './schema.ts';
import { camAt, evalObj } from './anim.ts';
import { col, mixc, rgba } from './color.ts';
import { clamp } from './math.ts';
import { cloudSprite, skylineGeo, drawAsset, getNoise, createRenderCache } from './kinds.ts';
import type { CreateCanvas } from './kinds.ts';

export type RenderDeps = {
  createCanvas: CreateCanvas;
  catalog: Record<string, import('./schema.ts').CatalogAsset>;
  cache: ReturnType<typeof createRenderCache>;
};

export function draw(g: CanvasRenderingContext2D, W: number, H: number, t: number, scene: SceneV1, deps: RenderDeps) {
  const { createCanvas, catalog, cache } = deps;
  const K = H / 1000;
  const cam = camAt(t, scene);
  const isV = H > W;
  const zoom = cam.zoom * (isV ? (scene.camera.verticalFit ?? 0.52) : 1);
  const pal = scene.palette;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  for (const L of scene.layers) {
    if (L.visible === false) continue;
    const d = L.depth;
    const z = 1 + (zoom - 1) * d;
    const base = [K * z, 0, 0, K * z, W / 2 - cam.x * d * K * z, H / 2 - cam.y * d * K * z];
    for (const o of L.objects) {
      const m = evalObj(o, t, scene);
      g.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
      g.translate(m.x, m.y);
      g.rotate(m.rot);
      g.scale(m.s, m.s);
      g.globalAlpha = clamp(m.a);
      const p = o.params ?? {};
      if (o.kind === 'sky') {
        g.setTransform(1, 0, 0, 1, 0, 0);
        const sk = pal.sky ?? ['#000', '#222'];
        const gr = g.createLinearGradient(0, 0, 0, H);
        sk.forEach((c, i) => gr.addColorStop(Math.min(0.98, i / (sk.length - 1) * 0.88), c as string));
        gr.addColorStop(1, sk[sk.length - 1] as string);
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        continue;
      }
      if (o.kind === 'glow') {
        const r = ((p.r as number | undefined) ?? 300) as number;
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
        const c = col((p.color as string | undefined) ?? 'sun', pal);
        gr.addColorStop(0, rgba(c, ((p.a as number | undefined) ?? 0.8) as number));
        gr.addColorStop(0.35, rgba(c, (((p.a as number | undefined) ?? 0.8) as number) * 0.32));
        gr.addColorStop(1, rgba(c, 0));
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = gr;
        g.beginPath();
        g.arc(0, 0, r, 0, 7);
        g.fill();
        g.globalCompositeOperation = 'source-over';
      } else if (o.kind === 'cloud') {
        const sp = cloudSprite(p, pal, cache, createCanvas);
        g.drawImage(sp, -((p.w as number | undefined) ?? 400) / 2, -((p.h as number | undefined) ?? 140), (p.w as number | undefined) ?? 400, (p.h as number | undefined) ?? 140);
      } else if (o.kind === 'skyline') {
        const geo = skylineGeo(p, cache);
        g.fillStyle = mixc(col((o.color as string | undefined) ?? 'near', pal), col('haze', pal), ((p.haze as number | undefined) ?? 0) as number);
        g.fillRect(-geo.W / 2, -2, geo.W, 1500);
        for (const b of geo.B) {
          g.fillRect(b.x, -b.h, b.w, b.h + 1500);
          if (b.step) g.fillRect(b.x + (b.w - b.step.w) / 2, -b.h - b.step.h, b.step.w, b.step.h + 2);
          if (b.ant) { g.fillRect(b.x + b.w / 2 - 1, -b.h - b.ant, 2, b.ant + 2); }
        }
        if (geo.WN.length) {
          g.fillStyle = rgba(pal.window ?? '#ffd27a', 0.85);
          for (const w of geo.WN) g.fillRect(w[0], w[1], 6, 8);
        }
      } else if (o.kind === 'asset') {
        const a = scene.assets[o.asset ?? ''] ?? catalog[o.asset ?? ''];
        if (a) drawAsset(g, o, a, t, pal);
      } else if (o.kind === 'shape') {
        const model = (o.params?.model as import('./schema.ts').CatalogAsset | undefined);
        if (model) drawAsset(g, o, model, t, pal);
      }
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const st = scene.style ?? {};
  if (st.grain) {
    g.globalAlpha = (st.grain as number | undefined) as number;
    g.globalCompositeOperation = 'overlay';
    const n = getNoise(cache, createCanvas);
    const f = Math.floor(t * 12);
    const ox = (f * 37) % 160;
    const oy = (f * 91) % 160;
    const sc = Math.max(1, H / 540);
    g.save();
    g.scale(sc, sc);
    for (let x = -ox; x < W / sc; x += 160) for (let y = -oy; y < H / sc; y += 160) g.drawImage(n, x, y);
    g.restore();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  if (st.vignette) {
    const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, `rgba(8,4,16,${st.vignette})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
}
