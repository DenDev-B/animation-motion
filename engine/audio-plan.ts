import { projectFrameCount, sceneStartFrames, type ProjectV1 } from './project.ts';

export type AudioItemKind = 'voice' | 'music' | 'sfx';

export interface AudioPlanItem {
  kind: AudioItemKind;
  /** Путь относительно папки audio/, как записан в проекте. */
  file: string;
  /** Секунды от начала собираемого видео. Отрицательные в режиме куска: файл начинается раньше окна. */
  startSec: number;
  gain: number;
  sceneIndex?: number;
}

export interface AudioWindow {
  startSec: number;
  endSec: number;
}

export interface AudioPlan {
  items: AudioPlanItem[];
  /** Длительность звуковой дорожки = длительность собираемого видео. */
  totalSec: number;
}

/** Раскладка звука по таймлайну проекта. Голос стартует там же, где его сцена, окно сдвигает и обрезает начало. */
export function buildAudioPlan(project: ProjectV1, window?: AudioWindow): AudioPlan {
  const fullSec = projectFrameCount(project) / project.fps;
  const from = window ? Math.min(Math.max(window.startSec, 0), fullSec) : 0;
  const to = window ? Math.min(Math.max(window.endSec, from), fullSec) : fullSec;
  const items: AudioPlanItem[] = [];
  const starts = sceneStartFrames(project);
  project.scenes.forEach((entry, sceneIndex) => {
    const voice = entry.voice;
    // Голос: текст без файла — в миксе участвовать нечему, но эффекты сцены всё равно учитываем.
    if (voice?.file) {
      const startSec = starts[sceneIndex] / project.fps + (voice.offset ?? 0) - from;
      if (startSec < to - from) {
        items.push({ kind: 'voice', file: voice.file, startSec, gain: voice.gain ?? 1, sceneIndex });
      }
    }
    // звуковые эффекты сцены: start = начало сцены + at - окно (независимо от озвучки)
    const sfx = entry.sfx;
    if (Array.isArray(sfx)) {
      for (const e of sfx) {
        const startSec = starts[sceneIndex] / project.fps + e.at - from;
        if (startSec >= to - from) continue;
        items.push({ kind: 'sfx', file: e.file, startSec, gain: e.gain ?? 1, sceneIndex });
      }
    }
  });
  const music = project.audio?.music;
  if (music) items.push({ kind: 'music', file: music.file, startSec: -from, gain: music.gain ?? 0.25 });
  return { items, totalSec: to - from };
}
