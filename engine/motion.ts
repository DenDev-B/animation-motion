// Пресеты движения: чистая функция времени, без накопленного состояния и без случайности.
export const MOTION_PRESETS = ['walk', 'run', 'fly', 'swim', 'hop', 'sway'] as const;
export type MotionPreset = typeof MOTION_PRESETS[number];

export interface Motion {
  preset: MotionPreset;
  /** Скорость 0.2..4, по умолчанию 1. */
  speed?: number;
  /** Амплитуда 0..3, по умолчанию 1. */
  amp?: number;
  /** Фаза 0..1, по умолчанию 0. */
  phase?: number;
  /** 1: движение в сторону, куда повёрнут объект; -1: в обратную. */
  dir?: -1 | 1;
}

export interface MotionTransform { dx: number; dy: number; rot: number; sx: number; sy: number }

/** Константы пресетов (периоды в секундах при speed=1, амплитуды в долях высоты, углы в градусах). */
export const MOTION_CONSTS = {
  walk: { period: 0.7, bounce: 0.012, tiltDeg: 1.5 },
  run: { period: 0.45, bounce: 0.03, leanDeg: 6, wobbleDeg: 2.5 },
  fly: { bobPeriod: 3, bobAmp: 0.03, flapPeriod: 0.5, flapSquash: 0.12, rollPeriod: 4, rollDeg: 4 },
  swim: { wavePeriod: 1.8, waveDeg: 5, bobPeriod: 3.6, bobAmp: 0.015 },
  hop: { period: 1.2, height: 0.25, squash: 0.08, squashPortion: 0.1 },
  sway: { period: 4, deg: 6 },
} as const;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);

export const IDENTITY: MotionTransform = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };

/**
 * Смещение/поворот/масштаб для пресета в момент t.
 * Единицы: dx, dy в тех же единицах, что и height (локальные единицы модели); rot в радианах.
 * height: высота модели (bounds[3] в формате [x, y, ширина, высота]) в локальных единицах.
 */
export function motionTransform(motion: Motion, t: number, height: number): MotionTransform {
  const speed = motion.speed ?? 1;
  const amp = motion.amp ?? 1;
  const ph = motion.phase ?? 0;
  const dir = motion.dir ?? 1;
  if (amp === 0) return { ...IDENTITY };
  const k = (period: number) => (t * speed) / period + ph;
  switch (motion.preset) {
    case 'walk': {
      const c = TAU * k(MOTION_CONSTS.walk.period);
      return { dx: 0, dy: -amp * MOTION_CONSTS.walk.bounce * height * Math.abs(Math.sin(c)), rot: amp * MOTION_CONSTS.walk.tiltDeg * DEG * Math.sin(c), sx: 1, sy: 1 };
    }
    case 'run': {
      const C = MOTION_CONSTS.run;
      const c = TAU * k(C.period);
      return { dx: 0, dy: -amp * C.bounce * height * Math.abs(Math.sin(c)), rot: dir * amp * C.leanDeg * DEG + amp * C.wobbleDeg * DEG * Math.sin(c), sx: 1, sy: 1 };
    }
    case 'fly': {
      const C = MOTION_CONSTS.fly;
      return {
        dx: 0,
        dy: amp * C.bobAmp * height * Math.sin(TAU * k(C.bobPeriod)),
        rot: dir * amp * C.rollDeg * DEG * Math.sin(TAU * k(C.rollPeriod)),
        sx: 1,
        sy: 1 - C.flapSquash * amp * Math.abs(Math.sin(Math.PI * k(C.flapPeriod))),
      };
    }
    case 'swim': {
      const C = MOTION_CONSTS.swim;
      return { dx: 0, dy: amp * C.bobAmp * height * Math.sin(TAU * k(C.bobPeriod)), rot: amp * C.waveDeg * DEG * Math.sin(TAU * k(C.wavePeriod)), sx: 1, sy: 1 };
    }
    case 'hop': {
      const C = MOTION_CONSTS.hop;
      const u = frac(k(C.period));
      const dy = -amp * C.height * height * 4 * u * (1 - u);
      const sq = u < C.squashPortion ? Math.sin((Math.PI * u) / C.squashPortion) : 0;
      const sy = 1 - C.squash * Math.min(1, amp) * sq;
      return { dx: 0, dy, rot: 0, sx: 1 + (1 - sy) * 0.5, sy };
    }
    case 'sway': {
      const C = MOTION_CONSTS.sway;
      return { dx: 0, dy: 0, rot: amp * C.deg * DEG * Math.sin(TAU * k(C.period)), sx: 1, sy: 1 };
    }
  }
}

/** Приводит params.motion (объект или массив) к списку. */
export function motionList(value: unknown): Motion[] {
  if (Array.isArray(value)) return value as Motion[];
  if (value && typeof value === 'object') return [value as Motion];
  return [];
}

/** Опора: sway, hop, walk, run опираются на низ модели (y + высота), остальные на начало координат. */
const BOTTOM_PIVOT: ReadonlySet<MotionPreset> = new Set(['sway', 'hop', 'walk', 'run']);

type Ctx2D = Pick<CanvasRenderingContext2D, 'translate' | 'rotate' | 'scale'>;

/**
 * Применяет движения к контексту (после transform объекта и перед отрисовкой модели).
 * bounds модели: формат каталога [x, y, ширина, высота] в локальных единицах.
 */
export function applyMotion(g: Ctx2D, motions: unknown, t: number, bounds: readonly number[]): void {
  const list = motionList(motions);
  if (list.length === 0) return;
  const height = Math.max(1e-6, bounds[3]);
  const bottom = bounds[1] + bounds[3];
  for (const m of list) {
    const r = motionTransform(m, t, height);
    const py = BOTTOM_PIVOT.has(m.preset) ? bottom : 0;
    g.translate(r.dx, r.dy + py);
    if (r.rot) g.rotate(r.rot);
    if (r.sx !== 1 || r.sy !== 1) g.scale(r.sx, r.sy);
    g.translate(0, -py);
  }
}

/** Проверка params.motion для валидатора. Возвращает список {path, message}. */
export function validateMotion(value: unknown, path: string): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = [];
  const items = Array.isArray(value) ? value : [value];
  if (Array.isArray(value) && value.length === 0) errors.push({ path, message: 'motion не должен быть пустым массивом; пример: {"preset":"walk"}' });
  items.forEach((raw, i) => {
    const p = Array.isArray(value) ? `${path}[${i}]` : path;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) { errors.push({ path: p, message: 'motion должен быть объектом {preset, speed?, amp?, phase?, dir?}; пример: {"preset":"walk"}' }); return; }
    const m = raw as Record<string, unknown>;
    if (typeof m.preset !== 'string' || !(MOTION_PRESETS as readonly string[]).includes(m.preset)) errors.push({ path: `${p}.preset`, message: `preset должен быть одним из ${MOTION_PRESETS.join(', ')}; пример: walk` });
    const num = (key: string, min: number, max: number, ex: string) => {
      const v = m[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) errors.push({ path: `${p}.${key}`, message: `${key} должен быть числом от ${min} до ${max}; пример: ${ex}` });
    };
    num('speed', 0.2, 4, '1');
    num('amp', 0, 3, '1');
    num('phase', 0, 1, '0');
    if (m.dir !== undefined && m.dir !== -1 && m.dir !== 1) errors.push({ path: `${p}.dir`, message: 'dir должен быть -1 или 1; пример: 1' });
  });
  return errors;
}
