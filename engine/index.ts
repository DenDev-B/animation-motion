import { validateScene, validateAsset, validateObject } from './validate.ts';
export { validateProject, migrateProject, projectFrameCount, locateFrame } from './project.ts';
export type { ProjectV1, ProjectSceneV1, Transition, TransitionType, TransitionDir, LocatedScene, FrameLocation } from './project.ts';
export { composeFrame } from './compose.ts';
export type { ComposeSize, ComposeOptions } from './compose.ts';
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
  CameraShake,
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
export { counterValue, TEXT_FONT_FAMILY } from './kinds-text.ts';
export { unitsPerMeter, metersToUnits, unitsToMeters, assetScaleForMeters } from './units.ts';
export { cameraShake } from './shake.ts';
export { motionTransform, applyMotion, validateMotion, motionList, MOTION_PRESETS, MOTION_CONSTS } from './motion.ts';
export type { Motion, MotionPreset, MotionTransform } from './motion.ts';
export { cameraPreset } from './camera-presets.ts';
export type { CameraPresetName, CameraPresetOptions } from './camera-presets.ts';
export type {
  SceneV1,
  Layer,
  SceneObject,
  ObjectKind,
  Anim,
  Camera,
  CameraKey,
  CameraShake,
  Style,
  CatalogAsset,
  AssetPart,
  Palette,
};
export * from './svg-import.ts';
export { buildProjectPrompt, validateProjectReply, uniqueProjectSlug, formatSuggestions, modelHeightM, PROJECT_PROMPT_MAX_BYTES } from './ai-project.ts';
export type { CatalogEntry, ProjectPromptOptions, ProjectReplyResult, Suggestion } from './ai-project.ts';
