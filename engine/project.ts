import { validateScene, type ValidateOpts, type ValidationError } from './validate.ts';
import { TRANSITION_DIRS, TRANSITION_TYPES } from './spec.ts';
import type { SceneV1 } from './schema.ts';
import { BRIEF_MAX_CHARS } from './ai-brief.ts';
import { getStyle, STYLE_PRESETS } from './styles.ts';

export type TransitionType = typeof TRANSITION_TYPES[number];
export type TransitionDir = typeof TRANSITION_DIRS[number];

export interface Transition {
  type: TransitionType;
  duration?: number;
  dir?: TransitionDir;
  color?: string;
}

export interface ProjectSceneV1 {
  id: string;
  name: string;
  scene: SceneV1;
  transition: Transition;
}

const HEX_RE = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function validateTransition(value: unknown, index: number, duration: number | undefined, previousDuration: number | undefined, path: string, err: (path: string, message: string) => void): void {
  if (!isRecord(value)) { err(path, 'transition должен быть объектом; пример: {"type":"cut"}'); return; }
  const type = value.type;
  if (typeof type !== 'string' || !TRANSITION_TYPES.includes(type as TransitionType)) {
    err(`${path}.type`, `type перехода должен быть одним из ${TRANSITION_TYPES.join(', ')}; пример: cut`);
    return;
  }
  if (index === 0 && type !== 'cut') { err(`${path}.type`, 'у первой сцены перехода быть не может; пример: cut'); return; }
  if (type === 'cut') return;
  if (!isFiniteNum(value.duration) || value.duration < 0) err(`${path}.duration`, 'duration должен быть конечным числом >= 0; пример: 0.8');
  else if (duration !== undefined && previousDuration !== undefined) {
    const limit = Math.min(duration, previousDuration) / 2;
    if (value.duration > limit) err(`${path}.duration`, `duration не должен превышать половину меньшей соседней сцены (${limit}); пример: ${Math.min(0.8, limit)}`);
  }
  if (value.dir !== undefined && (typeof value.dir !== 'string' || !TRANSITION_DIRS.includes(value.dir as TransitionDir))) {
    err(`${path}.dir`, `dir должен быть одним из ${TRANSITION_DIRS.join(', ')}; пример: left`);
  }
  if (value.color !== undefined && (typeof value.color !== 'string' || !HEX_RE.test(value.color))) {
    err(`${path}.color`, 'color должен быть #rgb, #rrggbb или #rrggbbaa; пример: #000');
  }
}

export interface ProjectMetaV1 {
  /** ТЗ режиссёра в Markdown, до BRIEF_MAX_CHARS символов. */
  brief?: string;
  /** id пресета из engine/styles.ts. */
  styleId?: string;
}

export interface ProjectV1 {
  version: 1;
  title: string;
  fps: number;
  format: '16:9' | '9:16';
  scenes: ProjectSceneV1[];
  meta?: ProjectMetaV1;
}

