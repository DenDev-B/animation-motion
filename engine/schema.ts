export type ObjectKind = 'sky' | 'glow' | 'cloud' | 'skyline' | 'asset';

export interface CameraKey {
  t: number;
  x: number;
  y: number;
  zoom: number;
}

export interface Camera {
  verticalFit: number;
  keys: CameraKey[];
}

export interface Style {
  grain?: number;
  vignette?: number;
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

export interface AssetPart {
  id: string;
  name: string;
  off?: [number, number];
  fill?: string;
  rim?: [number, number];
  [key: string]: unknown;
}

export interface CatalogAsset {
  version: number;
  id: string;
  name: string;
  bounds: [number, number, number, number];
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
  style: Style;
  camera: Camera;
  assets: Record<string, CatalogAsset>;
  layers: Layer[];
}
