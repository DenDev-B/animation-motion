// Проверка качества проекта сверх схемы: чистая функция, без fs/document/window, без Math.random и Date.now.
// Не правит проект, только сообщает проблемы с подсказками как исправить.
import type { ProjectV1, Transition } from './project.ts';
import { projectFrameCount } from './project.ts';
import { estimateSpeechSec, speechLangOf } from './tts-timing.ts';

export interface LintIssue {
  level: 'warn' | 'info';
  code: string;
  path: string;
  message: string;
}

export interface LintCtx {
  audioFiles?: string[];
}

const isFiniteNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const issue = (level: 'warn' | 'info', code: string, path: string, message: string): LintIssue => ({ level, code, path, message });

/** Длительность перехода в секундах (cut = 0). */
function transitionDuration(t: Transition | undefined): number {
  if (!t || t.type === 'cut') return 0;
  return isFiniteNum(t.duration) && t.duration >= 0 ? t.duration : 0;
}

/** Есть ли в сцене хоть один не-небо объект. */
function sceneHasRealObjects(entry: { scene: { layers: unknown } }): boolean {
  const layers = entry.scene.layers;
  if (!Array.isArray(layers) || layers.length === 0) return false;
  for (const layer of layers) {
    const layerObj = layer as { objects: unknown };
    const objects = Array.isArray(layerObj.objects) ? layerObj.objects : [];
    for (const obj of objects) {
      if ((obj as { kind: string }).kind !== 'sky') return true;
    }
  }
  return false;
}

export function lintProject(project: ProjectV1, ctx: LintCtx = {}): { ok: boolean; issues: LintIssue[] } {
  const issues: LintIssue[] = [];
  const audioFiles = new Set(ctx.audioFiles ?? []);
  const fps = isFiniteNum(project.fps) && project.fps > 0 ? project.fps : 30;
  const portrait = project.format === '9:16';
  const totalSec = projectFrameCount(project) / fps;
  const names = new Set<string>();

  project.scenes.forEach((entry, index) => {
    const base = `scenes[${index}]`;
    const scene = entry.scene;
    const duration = isFiniteNum(scene.duration) ? scene.duration : undefined;

    // scene-short / scene-long
    if (duration !== undefined) {
      if (duration < 1.5) issues.push(issue('warn', 'scene-short', `${base}.scene.duration`, `сцена короче 1.5 с (${duration.toFixed(2)} с): увеличьте duration или объедините с соседом`));
      if (duration > 30) issues.push(issue('info', 'scene-long', `${base}.scene.duration`, `сцена длиннее 30 с (${duration.toFixed(2)} с): рассмотрите разбиение на две сцены`));
    }

    // scene-empty
    if (!sceneHasRealObjects(entry as { scene: { layers: unknown } })) {
      issues.push(issue('warn', 'scene-empty', `${base}.scene.layers`, `в сцене нет объектов кроме неба (или объектов совсем нет): добавьте объекты или удалите сцену`));
    }

    // scene-name-duplicate
    if (entry.name) {
      if (names.has(entry.name)) issues.push(issue('info', 'scene-name-duplicate', `${base}.name`, `имя сцены «${entry.name}» повторяется: сделайте имена уникальными`));
      else names.add(entry.name);
    }

    // voice rules
    const voice = entry.voice;
    if (voice) {
      const vPath = `${base}.voice`;
      const hasText = typeof voice.text === 'string' && voice.text.trim().length > 0;
      const hasFile = typeof voice.file === 'string' && voice.file.length > 0;
      const hasWords = Array.isArray(voice.words) && voice.words.length > 0;
      const subtitlesOn = project.subtitles === undefined || project.subtitles.enabled !== false;
      const file = voice.file;
      const text = voice.text;
      const spokenText = voice.spokenText;
      const words = voice.words;
      const offset = isFiniteNum(voice.offset) && voice.offset >= 0 ? voice.offset : 0;

      if (hasText && !hasFile) {
        issues.push(issue('info', 'voice-text-only', `${vPath}.text`, `есть voice.text, но нет voice.file: запустите npm run tts, чтобы озвучить и присвоить файл`));
      }
      if (hasFile && !hasWords && subtitlesOn) {
        issues.push(issue('info', 'voice-no-words', `${vPath}.words`, `есть voice.file, но нет words: субтитры не будут показаны, добавьте тайминги слов (npm run tts)`));
      }
      if (hasFile && ctx.audioFiles !== undefined && file !== undefined && !audioFiles.has(file)) {
        issues.push(issue('warn', 'voice-file-missing', `${vPath}.file`, `аудиофайл «${file}» не найден в audio/: положите файл в audio/ или укажите существующий путь`));
      }
      if (hasText && duration !== undefined && text !== undefined) {
        let lastT1: number | undefined;
        if (hasWords && words) {
          const last = words[words.length - 1];
          if (last && isFiniteNum(last.t1)) lastT1 = last.t1;
        }
        const speech = lastT1 !== undefined ? lastT1 : estimateSpeechSec(text, speechLangOf(text));
        if (offset + speech > duration) {
          issues.push(issue('warn', 'voice-too-long', `${vPath}.text`, `озвучка не укладывается в сцену (окончание ~${(offset + speech).toFixed(2)} с > duration ${duration.toFixed(2)} с): увеличьте duration сцены или сократите текст`));
        }
      }
      // voice-stale: файл есть, spokenText задан и отличается от текста
      if (hasFile && spokenText !== undefined && spokenText.trim() !== text) {
        issues.push(issue('warn', 'voice-stale', `${vPath}.text`, `текст изменён после озвучки, переозвучьте сцену`));
      }
    }

    // transition-long (использует поля/хелперы из project.ts)
    const transition = entry.transition;
    const prevDuration = index > 0 ? project.scenes[index - 1].scene.duration : undefined;
    const curDuration = duration;
    if (transition && transition.type !== 'cut' && isFiniteNum(transition.duration) && transition.duration > 0) {
      const limitBase = [prevDuration, curDuration].filter(isFiniteNum);
      if (limitBase.length === 2) {
        const limit = Math.min(limitBase[0] as number, limitBase[1] as number) / 2;
        if (transition.duration > limit) {
          issues.push(issue('warn', 'transition-long', `${base}.transition.duration`, `переход ${transition.duration.toFixed(2)} с длиннее половины более короткой соседней сцены (${limit.toFixed(2)} с): сократите duration перехода`));
        }
      }
    }
  });

  // audio.music.file-missing
  if (ctx.audioFiles !== undefined && project.audio?.music?.file && !audioFiles.has(project.audio.music.file)) {
    issues.push(issue('warn', 'voice-file-missing', `audio.music.file`, `аудиофайл музыки «${project.audio.music.file}» не найден в audio/: положите файл в audio/ или укажите существующий путь`));
  }

  // total-long-shorts (вертикальный и суммарная длительность с переходами > 60 с)
  if (portrait && totalSec > 60) {
    issues.push(issue('warn', 'total-long-shorts', '', `вертикальный ролик длиннее 60 с (${totalSec.toFixed(2)} с): для формата 9:16 сделайте проект короче`));
  }

  return { ok: !issues.some((i) => i.level === 'warn'), issues };
}