export function validateProject(json: unknown, opts: ValidateOpts = {}): { ok: boolean; errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, errors: [{ path: '', message: 'проект должен быть объектом' }], warnings };
  const project = json as Record<string, unknown>;
  if (project.version !== 1) err('version', 'version должен быть равен 1');
  if (typeof project.title !== 'string') err('title', 'title должен быть строкой');
  if (![24, 30, 60].includes(project.fps as number)) err('fps', 'fps должен быть 24, 30 или 60');
  if (project.format !== '16:9' && project.format !== '9:16') err('format', 'format должен быть 16:9 или 9:16');
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    err('scenes', 'scenes должен быть непустым массивом');
  } else {
    const ids = new Set<string>();
    let previousDuration: number | undefined;
    project.scenes.forEach((value, index) => {
      const base = `scenes[${index}]`;
      if (!value || typeof value !== 'object' || Array.isArray(value)) { err(base, 'сцена проекта должна быть объектом'); return; }
      const entry = value as Record<string, unknown>;
      if (typeof entry.id !== 'string' || !entry.id) err(`${base}.id`, 'id сцены должен быть непустой строкой');
      else if (ids.has(entry.id)) err(`${base}.id`, `дубликат id "${entry.id}"`);
      else ids.add(entry.id);
      if (typeof entry.name !== 'string' || !entry.name) err(`${base}.name`, 'name сцены должен быть непустой строкой');
      const result = validateScene(entry.scene, opts);
      for (const issue of result.errors) err(`${base}.scene${issue.path ? `.${issue.path}` : ''}`, issue.message);
      for (const warning of result.warnings) warnings.push({ ...warning, path: `${base}.scene${warning.path ? `.${warning.path}` : ''}` });
      const sceneDuration = isRecord(entry.scene) && isFiniteNum(entry.scene.duration) ? entry.scene.duration : undefined;
      validateTransition(entry.transition, index, sceneDuration, previousDuration, `${base}.transition`, err);
      if (sceneDuration !== undefined) previousDuration = sceneDuration;
    });
  }
  if (project.meta !== undefined) {
    if (!isRecord(project.meta)) err('meta', 'meta должен быть объектом; пример: {"brief":"# ТЗ режиссёра: ...","styleId":"warm-dusk"}');
    else {
      const meta = project.meta;
      if (meta.brief !== undefined) {
        if (typeof meta.brief !== 'string') err('meta.brief', 'meta.brief должен быть строкой (Markdown ТЗ)');
        else if (meta.brief.length > BRIEF_MAX_CHARS) err('meta.brief', `meta.brief длиннее ${BRIEF_MAX_CHARS} символов (${meta.brief.length}); сократите ТЗ`);
      }
      if (meta.styleId !== undefined) {
        if (typeof meta.styleId !== 'string') err('meta.styleId', 'meta.styleId должен быть строкой (id пресета стиля)');
        else if (!getStyle(meta.styleId)) warnings.push({ path: 'meta.styleId', message: `стиль "${meta.styleId}" неизвестен; доступные id: ${STYLE_PRESETS.map((p) => p.id).join(', ')}` });
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function migrateProject(json: unknown): ProjectV1 {
  const result = validateProject(json);
  if (!result.ok) throw new Error(result.errors.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  return json as ProjectV1;
}

export interface LocatedScene { sceneIndex: number; t: number; }
export interface FrameLocation {
  frames: LocatedScene[];
  transition: { type: TransitionType; progress: number } | null;
}

function sceneFrames(project: ProjectV1, index: number): number {
  return Math.round(project.scenes[index].scene.duration * project.fps);
}

function overlapFrames(project: ProjectV1, index: number): number {
  const transition = project.scenes[index]?.transition;
  if (index <= 0 || !transition || transition.type === 'cut' || !isFiniteNum(transition.duration) || transition.duration <= 0) return 0;
  return Math.min(Math.round(transition.duration * project.fps), sceneFrames(project, index - 1), sceneFrames(project, index));
}

export function projectFrameCount(project: ProjectV1): number {
  const total = project.scenes.reduce((sum, _entry, index) => sum + sceneFrames(project, index), 0);
  const overlaps = project.scenes.reduce((sum, _entry, index) => sum + overlapFrames(project, index), 0);
  return total - overlaps;
}

export function locateFrame(project: ProjectV1, globalIndex: number): FrameLocation {
  const total = projectFrameCount(project);
  if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= total) throw new RangeError('globalIndex вне диапазона проекта');
  const starts: number[] = [];
  let start = 0;
  for (let index = 0; index < project.scenes.length; index++) {
    starts.push(start);
    start += sceneFrames(project, index) - overlapFrames(project, index + 1);
  }
  const frames: LocatedScene[] = [];
  for (let index = 0; index < project.scenes.length; index++) {
    const local = globalIndex - starts[index];
    if (local >= 0 && local < sceneFrames(project, index)) frames.push({ sceneIndex: index, t: local / project.fps });
  }
  if (frames.length === 0) throw new RangeError('кадр не попал ни в одну сцену проекта');
  if (frames.length === 1) return { frames, transition: null };
  const second = frames[1].sceneIndex;
  const overlap = overlapFrames(project, second);
  const type = project.scenes[second].transition.type;
  const progress = overlap > 1 ? (globalIndex - starts[second]) / (overlap - 1) : 0.5;
  return { frames, transition: { type, progress } };
}
