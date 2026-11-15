import { validateScene, type ValidateOpts, type ValidationError } from './validate.ts';
import { AUDIO_EXTENSIONS, SUBTITLE_POSITIONS, TRANSITION_DIRS, TRANSITION_TYPES, VOICE_TEXT_MAX_CHARS } from './spec.ts';
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

/** Слово озвучки с таймингом в секундах от начала аудиофайла. */
export interface VoiceWord {
  w: string;
  t0: number;
  t1: number;
}

/** Озвучка сцены: готовая запись из папки audio/, наложенная на таймлайн проекта. */
export interface ProjectVoiceV1 {
  /** Путь относительно audio/. Не заполнен, если текст ещё не озвучен — тогда файл ставит `npm run tts`. */
  file?: string;
  /** Задержка от начала сцены, с. */
  offset?: number;
  /** 0..2, по умолчанию 1. */
  gain?: number;
  text?: string;
  words?: VoiceWord[];
}

/** Музыка на весь ролик: повторяется, если короче ролика, и приглушается под голосом. */
export interface ProjectMusicV1 {
  file: string;
  /** 0..1, по умолчанию 0.25. */
  gain?: number;
  /** По умолчанию true: sidechain-приглушение по шине голоса. */
  duck?: boolean;
}

export interface ProjectAudioV1 {
  music?: ProjectMusicV1;
}

export interface ProjectSceneV1 {
  id: string;
  name: string;
  scene: SceneV1;
  transition: Transition;
  voice?: ProjectVoiceV1;
}

const HEX_RE = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const AUDIO_EXT_RE = new RegExp(`\\.(?:${AUDIO_EXTENSIONS.join('|')})$`, 'i');
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

// Путь внутри audio/: только относительный, без «..», без ведущего слэша и без буквы диска.
function isAudioFileRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\\') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  if (!AUDIO_EXT_RE.test(value)) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

const AUDIO_FILE_EXAMPLE = 's1-voice.wav';
const AUDIO_FILE_HINT = `file должен быть относительным путём внутри audio/ с расширением ${AUDIO_EXTENSIONS.join(', ')}; допустимо: "song.mp3", "voice/${AUDIO_FILE_EXAMPLE}"; пример: "${AUDIO_FILE_EXAMPLE}"`;

function validateWords(value: unknown, path: string, err: (path: string, message: string) => void): void {
  if (!Array.isArray(value)) { err(`${path}.words`, 'words должен быть массивом слов; пример: [{"w":"привет","t0":0.1,"t1":0.4}]'); return; }
  let previousT0: number | undefined;
  value.forEach((raw, index) => {
    const base = `${path}.words[${index}]`;
    if (!isRecord(raw)) { err(base, 'слово должно быть объектом; пример: {"w":"привет","t0":0.1,"t1":0.4}'); return; }
    if (typeof raw.w !== 'string' || !raw.w) err(`${base}.w`, 'w должен быть непустой строкой; пример: привет');
    if (!isFiniteNum(raw.t0) || raw.t0 < 0) err(`${base}.t0`, 't0 должен быть конечным числом не меньше нуля; пример: 0.1');
    if (!isFiniteNum(raw.t1) || raw.t1 < 0) err(`${base}.t1`, 't1 должен быть конечным числом не меньше нуля; пример: 0.4');
    if (isFiniteNum(raw.t0) && isFiniteNum(raw.t1) && raw.t1 <= raw.t0) err(`${base}.t1`, `t1 должен быть больше t0 (${raw.t0}); пример: ${(raw.t0 as number) + 0.3}`);
    if (isFiniteNum(raw.t0)) {
      if (previousT0 !== undefined && raw.t0 <= previousT0) err(`${base}.t0`, `t0 должен идти по возрастанию, предыдущее слово начинается с ${previousT0}; пример: ${previousT0 + 0.3}`);
      previousT0 = raw.t0;
    }
  });
}

function validateVoice(value: unknown, path: string, err: (path: string, message: string) => void): void {
  if (!isRecord(value)) { err(path, 'voice должен быть объектом; пример: {"file":"s1-voice.wav","offset":0.2}'); return; }
  // {text} без {file} — это «текст есть, озвучить ещё нечем»: проект остаётся валидным, а npm run tts заполнит file и words.
  const hasText = typeof value.text === 'string' && value.text.trim().length > 0;
  if (value.file === undefined) {
    if (!hasText) err(path, 'voice: нужен file (готовая запись) или text (озвучить через npm run tts); пример: {"file":"s1-voice.wav"}');
  } else if (!isAudioFileRef(value.file)) err(`${path}.file`, AUDIO_FILE_HINT);
  if (value.offset !== undefined && (!isFiniteNum(value.offset) || value.offset < 0)) err(`${path}.offset`, 'offset должен быть конечным числом не меньше нуля; пример: 0.5');
  if (value.gain !== undefined && (!isFiniteNum(value.gain) || value.gain < 0 || value.gain > 2)) err(`${path}.gain`, 'gain должен быть числом от 0 до 2; пример: 1');
  if (value.text !== undefined) {
    if (typeof value.text !== 'string') err(`${path}.text`, 'text должен быть строкой (текст озвучки)');
    else if (value.text.length > VOICE_TEXT_MAX_CHARS) err(`${path}.text`, `text длиннее ${VOICE_TEXT_MAX_CHARS} символов (${value.text.length}); сократите текст озвучки`);
  }
  if (value.words !== undefined) validateWords(value.words, path, err);
}

