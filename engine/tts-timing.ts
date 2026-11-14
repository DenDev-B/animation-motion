// Оценочные тайминги слов: делим длительность звука пропорционально «весу» слова, без анализа аудиосигнала.
import type { VoiceWord } from './project.ts';

/** Сколько веса (условных «букв») добавляет пауза после слова. */
const CLAUSE_PAUSE_WEIGHT = 2;
const SENTENCE_PAUSE_WEIGHT = 4;
/** Миллисекунда — минимальный шаг тайминга: слова не должны слипаться после округления. */
const MIN_STEP_SEC = 0.001;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

const isSoundChar = (char: string) => /[\p{L}\p{N}]/u.test(char);

// Пауза читается по последнему знаку токена: «, ; :» — внутрифразовая, «. ! ? …» — концевая.
function pauseWeight(word: string): number {
  const last = word[word.length - 1];
  if (last === ',' || last === ';' || last === ':') return CLAUSE_PAUSE_WEIGHT;
  if (last === '.' || last === '!' || last === '?' || last === '…') return SENTENCE_PAUSE_WEIGHT;
  return 0;
}

/**
 * Тайминг слов в секундах от начала файла озвучки.
 * Оценочный: длина слова по числу букв и цифр, а не выравнивание по звуку конкретной записи.
 */
export function estimateWordTimings(text: string, durationSec: number): VoiceWord[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];
  const weights = words.map((word) => Math.max(1, [...word].filter(isSoundChar).length) + pauseWeight(word));
  const scale = durationSec / weights.reduce((sum, weight) => sum + weight, 0);
  const bounds: number[] = [0];
  for (const weight of weights) {
    bounds.push(Math.max(round3(bounds[bounds.length - 1] + weight * scale), round3(bounds[bounds.length - 1] + MIN_STEP_SEC)));
  }
  bounds[bounds.length - 1] = round3(durationSec);
  // Длительность короче, чем по миллисекунде на слово: честных таймингов не получить.
  if (bounds[bounds.length - 1] <= bounds[bounds.length - 2]) return [];
  return words.map((word, index) => ({ w: word, t0: bounds[index], t1: bounds[index + 1] }));
}
