import type { SceneV1, SceneObject } from './schema.ts';
import { clamp, lerp, EASE } from './math.ts';
import { cameraShake } from './shake.ts';

export function evalObj(o: SceneObject, t: number, scene: SceneV1) {
  let x = o.x ?? 0, y = o.y ?? 0, rot = (o.rot ?? 0) * Math.PI / 180, s = o.s ?? 1, a = o.alpha ?? 1;
  for (const raw of (o.anim ?? [])) {
    const an = raw as Record<string, unknown>;
    const per = (an.period ?? 4) as number;
    const ph = (an.phase ?? 0) as number;
    switch (raw.type) {
      case 'move': {
        const t0 = raw.t0 ?? 0, t1 = raw.t1 ?? scene.duration;
        const k = (EASE[raw.ease ?? 'sine'] ?? EASE.sine)(clamp((t - t0) / Math.max(0.001, t1 - t0)));
        x += lerp(raw.from[0], raw.to[0], k);
        y += lerp(raw.from[1], raw.to[1], k);
        break;
      }
      case 'drift': x += (raw.vx ?? 0) * t; y += (raw.vy ?? 0) * t; break;
      case 'bob': y += (raw.amp ?? 0) * Math.sin((t / per + ph) * 2 * Math.PI); break;
      case 'swing': rot += (raw.amp ?? 0) * Math.sin((t / per + ph) * 2 * Math.PI); break;
      case 'pulse': s *= 1 + (raw.amp ?? 0) * Math.sin((t / per + ph) * 2 * Math.PI); break;
      case 'fade': {
        const t0 = raw.t0 ?? 0, t1 = raw.t1 ?? scene.duration;
        a *= lerp(raw.from ?? 1, raw.to ?? 0, clamp((t - t0) / Math.max(0.001, t1 - t0)));
        break;
      }
    }
  }
  return { x, y, rot, s, a };
}

export function camAt(t: number, scene: SceneV1) {
  const k = scene.camera.keys;
  let base: { x: number; y: number; zoom: number };
  if (!k || !k.length) base = { x: 0, y: 0, zoom: 1 };
  else if (t <= k[0].t) base = k[0];
  else {
    base = k[k.length - 1];
    for (let i = 1; i < k.length; i++) {
      if (t <= k[i].t) {
        const e = EASE.sine(clamp((t - k[i - 1].t) / Math.max(0.001, k[i].t - k[i - 1].t)));
        base = { x: lerp(k[i - 1].x, k[i].x, e), y: lerp(k[i - 1].y, k[i].y, e), zoom: lerp(k[i - 1].zoom, k[i].zoom, e) };
        break;
      }
    }
  }
  const shake = cameraShake(scene.camera, t);
  return { x: base.x + shake.x, y: base.y + shake.y, zoom: base.zoom };
}
