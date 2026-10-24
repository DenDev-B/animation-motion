import type { Camera, CameraShake } from './schema.ts';
import { clamp, lerp } from './math.ts';

function hash01(seed: number, index: number, salt: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0x27d4eb2f)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function noise(seed: number, x: number, axis: number): number {
  const cell = Math.floor(x);
  const smooth = x - cell;
  const k = smooth * smooth * (3 - 2 * smooth);
  return lerp(hash01(seed, cell, axis), hash01(seed, cell + 1, axis), k) * 2 - 1;
}

function envelope(shake: CameraShake, t: number): number {
  const t0 = shake.t0 ?? 0;
  const t1 = shake.t1 ?? Infinity;
  if (t < t0 || t > t1) return 0;
  if (shake.decay !== 'out' || !Number.isFinite(t1)) return 1;
  return clamp((t1 - t) / Math.max(1e-6, t1 - t0));
}

export function cameraShake(camera: Pick<Camera, 'shake'>, t: number): { x: number; y: number } {
  const shake = camera.shake;
  const list = shake === undefined ? [] : Array.isArray(shake) ? shake : [shake];
  let x = 0;
  let y = 0;
  for (const entry of list) {
    const weight = envelope(entry, t);
    if (!weight) continue;
    const seed = entry.seed ?? 1;
    const phase = t * (entry.freq ?? 8);
    x += (entry.amp ?? 0) * weight * noise(seed, phase, 0);
    y += (entry.amp ?? 0) * weight * noise(seed, phase, 1);
  }
  return { x, y };
}
