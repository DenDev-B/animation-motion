// Пакетная озвучка сцен: чистая логика без document/window/fetch.
// synthesize и hooks передаются снаружи (из editor/main.ts — через /__api/tts/synthesize).
import type { ProjectSceneV1, ProjectV1, VoiceWord } from './project.ts';

export interface VoiceBatchScene {
  sceneId: string;
  text: string;
}

export interface VoiceBatchResult {
  ok: number;
  skipped: number;
  errors: number;
  seconds: number;
  perScene: Array<{ sceneId: string; file?: string; words?: VoiceWord[]; durationSec?: number; cached?: boolean; error?: string }>;
}

export interface VoiceBatchHooks {
  onProgress?: (done: number, total: number) => void;
  onSceneResult?: (sceneId: string, result: { file: string; words?: VoiceWord[]; durationSec: number; cached?: boolean } | { error: string }) => void;
  shouldAbort?: () => boolean;
}

export interface VoiceBatchPlan {
  todo: VoiceBatchScene[];
  skipped: number;
}

/** Какие сцены нужно озвучить: есть voice.text и ещё нет voice.file. */
export function voiceBatchPlan(project: ProjectV1): VoiceBatchPlan {
  const todo: VoiceBatchScene[] = [];
  let skipped = 0;
  for (const entry of project.scenes) {
    const text = (entry.voice?.text ?? '').trim();
    if (!text) { skipped++; continue; }
    if (entry.voice?.file) { skipped++; continue; }
    todo.push({ sceneId: entry.id, text });
  }
  return { todo, skipped };
}

/** Последовательно озвучить все сцены из плана. Ошибка одной сцены не останавливает остальные. */
export async function runVoiceBatch(
  plan: VoiceBatchPlan,
  synthesize: (sceneId: string, text: string) => Promise<{ file: string; words?: VoiceWord[]; durationSec: number; cached?: boolean }>,
  hooks: VoiceBatchHooks = {},
): Promise<VoiceBatchResult> {
  const { todo } = plan;
  let ok = 0;
  let errors = 0;
  let seconds = 0;
  const perScene: VoiceBatchResult['perScene'] = [];
  const total = todo.length;

  for (const [index, scene] of todo.entries()) {
    if (hooks.shouldAbort?.()) break;
    hooks.onProgress?.(index, total);
    try {
      const result = await synthesize(scene.sceneId, scene.text);
      ok++;
      seconds += result.durationSec ?? 0;
      perScene.push({ sceneId: scene.sceneId, file: result.file, words: result.words, cached: result.cached });
      hooks.onSceneResult?.(scene.sceneId, { file: result.file, words: result.words, durationSec: result.durationSec, cached: result.cached });
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      perScene.push({ sceneId: scene.sceneId, error: message });
      hooks.onSceneResult?.(scene.sceneId, { error: message });
    }
  }
  hooks.onProgress?.(total, total);

  return { ok, skipped: plan.skipped, errors, seconds, perScene };
}
