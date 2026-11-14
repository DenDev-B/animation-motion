// Тестовый адаптер: тон нужной длительности через ffmpeg lavfi. Нужен только check:tts — человеку его не показывают.
import fs from 'node:fs';
import path from 'node:path';
import { runProcess, tail } from './process.ts';
import type { TtsAdapter } from './types.ts';

const SEC_PER_LETTER = 0.07;
const MIN_SEC = 0.5;
const TONE_HZ = 4000;
const SAMPLE_RATE = 48000;

function letterCount(text: string): number {
  return [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
}

export function fakeDurationSec(text: string): number {
  return Math.max(MIN_SEC, Math.round(letterCount(text) * SEC_PER_LETTER * 1000) / 1000);
}

export const fakeAdapter: TtsAdapter = {
  id: 'fake',
  label: 'Тестовый тон (только для проверок)',
  hidden: true,
  detect: async () => ({ ok: true }),
  voiceId: async () => 'fake-tone',
  async synthesize(text: string, outWav: string): Promise<void> {
    fs.mkdirSync(path.dirname(outWav), { recursive: true });
    const duration = fakeDurationSec(text);
    const result = await runProcess('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'lavfi', '-i', `sine=frequency=${TONE_HZ}:duration=${duration}:sample_rate=${SAMPLE_RATE}`,
      '-ac', '1', '-c:a', 'pcm_s16le', '-y', outWav,
    ]);
    if (result.code === -1) throw new Error(`ffmpeg не запущен: ${tail(result.stderr)}`);
    if (result.code !== 0 || !fs.existsSync(outWav)) throw new Error(`тестовый тон не собран (код ${result.code}): ${tail(result.stderr)}`);
  },
};
