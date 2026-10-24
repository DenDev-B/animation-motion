import { validateScene, validateAsset, validateObject } from './validate.ts';
export { validateProject, migrateProject, projectFrameCount, locateFrame } from './project.ts';
export type { ProjectV1, ProjectSceneV1 } from './project.ts';
import { draw } from './render.ts';
import { createRenderCache, type RenderCache } from './kinds.ts';
import type {
  SceneV1,
  Layer,
  SceneObject,
  ObjectKind,
  Anim,
  Camera,
  CameraKey,
  Style,
  CatalogAsset,
  AssetPart,
  Palette,
} from './schema.ts';

export type RenderEnv = {
  createCanvas: (w: number, h: number) => HTMLCanvasElement;
  catalog: Record<string, CatalogAsset>;
  cache: ReturnType<typeof createRenderCache>;
};

export type RenderDeps = {
  createCanvas: (w: number, h: number) => HTMLCanvasElement;
  catalog: Record<string, CatalogAsset>;
  cache: RenderCache;
};

export function renderFrame(ctx: CanvasRenderingContext2D, scene: SceneV1, t: number, size: { w: number; h: number }, env: RenderEnv): void {
  const { w, h } = size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  draw(ctx, w, h, t, scene, { createCanvas: env.createCanvas, catalog: env.catalog, cache: env.cache });
}

export { createRenderCache };
export { validateScene };
export { validateAsset };
export { validateObject };
export type { ValidationError, ValidationResult } from './validate.ts';
export { KIND_SPEC, ANIM_SPEC, PALETTE_SLOTS, SCENE_SPEC } from './spec.ts';
export { buildPrompt, extractJson, buildFixRequest } from './ai-io.ts';
export type {
  SceneV1,
  Layer,
  SceneObject,
  ObjectKind,
  Anim,
  Camera,
  CameraKey,
  Style,
  CatalogAsset,
  AssetPart,
  Palette,
};
