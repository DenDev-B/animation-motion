import { validateProject, validateScene, type ValidationResult } from '../engine/index.ts';
import type { ProjectV1 } from '../engine/project.ts';
import type { SceneObject, SceneV1 } from '../engine/schema.ts';
import { EDITOR_STRINGS } from './strings.ts';

export type JsonScope = 'scene' | 'project' | 'object';

export interface JsonTarget {
  scope: JsonScope;
  sceneIndex: number;
  layerIndex: number;
  objectIndex: number;
}

function sceneAt(project: ProjectV1, index: number): SceneV1 {
  const scene = project.scenes[index]?.scene;
  if (!scene) throw new Error(EDITOR_STRINGS.errors.sceneNotFound(index + 1));
  return scene;
}

function objectAt(project: ProjectV1, target: JsonTarget): SceneObject | undefined {
  return sceneAt(project, target.sceneIndex).layers[target.layerIndex]?.objects[target.objectIndex];
}

export function targetJson(project: ProjectV1, target: JsonTarget): unknown {
  if (target.scope === 'project') return project;
  if (target.scope === 'object') return objectAt(project, target);
  return sceneAt(project, target.sceneIndex);
}

function validateObject(project: ProjectV1, target: JsonTarget, candidate: unknown, catalogIds: string[]): ValidationResult {
  if (!objectAt(project, target)) return { ok: false, errors: [{ path: '', message: EDITOR_STRINGS.errors.objectNotFound }], warnings: [] };
  const base = sceneAt(project, target.sceneIndex);
  const synthetic: SceneV1 = {
    ...structuredClone(base),
    layers: [{ id: '__validation-layer', name: EDITOR_STRINGS.common.checkLayer, depth: 0, visible: true, objects: [candidate as SceneObject] }],
  };
  const result = validateScene(synthetic, { catalogIds });
  const prefix = 'layers[0].objects[0]';
  const strip = (path: string) => path.slice(prefix.length).replace(/^\./, '');
  return {
    ok: result.ok,
    errors: result.errors.filter(({ path }) => path.startsWith(prefix)).map((issue) => ({ ...issue, path: strip(issue.path) })),
    warnings: result.warnings.filter(({ path }) => path.startsWith(prefix)).map((issue) => ({ ...issue, path: strip(issue.path) })),
  };
}

export function validateTargetJson(project: ProjectV1, target: JsonTarget, candidate: unknown, catalogIds: string[]): ValidationResult {
  if (target.scope === 'project') return validateProject(candidate, { catalogIds });
  if (target.scope === 'object') return validateObject(project, target, candidate, catalogIds);
  return validateScene(candidate, { catalogIds });
}

export function applyTargetJson(project: ProjectV1, target: JsonTarget, candidate: unknown): ProjectV1 {
  if (target.scope === 'project') return structuredClone(candidate as ProjectV1);
  const next = structuredClone(project);
  const scene = next.scenes[target.sceneIndex]?.scene;
  if (!scene) throw new Error(EDITOR_STRINGS.errors.sceneNotFound(target.sceneIndex + 1));
  if (target.scope === 'scene') {
    next.scenes[target.sceneIndex].scene = structuredClone(candidate as SceneV1);
    return next;
  }
  const layer = scene.layers[target.layerIndex];
  if (!layer || layer.objects[target.objectIndex] === undefined) throw new Error(EDITOR_STRINGS.errors.objectNotFound);
  layer.objects[target.objectIndex] = structuredClone(candidate as SceneObject);
  return next;
}
