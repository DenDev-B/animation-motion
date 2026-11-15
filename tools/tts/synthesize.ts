// Одна озвучка для CLI, локального сервиса и MCP: адаптер, кэш wav по sha1, ffprobe и оценка таймингов слов.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { estimateWordTimings, type VoiceWord } from '../../engine/index.ts';
import { TTS_ADAPTERS, firstAvailableAdapter, getTtsAdapter } from './index.ts';
import type { TtsAdapter } from './types.ts';

export interface SynthesizeVoiceOptions {
  text: string;
  adapterId?: string;
  lang?: string;
  /** Корень папки audio/: файл пишется в <audioDir>/tts/<sha1>.wav, в проект уходит путь tts/<sha1>.wav. */
  audioDir: string;
  force?: boolean;
  /** Разрешить скрытый тестовый адаптер 'fake': только проверки. */
  allowFake?: boolean;
}

export interface SynthesizeVoiceResult {
  file: string;
  durationSec: number;
  words: VoiceWord[];
  adapterId: string;
  cached: boolean;
  warnings: string[];
}

export class TtsError extends Error {}

/** Имя wav: один и тот же текст тем же голосом даёт тот же файл, смена голоса или текста — новый. */
export function voiceFileName(adapter: TtsAdapter, voice: string, lang: string, text: string): string {
  const key = [adapter.id, voice, lang, text].join('\n');
  return `${crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 12)}.wav`;
}

/** Длительность wav: у части контейнеров stream=duration пустой, тогда берём format=duration. */
export function audioDurationSec(file: string): number {
  let out: string;
  try {
    out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  } catch (error) {
    throw new TtsError(`ffprobe не прочитал ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const json = JSON.parse(out) as { streams?: Array<{ duration?: string }>; format?: { duration?: string } };
  const duration = Number(json.streams?.[0]?.duration ?? json.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new TtsError(`ffprobe не дал длительность файла ${file}`);
  return duration;
}

async function resolveAdapter(adapterId: string | undefined, allowFake: boolean): Promise<TtsAdapter> {
  if (adapterId) {
    const adapter = getTtsAdapter(adapterId);
    if (!adapter) throw new TtsError(`неизвестный адаптер «${adapterId}». Доступны: ${TTS_ADAPTERS.map((entry) => entry.id).join(', ')}`);
    if (adapter.hidden && !allowFake) throw new TtsError(`адаптер «${adapterId}» доступен только в проверках`);
    const result = await adapter.detect();
    if (!result.ok) throw new TtsError(`адаптер «${adapter.label}» недоступен: ${result.reason ?? 'причина не указана'}\nПодробности — docs/TTS.md`);
    return adapter;
  }
  const found = await firstAvailableAdapter();
  if (!found.adapter) {
    throw new TtsError(`ни один адаптер озвучки недоступен:\n${found.reasons.map((reason) => ` - ${reason}`).join('\n')}\nУкажите адаптер явно или настройте один из них; подробности — docs/TTS.md`);
  }
  return found.adapter;
}

/** Синтезировать текст в <audioDir>/tts и посчитать слова; существующий файл переиспользуется, если не force. */
export async function synthesizeVoice(options: SynthesizeVoiceOptions): Promise<SynthesizeVoiceResult> {
  const text = options.text.trim();
  if (!text) throw new TtsError('текст озвучки пуст');
  const lang = options.lang ?? 'ru';
  const adapter = await resolveAdapter(options.adapterId, options.allowFake === true);
  const voice = await adapter.voiceId({ lang });
  const file = `tts/${voiceFileName(adapter, voice, lang, text)}`;
  const outWav = path.join(options.audioDir, file);
  const cached = fs.existsSync(outWav);
  if (!cached || options.force) {
    fs.mkdirSync(path.dirname(outWav), { recursive: true });
    await adapter.synthesize(text, outWav, { lang });
  }
  const durationSec = audioDurationSec(outWav);
  return {
    file: file.split(path.sep).join('/'),
    durationSec,
    words: estimateWordTimings(text, durationSec),
    adapterId: adapter.id,
    cached: cached && options.force !== true,
    warnings: [],
  };
}
