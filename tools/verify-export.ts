// Приёмка MP4 через ffprobe: измеряемые свойства файла, без просмотра глазами.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  sample_rate?: string;
  duration?: string;
}

interface ProbeReply {
  streams?: ProbeStream[];
  frames?: Array<{ best_effort_timestamp_time?: string }>;
  format?: { duration?: string };
}

function log(m: string) { process.stdout.write(m + '\n'); }
function fail(m: string): never { log(`ОШИБКА: ${m}`); process.exit(1); }

const AUDIO_SAMPLE_RATE = '48000';
const AUDIO_DURATION_TOLERANCE = 0.1;
const LOUDNESS_TARGET = -14;
const LOUDNESS_TOLERANCE = 2;
const SILENCE_FLOOR_DB = -60;
const SILENCE_MIN_SEC = 0.05;

function parseArgs(): { file: string; width: number; height: number; fps: number; duration: number; expectAudio: boolean } {
  let expectAudio = false;
  const rest: string[] = [];
  for (const arg of process.argv.slice(2)) {
    if (arg === '--expect-audio') expectAudio = true;
    else if (arg.startsWith('-')) fail('использование: node tools/verify-export.ts <file.mp4> <width> <height> <fps> <duration> [--expect-audio]');
    else rest.push(arg);
  }
  const [file, width, height, fps, duration] = rest;
  const numbers = [width, height, fps, duration];
  if (!file || numbers.some((v) => v === undefined || !Number.isFinite(Number(v)) || Number(v) <= 0)) {
    fail('использование: node tools/verify-export.ts <file.mp4> <width> <height> <fps> <duration> [--expect-audio]');
  }
  if (!fs.existsSync(file)) fail(`нет файла ${file}`);
  return { file, width: Number(width), height: Number(height), fps: Number(fps), duration: Number(duration), expectAudio };
}

