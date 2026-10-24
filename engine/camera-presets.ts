import type { CameraKey } from './schema.ts';

export type CameraPresetName = 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'drift' | 'static';

export interface CameraPresetOptions {
  duration: number;
  strength?: number;
  from?: { x?: number; y?: number; zoom?: number };
}

export function cameraPreset(name: CameraPresetName, options: CameraPresetOptions): CameraKey[] {
  const duration = options.duration;
  const strength = options.strength ?? 1;
  const x = options.from?.x ?? 0;
  const y = options.from?.y ?? 0;
  const zoom = options.from?.zoom ?? 1;
  const key = (t: number, dx = 0, dy = 0, dz = 0): CameraKey => ({ t, x: x + dx, y: y + dy, zoom: zoom + dz });
  if (name === 'push-in') return [key(0), key(duration, 0, 0, 0.25 * strength)];
  if (name === 'pull-out') return [key(0, 0, 0, 0.25 * strength), key(duration)];
  if (name === 'pan-left') return [key(0), key(duration, -120 * strength)];
  if (name === 'pan-right') return [key(0), key(duration, 120 * strength)];
  if (name === 'drift') return [key(0), key(duration / 2, 80 * strength, -20 * strength), key(duration)];
  return [key(0)];
}
