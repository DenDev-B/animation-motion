// Проход 1 громкости: измеряем «живую» часть дорожки без нормализации и считаем усиление мастер-шины.
// Идея: ebur128/loudnorm учитывают только звучащие участки (гейт), поэтому редкий звук надо поднимать
// на «цель − измеренная громкость», а не полагаться на динамический режим loudnorm в один проход.
import { spawn } from 'node:child_process';
import { buildMeasureFilter, GAIN_LIMIT_DB, LOUDNESS_TARGET_DB, PEAK_LIMIT, type AudioInputItem } from './ffmpeg-audio.ts';

/** Ниже этого порога дорожка считается пустой: поднимать нечего, только шум квантования. */
const SILENCE_FLOOR_DB = -60;
/** То, во что alimiter превращает линейный PEAK_LIMIT — та же цифра, что и в фильтре. */
const PEAK_LIMIT_DB = Math.round(20 * Math.log10(PEAK_LIMIT) * 10) / 10;

export interface LoudnormReport {
  inputI: number | null;
  inputTp: number | null;
}

export interface GainMeasurement {
  gainDb: number | null;
  inputI: number | null;
  inputTp: number | null;
  /** Готовая строка в лог экспорта: что измерено и что применено. */
  message: string;
}

const finite = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;

/** ffmpeg печатает JSON loudnorm в конце stderr; берём последний объект с input_i — до него бывает лог других фильтров. */
export function parseLoudnormReport(stderr: string): LoudnormReport {
  const blocks = stderr.match(/\{[^{}]*\}/g) ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    let reply: unknown;
    try {
      reply = JSON.parse(blocks[i]);
    } catch {
      continue;
    }
    if (!reply || typeof reply !== 'object') continue;
    const fields = reply as Record<string, unknown>;
    if (fields.input_i === undefined) continue;
    return { inputI: finite(fields.input_i), inputTp: finite(fields.input_tp) };
  }
  return { inputI: null, inputTp: null };
}

/** Насколько поднять мастер-шину; null — звука нет или он не измерился, нормализацию пропускаем. */
export function gainDbFrom(inputI: number | null): number | null {
  if (inputI === null || inputI < SILENCE_FLOOR_DB) return null;
  return Math.min(GAIN_LIMIT_DB, Math.max(-GAIN_LIMIT_DB, LOUDNESS_TARGET_DB - inputI));
}

export function buildMeasureArgs(items: AudioInputItem[], totalSec: number): string[] {
  const args = ['-nostats'];
  for (const item of items) args.push('-i', item.filePath);
  return [...args, '-filter_complex', buildMeasureFilter(items, totalSec), '-map', '[aout]', '-f', 'null', '-'];
}

/** Прогон только звука через null-выход: кадры не рендерятся, поэтому проход стоит доли секунды. */
export async function measureAudioGain(items: AudioInputItem[], totalSec: number): Promise<GainMeasurement> {
  const stderr = await runFfmpeg(buildMeasureArgs(items, totalSec));
  const { inputI, inputTp } = parseLoudnormReport(stderr);
  const gainDb = gainDbFrom(inputI);
  if (gainDb === null || inputI === null) {
    return { gainDb: null, inputI, inputTp, message: 'громкость: звук пустой, нормализация пропущена' };
  }
  const peak = inputTp === null ? 'пик не измерен' : `пик ${signed(inputTp)} dBTP`;
  const limited = gainDb === LOUDNESS_TARGET_DB - inputI ? '' : `, предел ±${GAIN_LIMIT_DB} дБ сработал`;
  return {
    gainDb,
    inputI,
    inputTp,
    message: `громкость: измерено ${signed(inputI)} LUFS (${peak}) → усиление ${signed(gainDb)} дБ${limited}, пики ограничены ${signed(PEAK_LIMIT_DB)} dBTP`,
  };
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (e) => reject(new Error(`ffmpeg не запустился: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`проход измерения громкости завершился с кодом ${code}: ${stderr.slice(-400)}`));
    });
  });
}