function probe(file: string, entries: string, select?: string): ProbeReply {
  const args = ['-v', 'error'];
  if (select) args.push('-select_streams', select);
  args.push('-show_entries', entries, '-of', 'json', file);
  try {
    return JSON.parse(execFileSync('ffprobe', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as ProbeReply;
  } catch (e) {
    fail(`ffprobe не удался: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function rate(value: string | undefined): number {
  if (!value) return NaN;
  const [n, d = '1'] = value.split('/');
  const den = Number(d);
  return den > 0 ? Number(n) / den : NaN;
}

// ebur128 и silencedetect пишут измерения в stderr ffmpeg — отсюда их и берём.
function audioFilterLog(file: string, filter: string): string {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', filter, '-f', 'null', '-'], { encoding: 'utf8' });
  if (run.status !== 0) fail(`ffmpeg -af ${filter} завершился с кодом ${run.status}: ${(run.stderr ?? '').slice(-500)}`);
  return run.stderr ?? '';
}

// Сколько секунд дорожки silencedetect объявил тишиной: пары start/end плюс незакрытый хвост до конца файла.
function silencedSeconds(log: string, duration: number): number {
  let total = 0;
  let open: number | null = null;
  for (const match of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const at = Math.min(Math.max(Number(match[2]), 0), duration);
    if (match[1] === 'start') open = at;
    else if (open !== null) {
      total += at - open;
      open = null;
    }
  }
  if (open !== null) total += duration - open;
  return Math.min(total, duration);
}

function integratedLoudness(log: string): number | null {
  const match = /Summary:[\s\S]*?I:\s*(-?[\d.]+|-inf) LUFS/.exec(log);
  if (!match) return null;
  return Number.isFinite(Number(match[1])) ? Number(match[1]) : null;
}

function durationOf(stream: ProbeStream | undefined, reply: ProbeReply, fallback: number): number {
  const streamSec = Number(stream?.duration);
  if (Number.isFinite(streamSec) && streamSec > 0) return streamSec;
  const formatSec = Number(reply.format?.duration);
  return Number.isFinite(formatSec) && formatSec > 0 ? formatSec : fallback;
}

// faststart: moov должен лежать до mdat. null — структуру разобрать не удалось.
function faststart(file: string): boolean | null {
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const header = Buffer.alloc(8);
    let offset = 0;
    let moov = -1;
    let mdat = -1;
    while (offset + 8 <= total) {
      if (fs.readSync(fd, header, 0, 8, offset) < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (boxSize === 1) {
        if (fs.readSync(fd, header, 0, 8, offset + 8) < 8) break;
        boxSize = Number(header.readBigUInt64BE(0));
      } else if (boxSize === 0) {
        boxSize = total - offset;
      }
      if (type === 'moov' && moov < 0) moov = offset;
      if (type === 'mdat' && mdat < 0) mdat = offset;
      if (moov >= 0 && mdat >= 0) return moov < mdat;
      if (boxSize < 8) break;
      offset += boxSize;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function main() {
  const args = parseArgs();
  const reply = probe(args.file, 'stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,duration:format=duration');
  const streams = reply.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) fail('в файле нет видеодорожки');

  log(`MP4: ${args.file} — ожидание ${args.width}x${args.height}, ${args.fps} fps, ${args.duration} с`);
  const results: boolean[] = [];
  const check = (ok: boolean, label: string) => { results.push(ok); log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };

  check(video.codec_name === 'h264', `кодек видео: ${video.codec_name ?? '?'}, ожидался h264`);
  check(video.pix_fmt === 'yuv420p', `формат пикселей: ${video.pix_fmt ?? '?'}, ожидался yuv420p`);
  check(video.width === args.width && video.height === args.height, `разрешение: ${video.width}x${video.height}, ожидалось ${args.width}x${args.height}`);
  const r = rate(video.r_frame_rate);
  const avg = rate(video.avg_frame_rate);
  check(Math.abs(r - args.fps) < 1e-6 && Math.abs(avg - r) < 1e-6, `постоянный fps: r=${video.r_frame_rate ?? '?'} avg=${video.avg_frame_rate ?? '?'}, ожидался ${args.fps}`);

  const frames = probe(args.file, 'frame=best_effort_timestamp_time', 'v:0').frames ?? [];
  const expectedFrames = Math.round(args.duration * args.fps);
  const count = video.nb_frames === undefined ? frames.length : Number(video.nb_frames);
  check(count === expectedFrames, `число кадров: ${count}, ожидалось ${expectedFrames} = round(${args.duration} * ${args.fps})`);

  const times = frames.map((f) => Number(f.best_effort_timestamp_time)).filter((v) => Number.isFinite(v));
  const step = 1 / args.fps;
  let maxDeviation = 0;
  for (let i = 1; i < times.length; i++) maxDeviation = Math.max(maxDeviation, Math.abs(times[i] - times[i - 1] - step));
  check(times.length === count && maxDeviation <= 0.001, `равномерность timestamps: ${times.length} кадров, макс. отклонение ${(maxDeviation * 1000).toFixed(3)} мс при допуске 1 мс`);

  const start = faststart(args.file);
  if (start === null) log('пропущено faststart: структуру MP4 разобрать не удалось');
  else check(start, `faststart: moov ${start ? 'до' : 'после'} mdat`);

  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  const audioNames = audioStreams.map((s) => `${s.codec_name ?? '?'}${s.sample_rate ? ` ${s.sample_rate} Гц` : ''}`).join(', ');
  if (!args.expectAudio) {
    log(audioStreams.length ? `аудиодорожка: ${audioNames} — без --expect-audio звук не проверяем` : 'аудиодорожки нет (без --expect-audio это не ошибка)');
  } else {
    const audio = audioStreams[0];
    if (!audio) fail('аудиодорожка ожидалась (--expect-audio), в файле её нет');
    check(audio.codec_name === 'aac', `кодек аудио: ${audio.codec_name ?? '?'}, ожидался aac`);
    check(audio.sample_rate === AUDIO_SAMPLE_RATE, `частота дискретизации аудио: ${audio.sample_rate ?? '?'}, ожидалась ${AUDIO_SAMPLE_RATE}`);
    const videoSec = durationOf(video, reply, args.duration);
    const audioSec = durationOf(audio, reply, videoSec);
    const delta = Math.abs(audioSec - videoSec);
    check(delta <= AUDIO_DURATION_TOLERANCE, `длительность аудио ${audioSec.toFixed(3)} с против видео ${videoSec.toFixed(3)} с: расхождение ${delta.toFixed(3)} с при допуске ${AUDIO_DURATION_TOLERANCE} с`);
    const silent = silencedSeconds(audioFilterLog(args.file, `silencedetect=noise=${SILENCE_FLOOR_DB}dB:duration=${SILENCE_MIN_SEC}`), audioSec);
    if (audioSec - silent <= SILENCE_MIN_SEC) {
      log(`ok  громкость пропущена: тишина покрывает ${silent.toFixed(2)} с из ${audioSec.toFixed(2)} с — дорожка пустая`);
    } else {
      const lufs = integratedLoudness(audioFilterLog(args.file, 'ebur128'));
      const measured = lufs === null ? 'не измерена' : `${lufs.toFixed(1)} LUFS`;
      check(lufs !== null && Math.abs(lufs - LOUDNESS_TARGET) <= LOUDNESS_TOLERANCE, `интегральная громкость: ${measured}, ожидание ${LOUDNESS_TARGET} ±${LOUDNESS_TOLERANCE} LUFS (звук есть: ${audioSec.toFixed(2)} с дорожки, тишины ${silent.toFixed(2)} с)`);
    }
  }
  log(args.expectAudio ? 'Не проверяется: плавность глазами, разборчивость и баланс звука на слух, цвет.' : 'Не проверяется: плавность глазами, слышимость звука, цвет.');

  const failed = results.filter((ok) => !ok).length;
  log(failed ? `ИТОГ: FAIL (${failed} из ${results.length})` : `ИТОГ: OK (${results.length} пунктов)`);
  process.exit(failed ? 1 : 0);
}

try { main(); } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
