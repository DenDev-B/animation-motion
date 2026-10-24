import { validateScene, type ValidationError } from './validate.ts';
import type { SceneV1 } from './schema.ts';

export interface ProjectSceneV1 {
  id: string;
  name: string;
  scene: SceneV1;
  transition: { type: 'cut' };
}

export interface ProjectV1 {
  version: 1;
  title: string;
  fps: number;
  format: '16:9' | '9:16';
  scenes: ProjectSceneV1[];
}

export function validateProject(json: unknown): { ok: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, errors: [{ path: '', message: 'проект должен быть объектом' }] };
  const project = json as Record<string, unknown>;
  if (project.version !== 1) err('version', 'version должен быть равен 1');
  if (typeof project.title !== 'string') err('title', 'title должен быть строкой');
  if (![24, 30, 60].includes(project.fps as number)) err('fps', 'fps должен быть 24, 30 или 60');
  if (project.format !== '16:9' && project.format !== '9:16') err('format', 'format должен быть 16:9 или 9:16');
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    err('scenes', 'scenes должен быть непустым массивом');
  } else {
    const ids = new Set<string>();
    project.scenes.forEach((value, index) => {
      const base = `scenes[${index}]`;
      if (!value || typeof value !== 'object' || Array.isArray(value)) { err(base, 'сцена проекта должна быть объектом'); return; }
      const entry = value as Record<string, unknown>;
      if (typeof entry.id !== 'string' || !entry.id) err(`${base}.id`, 'id сцены должен быть непустой строкой');
      else if (ids.has(entry.id)) err(`${base}.id`, `дубликат id "${entry.id}"`);
      else ids.add(entry.id);
      if (typeof entry.name !== 'string' || !entry.name) err(`${base}.name`, 'name сцены должен быть непустой строкой');
      if (!entry.transition || typeof entry.transition !== 'object' || (entry.transition as Record<string, unknown>).type !== 'cut') err(`${base}.transition.type`, 'пока поддерживается только cut');
      const result = validateScene(entry.scene);
      for (const issue of result.errors) err(`${base}.scene${issue.path ? `.${issue.path}` : ''}`, issue.message);
    });
  }
  return { ok: errors.length === 0, errors };
}

export function migrateProject(json: unknown): ProjectV1 {
  const result = validateProject(json);
  if (!result.ok) throw new Error(result.errors.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  return json as ProjectV1;
}

export function projectFrameCount(project: ProjectV1): number {
  return project.scenes.reduce((sum, entry) => sum + Math.round(entry.scene.duration * project.fps), 0);
}

export function locateFrame(project: ProjectV1, globalIndex: number): { sceneIndex: number; t: number } {
  if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= projectFrameCount(project)) throw new RangeError('globalIndex вне диапазона проекта');
  let offset = 0;
  for (let sceneIndex = 0; sceneIndex < project.scenes.length; sceneIndex++) {
    const count = Math.round(project.scenes[sceneIndex].scene.duration * project.fps);
    if (globalIndex < offset + count) return { sceneIndex, t: (globalIndex - offset) / project.fps };
    offset += count;
  }
  throw new RangeError('globalIndex вне диапазона проекта');
}
