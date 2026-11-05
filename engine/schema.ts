export type ObjectKind = 'sky' | 'glow' | 'cloud' | 'skyline' | 'mountains' | 'hills' | 'stars' | 'rain' | 'snow' | 'birds' | 'text' | 'counter' | 'asset' | 'shape' | 'light';

export interface CameraKey {
  t: number;
  x: number;
  y: number;
  zoom: number;
  /** Плавность участка от предыдущего ключа до этого; по умолчанию sine. */
  ease?: 'sine' | 'inOut' | 'out' | 'lin' | 'in' | 'snap';
}

export type CameraShotName = 'static' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'drift' | 'slow-push' | 'dolly-out' | 'crash-zoom' | 'crash-out' | 'whip-pan' | 'tilt-up' | 'tilt-down' | 'handheld';

/** Готовый приём камеры по имени; используется, если camera.keys пуст. */
export interface CameraShot {
  name: CameraShotName;
  /** начало приёма, с (по умолчанию 0) */
  t0?: number;
  /** длительность приёма, с (по умолчанию до конца сцены) */
  duration?: number;
  /** 0.1..3, сила приёма (по умолчанию 1) */
  strength?: number;
}

/** Переразметка времени: кадр t рисуется как момент s сцены (замедление, ускорение, стоп-кадр). */
export interface TimeRemap {
  /** пары [t выхода, s источника]; t строго растёт, s не убывает */
  keys: [number, number][];
  /** плавная скорость вместо ломаной */
  smooth?: boolean;
}

export interface CameraShake {
  amp: number;
  freq: number;
  t0?: number;
  t1?: number;
  seed?: number;
  decay?: 'none' | 'out';
}

export interface Camera {
  verticalFit?: number;
  keys: CameraKey[];
  shot?: CameraShot;
  shake?: CameraShake | CameraShake[];
}

export interface World {
  unitsPerMeter: number;
}

/** Цветокоррекция кадра: все поля необязательны, без них эффекта нет. */
export interface Grade {
  /** 0..2, 1 — без изменений */
  saturation?: number;
  /** 0.5..2, 1 — без изменений */
  contrast?: number;
  /** -0.5..0.5, 0 — без изменений */
  brightness?: number;
  /** hex или слот палитры */
  tint?: string;
  /** 0..1 доля подмешивания tint */
  tintAmount?: number;
}

/** Свечение ярких мест кадра. */
export interface Bloom {
  /** 0..1 порог яркости */
  threshold?: number;
  /** 0..1 сила */
  strength?: number;
  /** 1..60 радиус размытия (при высоте кадра 1000) */
  radius?: number;
}

export interface Style {
  grain?: number;
  vignette?: number;
  grade?: Grade;
  bloom?: Bloom;
  /** 0..1: автоматическая воздушная дымка слоёв глубже плоскости действия (depth < 1) */
  depthHaze?: number;
  /** Свободная метка; renderer не читает это поле. */
  preset?: string;
}

export interface Palette {
  sky: string[];
  sun?: string;
  haze?: string;
  far?: string;
  mid?: string;
  near?: string;
  whale?: string;
  belly?: string;
  rim?: string;
  cloudLight?: string;
  cloudShadow?: string;
  window?: string;
  [key: string]: string | string[] | undefined;
}

/** Остановка градиента: [смещение 0..1, цвет (hex или слот палитры)]. */
export type GradientStop = [number, string];

/** Градиентная заливка части; координаты в системе самой части (единицы пути d). */
export type Gradient =
  | { type: 'linear'; from: [number, number]; to: [number, number]; stops: GradientStop[] }
  | { type: 'radial'; c: [number, number]; r: number; stops: GradientStop[] };

export interface AssetPart {
  id: string;
  name: string;
  off?: [number, number];
  fill?: string | Gradient;
  rim?: [number, number];
  [key: string]: unknown;
}

export interface CatalogAsset {
  version: number;
  id: string;
  name: string;
  bounds: [number, number, number, number];
  realSize?: { heightM?: number; widthM?: number };
  meta?: {
    view?: 'side' | 'bottom' | 'front' | 'top' | 'three-quarter';
    facing?: 'left' | 'right';
    tags?: string[];
    anchor?: [number, number];
    license?: { name: string; author?: string; source?: string; url?: string; attribution?: boolean };
  };
  parts: AssetPart[];
}

export type Anim =
  | { type: 'move'; from: [number, number]; to: [number, number]; t0?: number; t1?: number; ease?: 'sine' | 'inOut' | 'out' | 'lin' }
  | { type: 'drift'; vx?: number; vy?: number }
  | { type: 'bob'; amp?: number; period?: number; phase?: number }
  | { type: 'swing'; amp?: number; period?: number; phase?: number }
  | { type: 'pulse'; amp?: number; period?: number }
  | { type: 'fade'; from?: number; to?: number; t0?: number; t1?: number };

export interface SceneObject {
  id: string;
  name: string;
  kind: ObjectKind;
  x?: number;
  y?: number;
  s?: number;
  rot?: number;
  alpha?: number;
  color?: string;
  asset?: string;
  params?: Record<string, unknown>;
  anim?: Anim[];
  partAnim?: Record<string, Anim[]>;
}

export interface Layer {
  id: string;
  name: string;
  depth: number;
  visible: boolean;
  objects: SceneObject[];
}

export interface SceneV1 {
  version: 1;
  title: string;
  duration: number;
  palette: Palette;
  style?: Style;
  world?: World;
  camera: Camera;
  timeRemap?: TimeRemap;
  assets: Record<string, CatalogAsset>;
  layers: Layer[];
}
