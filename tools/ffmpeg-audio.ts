// Сборка аргументов ffmpeg для export.ts: видео из stdin, при звуке — микс файлов из audio/.
import type { AudioPlanItem } from '../engine/audio-plan.ts';

const SAMPLE_RATE = 48000;
const FADE_SEC = 0.03;
const DUCK_THRESHOLD = 0.01;
const INPUT_HEAD = `aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;

/** Плановый предмет звука + то, что известно только экспортеру: путь и длительность файла. */
export interface AudioInputItem extends AudioPlanItem {
  /** Абсолютный путь к файлу звука. */
  filePath: string;
  /** Длительность файла в секундах по ffprobe. */
  durationSec: number;
  /** Только для музыки: приглушать под голосом. */
  duck?: boolean;
}

export interface FfmpegAudioOptions {
  items: AudioInputItem[];
  /** Длительность звуковой дорожки = длительность собираемого видео. */
  totalSec: number;
}

export interface FfmpegArgsOptions {
  width: number;
  height: number;
  fps: number;
  preset: string;
  crf: number;
  outFile: string;
  audio?: FfmpegAudioOptions;
}

const num = (value: number) => String(Math.round(value * 1000) / 1000);

/** Слышен ли предмет вообще в окне: файл может лежать целиком до его начала. */
export function isAudioItemAudible(item: AudioInputItem, totalSec: number): boolean {
  // музыка повторяется до конца дорожки, поэтому её слышно при любом смещении окна
  if (item.kind === 'music') return Math.max(0, item.startSec) < totalSec;
  const skip = Math.max(0, -item.startSec);
  return item.durationSec - skip > 0 && Math.max(0, item.startSec) < totalSec;
}

// Голос: atrim/asetpts, фейды по 30 мс, громкость, задержка старта. Музыка: повтор до конца дорожки.
function voiceChain(item: AudioInputItem, totalSec: number): string[] {
  const skip = Math.max(0, -item.startSec);
  const playStart = Math.max(0, item.startSec);
  const length = Math.min(item.durationSec - skip, totalSec - playStart);
  const chain = [INPUT_HEAD];
  if (skip > 0 || length < item.durationSec) chain.push(`atrim=start=${num(skip)}:end=${num(skip + length)}`);
  chain.push('asetpts=PTS-STARTPTS');
  chain.push(`afade=t=in:st=0:d=${FADE_SEC}`, `afade=t=out:st=${num(Math.max(0, length - FADE_SEC))}:d=${FADE_SEC}`);
  chain.push(`volume=${num(item.gain)}`, `adelay=delays=${Math.round(playStart * 1000)}:all=1`);
  return chain;
}

// Музыка идёт от нуля ролика и повторяется, если короче; в окне куска сдвигается на его старт,
// чтобы проба звучала как соответствующий кусок финального микса.
function musicChain(item: AudioInputItem, totalSec: number): string[] {
  const skip = Math.max(0, -item.startSec);
  const need = skip + totalSec;
  const chain = [INPUT_HEAD];
  if (item.durationSec < need) chain.push(`aloop=loop=-1:size=${Math.max(1, Math.round(item.durationSec * SAMPLE_RATE))}`);
  chain.push('asetpts=PTS-STARTPTS', `atrim=${num(skip)}:${num(need)}`);
  if (skip > 0) chain.push('asetpts=PTS-STARTPTS');
  chain.push(`volume=${num(item.gain)}`);
  return chain;
}

/** filter_complex для аудиодорожки: голоса в шину, музыка под неё, итог — loudnorm и ровная длина. */
export function buildAudioFilter(items: AudioInputItem[], totalSec: number): string {
  const graph: string[] = [];
  const voiceLabels: string[] = [];
  const musicLabels: { label: string; duck: boolean }[] = [];
  items.forEach((item, index) => {
    const source = `${index + 1}:a`;
    if (item.kind === 'music') {
      const label = `mu${index}`;
      graph.push(`[${source}]${musicChain(item, totalSec).join(',')}[${label}]`);
      musicLabels.push({ label, duck: item.duck !== false });
      return;
    }
    const label = `vo${index}`;
    graph.push(`[${source}]${voiceChain(item, totalSec).join(',')}[${label}]`);
    voiceLabels.push(label);
  });

  let voiceBus: string | null = null;
  if (voiceLabels.length === 1) voiceBus = voiceLabels[0];
  else if (voiceLabels.length > 1) {
    graph.push(`${voiceLabels.map((label) => `[${label}]`).join('')}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest[abus]`);
    voiceBus = 'abus';
  }

  const master = `loudnorm=I=-14:TP=-1.5:LRA=11,aresample=${SAMPLE_RATE},apad,atrim=0:${num(totalSec)}`;
  const music = musicLabels[0];
  const mixLabels: string[] = [];
  if (music && voiceBus && music.duck) {
    // sidechaincompress заканчивается вместе с сайдчейном, поэтому ветвь управления добивается тишиной до длины дорожки
    graph.push(`[${voiceBus}]asplit=2[sidechain][voice2]`);
    graph.push(`[sidechain]apad,atrim=0:${num(totalSec)}[sc]`);
    // детектор sidechaincompress читает уровень сайдчейна примерно на 19 дБ ниже реального:
    // при textbook threshold=0.05 голос глушил музыку лишь на 3 дБ, 0.01 даёт 15 дБ на замере
    graph.push(`[${music.label}][sc]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=8:attack=20:release=250[music]`);
    mixLabels.push('music', 'voice2');
  } else {
    if (music) mixLabels.push(music.label);
    if (voiceBus) mixLabels.push(voiceBus);
  }
  if (mixLabels.length > 1) {
    graph.push(`${mixLabels.map((label) => `[${label}]`).join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=longest,${master}[aout]`);
  } else if (mixLabels.length === 1) {
    graph.push(`[${mixLabels[0]}]${master}[aout]`);
  }
  return graph.join(';');
}

/** Без audio возвращает ровно те аргументы, что export.ts передавал до появления звука. */
export function buildFfmpegArgs(options: FfmpegArgsOptions): string[] {
  const args = [
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${options.width}x${options.height}`, '-r', String(options.fps), '-i', '-',
  ];
  const items = options.audio?.items ?? [];
  if (items.length === 0) {
    return [...args,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', options.preset, '-crf', String(options.crf),
      '-movflags', '+faststart', '-y', options.outFile];
  }
  for (const item of items) args.push('-i', item.filePath);
  return [...args,
    '-filter_complex', buildAudioFilter(items, options.audio!.totalSec),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', options.preset, '-crf', String(options.crf),
    '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE),
    '-movflags', '+faststart', '-y', options.outFile];
}
