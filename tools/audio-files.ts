// Файлы папки audio/: те же расширения, что допускает схема проекта; пути наружу отдаются через «/».
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_EXTENSIONS } from '../engine/spec.ts';

const AUDIO_EXT_RE = new RegExp(`\\.(?:${AUDIO_EXTENSIONS.join('|')})$`, 'i');

export function isAudioFile(file: string): boolean {
  return AUDIO_EXT_RE.test(file);
}

export function audioContentType(file: string): string | undefined {
  switch (path.extname(file).toLowerCase()) {
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    case '.m4a': return 'audio/mp4';
    case '.ogg': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    default: return undefined;
  }
}

/** Все аудиофайлы папки рекурсивно, пути через «/», по алфавиту; папки нет — пустой список. */
export function listAudioFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.isFile() && isAudioFile(entry.name)) found.push(rel);
    }
  };
  walk(dir, '');
  return found.sort((a, b) => a.localeCompare(b));
}