function validateAudio(value: unknown, err: (path: string, message: string) => void): void {
  if (!isRecord(value)) { err('audio', 'audio должен быть объектом; пример: {"music":{"file":"song.mp3"}}'); return; }
  if (value.music === undefined) return;
  const music = value.music;
  if (!isRecord(music)) { err('audio.music', 'music должен быть объектом; пример: {"file":"song.mp3","gain":0.25}'); return; }
  if (!isAudioFileRef(music.file)) err('audio.music.file', AUDIO_FILE_HINT);
  if (music.gain !== undefined && (!isFiniteNum(music.gain) || music.gain < 0 || music.gain > 1)) err('audio.music.gain', 'gain должен быть числом от 0 до 1; пример: 0.25');
  if (music.duck !== undefined && typeof music.duck !== 'boolean') err('audio.music.duck', 'duck должен быть true или false; пример: true');
}

function validateSubtitles(value: unknown, err: (path: string, message: string) => void): void {
  if (!isRecord(value)) { err('subtitles', 'subtitles должен быть объектом; пример: {"maxWords":3,"position":"bottom"}'); return; }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') err('subtitles.enabled', 'enabled должен быть true или false; пример: true');
  if (value.maxWords !== undefined && (!isFiniteNum(value.maxWords) || !Number.isInteger(value.maxWords) || value.maxWords < 1 || value.maxWords > 6)) {
    err('subtitles.maxWords', 'maxWords должен быть целым числом от 1 до 6; пример: 3');
  }
  if (value.upper !== undefined && typeof value.upper !== 'boolean') err('subtitles.upper', 'upper должен быть true или false; пример: true');
  if (value.position !== undefined && (typeof value.position !== 'string' || !SUBTITLE_POSITIONS.includes(value.position as SubtitlePosition))) {
    err('subtitles.position', `position должен быть одним из ${SUBTITLE_POSITIONS.join(', ')}; пример: bottom`);
  }
  if (value.size !== undefined && (!isFiniteNum(value.size) || value.size < 0.03 || value.size > 0.12)) {
    err('subtitles.size', 'size должен быть числом от 0.03 до 0.12 (высота шрифта в долях высоты кадра); пример: 0.055');
  }
}

export interface ProjectMetaV1 {
  /** ТЗ режиссёра в Markdown, до BRIEF_MAX_CHARS символов. */
  brief?: string;
  /** Общий рассказ (идея ролика), до 4000 символов. */
  story?: string;
  /** id пресета из engine/styles.ts. */
  styleId?: string;
}

export type SubtitlePosition = typeof SUBTITLE_POSITIONS[number];

/** Субтитры из таймингов слов озвучки: включены, если поле есть и enabled не false. */
export interface ProjectSubtitlesV1 {
  enabled?: boolean;
  maxWords?: number;
  upper?: boolean;
  position?: SubtitlePosition;
  /** Высота шрифта как доля высоты кадра; по умолчанию 0.055 для 16:9 и 0.045 для 9:16. */
  size?: number;
}

export interface ProjectV1 {
  version: 1;
  title: string;
  fps: number;
  format: '16:9' | '9:16';
  scenes: ProjectSceneV1[];
  meta?: ProjectMetaV1;
  audio?: ProjectAudioV1;
  subtitles?: ProjectSubtitlesV1;
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
      if (entry.voice !== undefined) validateVoice(entry.voice, `${base}.voice`, err);
      if (sceneDuration !== undefined) previousDuration = sceneDuration;
    });
  }
  if (project.audio !== undefined) validateAudio(project.audio, err);
  if (project.subtitles !== undefined) validateSubtitles(project.subtitles, err);
  if (project.meta !== undefined) {
    if (!isRecord(project.meta)) err('meta', 'meta должен быть объектом; пример: {"brief":"# ТЗ режиссёра: ...","styleId":"warm-dusk"}');
    else {
      const meta = project.meta;
      if (meta.brief !== undefined) {
        if (typeof meta.brief !== 'string') err('meta.brief', 'meta.brief должен быть строкой (Markdown ТЗ)');
        else if (meta.brief.length > BRIEF_MAX_CHARS) err('meta.brief', `meta.brief длиннее ${BRIEF_MAX_CHARS} символов (${meta.brief.length}); сократите ТЗ`);
      }
      if (meta.story !== undefined) {
        if (typeof meta.story !== 'string') err('meta.story', 'meta.story должен быть строкой (общий рассказ)');
        else if (meta.story.length > 4000) err('meta.story', `meta.story длиннее 4000 символов (${meta.story.length}); сократите рассказ`);
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

/** Начало каждой сцены на таймлайне проекта в кадрах: с учётом наложений переходов. */
export function sceneStartFrames(project: ProjectV1): number[] {
  const starts: number[] = [];
  let start = 0;
  for (let index = 0; index < project.scenes.length; index++) {
    starts.push(start);
    start += sceneFrames(project, index) - overlapFrames(project, index + 1);
  }
  return starts;
}

export function projectFrameCount(project: ProjectV1): number {
  const total = project.scenes.reduce((sum, _entry, index) => sum + sceneFrames(project, index), 0);
  const overlaps = project.scenes.reduce((sum, _entry, index) => sum + overlapFrames(project, index), 0);
  return total - overlaps;
}

export function locateFrame(project: ProjectV1, globalIndex: number): FrameLocation {
  const total = projectFrameCount(project);
  if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= total) throw new RangeError('globalIndex вне диапазона проекта');
  const starts = sceneStartFrames(project);
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
