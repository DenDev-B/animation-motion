import type { Camera, CameraKey, CameraShake, CameraShot } from './schema.ts';

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

export const CAMERA_SHOT_NAMES = ['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'drift', 'slow-push', 'dolly-out', 'crash-zoom', 'crash-out', 'whip-pan', 'tilt-up', 'tilt-down', 'handheld'] as const;

export interface CameraShotResult { keys: CameraKey[]; shake?: CameraShake }

/**
 * Словарь приёмов камеры: имя → ключи (и тряска). Чистая функция параметров.
 * Ключи лежат в [t0, t0 + duration]; до t0 камера стоит в начальной позе.
 */
export function cameraShot(shot: CameraShot, sceneDuration: number): CameraShotResult {
  const t0 = Math.max(0, shot.t0 ?? 0);
  const duration = Math.max(0.2, Math.min(shot.duration ?? sceneDuration - t0, Math.max(0.2, sceneDuration - t0)));
  const s = shot.strength ?? 1;
  const t1 = t0 + duration;
  const k = (t: number, x = 0, y = 0, zoom = 1, ease?: CameraKey['ease']): CameraKey => (ease ? { t, x, y, zoom, ease } : { t, x, y, zoom });
  const lead = (): CameraKey[] => (t0 > 0 ? [k(0)] : []);
  const quick = Math.min(0.35, duration / 2);
  switch (shot.name) {
    case 'push-in': return { keys: [...lead(), k(t0), k(t1, 0, 0, 1 + 0.25 * s)] };
    case 'pull-out': return { keys: [...lead(), k(t0, 0, 0, 1 + 0.25 * s), k(t1)] };
    case 'pan-left': return { keys: [...lead(), k(t0), k(t1, -120 * s)] };
    case 'pan-right': return { keys: [...lead(), k(t0), k(t1, 120 * s)] };
    case 'drift': return { keys: [...lead(), k(t0), k(t0 + duration / 2, 80 * s, -20 * s), k(t1)] };
    case 'slow-push': return { keys: [...lead(), k(t0), k(t1, 0, 0, 1 + 0.12 * s, 'inOut')] };
    case 'dolly-out': return { keys: [...lead(), k(t0, 0, 0, 1 + 0.35 * s), k(t1, 0, 0, 1, 'inOut')] };
    case 'crash-zoom': return { keys: [...lead(), k(t0), k(t0 + quick, 0, 0, 1 + 0.6 * s, 'snap'), k(t1, 0, 0, 1 + 0.65 * s)] };
    case 'crash-out': return { keys: [...lead(), k(t0, 0, 0, 1 + 0.6 * s), k(t0 + quick, 0, 0, 1, 'snap'), k(t1)] };
    case 'whip-pan': {
      const mid = t0 + duration * 0.4;
      return { keys: [...lead(), k(t0), k(mid), k(Math.min(t1, mid + 0.3), 500 * s, 0, 1, 'inOut'), k(t1, 500 * s)] };
    }
    case 'tilt-up': return { keys: [...lead(), k(t0), k(t1, 0, -120 * s, 1, 'inOut')] };
    case 'tilt-down': return { keys: [...lead(), k(t0), k(t1, 0, 120 * s, 1, 'inOut')] };
    case 'handheld': return { keys: [k(0)], shake: { amp: Math.min(60, 5 * s), freq: 2.4, seed: 7, t0, t1 } };
    default: return { keys: [k(0)] };
  }
}

/** Камера сцены с учётом shot: shot работает, только когда keys пуст; тряска приёма добавляется к camera.shake. */
export function resolveCamera(camera: Camera, sceneDuration: number): Camera {
  if (!camera.shot || camera.keys.length > 0) return camera;
  const r = cameraShot(camera.shot, sceneDuration);
  const own = camera.shake === undefined ? [] : Array.isArray(camera.shake) ? camera.shake : [camera.shake];
  return { ...camera, keys: r.keys, shake: r.shake ? [...own, r.shake] : camera.shake };
}
