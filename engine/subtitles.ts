import { buildAudioPlan } from './audio-plan.ts';
import { projectFrameCount, type ProjectSubtitlesV1, type ProjectV1, type VoiceWord } from './project.ts';
import { SAFE_ZONES } from './spec.ts';
import { TEXT_FONT_FAMILY } from './kinds-text.ts';

export interface SubtitleCue {
  t0: number;
  t1: number;
  text: string;
}

export interface SubtitleBuildResult {
  cues: SubtitleCue[];
  /** Индексы сцен, у которых есть voice.text, но нет voice.words. */
  missingWords: number[];
}

const PHRASE_END = /[.!?…]$/;
const MAX_WIDTH_FRACTION = 0.9;
const MIN_FONT_FRACTION = 0.6;
const LINE_HEIGHT = 1.2;

export function defaultSubtitleSize(format: '16:9' | '9:16'): number {
  return format === '9:16' ? 0.045 : 0.055;
}

function clampWords(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3;
  return Math.min(6, Math.max(1, Math.round(value)));
}

/** Реплики из voice.words: слова группируются до maxWords, фраза рвётся на . ! ? …; время — таймлайн проекта. */
export function buildSubtitleCues(project: ProjectV1): SubtitleBuildResult {
  const missingWords: number[] = [];
  const maxWords = clampWords(project.subtitles?.maxWords);
  const upper = project.subtitles?.upper === true;
  const totalSec = projectFrameCount(project) / project.fps;
  const voiceStarts = new Map<number, number>();
  for (const item of buildAudioPlan(project).items) {
    if (item.kind === 'voice' && item.sceneIndex !== undefined && !voiceStarts.has(item.sceneIndex)) {
      voiceStarts.set(item.sceneIndex, item.startSec);
    }
  }

  const cues: SubtitleCue[] = [];
  project.scenes.forEach((entry, sceneIndex) => {
    const voice = entry.voice;
    const words = voice?.words ?? [];
    if ((voice?.text ?? '').trim() && words.length === 0) missingWords.push(sceneIndex);
    if (!voice?.file || words.length === 0) return;
    const startSec = voiceStarts.get(sceneIndex);
    if (startSec === undefined) return;

    let group: VoiceWord[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const first = group[0];
      const last = group[group.length - 1];
      const text = group.map((word) => word.w).join(' ');
      group = [];
      const t0 = Math.max(0, startSec + first.t0);
      const t1 = Math.min(totalSec, startSec + last.t1);
      if (t1 <= t0) return;
      cues.push({ t0, t1, text: upper ? text.toUpperCase() : text });
    };
    for (const word of words) {
      group.push(word);
      if (group.length >= maxWords || PHRASE_END.test(word.w.trim())) flush();
    }
    flush();
  });

  cues.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  return { cues, missingWords };
}

/** Реплика на моменте t: t0 включительно, t1 не включительно. */
export function activeCueAt(cues: readonly SubtitleCue[], t: number): SubtitleCue | null {
  if (!Number.isFinite(t)) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].t0 <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Перекрытие сцен при переходе может дать две активные реплики; ищем назад по началам.
  for (let index = found; index >= 0; index--) {
    const cue = cues[index];
    if (cue.t0 <= t && t < cue.t1) return cue;
  }
  return null;
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000) % 60;
  const secs = Math.floor(ms / 1000) % 60;
  return `${two(hours)}:${two(minutes)}:${two(secs)},${String(ms % 1000).padStart(3, '0')}`;
}

/** SRT: нумерация с 1, пустая строка между репликами, файл заканчивается переводом строки. */
export function formatSrt(cues: readonly SubtitleCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.t0)} --> ${srtTime(cue.t1)}\n${cue.text}\n\n`).join('');
}

function wrapTwoLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text];
  let best: [string, string] = [text, ''];
  let bestWidth = Infinity;
  for (let split = 1; split < words.length; split++) {
    const left = words.slice(0, split).join(' ');
    const right = words.slice(split).join(' ');
    const width = Math.max(ctx.measureText(left).width, ctx.measureText(right).width);
    if (width < bestWidth) {
      bestWidth = width;
      best = [left, right];
    }
  }
  return [best[0], best[1]];
}

/** Реплика на итоговом кадре: по центру, с обводкой и тенью, внутри безопасных зон площадки. */
export function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cue: SubtitleCue,
  style: ProjectSubtitlesV1 | undefined,
  format: '16:9' | '9:16',
): void {
  if (!cue.text.trim()) return;
  const zone = SAFE_ZONES[format];
  const k = h / 1000;
  const initial = Math.max(1, (style?.size ?? defaultSubtitleSize(format)) * h);
  const safeWidth = w - (zone.left + zone.right) * k;
  const maxWidth = Math.min(w * MAX_WIDTH_FRACTION, safeWidth);
  const font = (px: number) => `700 ${px}px ${TEXT_FONT_FAMILY}`;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(initial);

  let px = initial;
  while (px > initial * MIN_FONT_FRACTION && ctx.measureText(cue.text).width > maxWidth) {
    px = Math.max(initial * MIN_FONT_FRACTION, px - Math.max(1, initial * 0.05));
    ctx.font = font(px);
  }
  let lines = [cue.text];
  if (ctx.measureText(cue.text).width > maxWidth) lines = wrapTwoLines(ctx, cue.text, maxWidth);

  const lineHeight = px * LINE_HEIGHT;
  const topBoundary = zone.top * k;
  const bottomBoundary = h - zone.bottom * k;
  const position = style?.position ?? 'bottom';
  const centers: number[] = [];
  if (position === 'top') {
    for (let i = 0; i < lines.length; i++) centers.push(topBoundary + lineHeight * (i + 0.5));
  } else if (position === 'center') {
    const first = h / 2 - (lineHeight * (lines.length - 1)) / 2;
    for (let i = 0; i < lines.length; i++) centers.push(first + lineHeight * i);
  } else {
    for (let i = 0; i < lines.length; i++) centers.push(bottomBoundary - lineHeight * (lines.length - i - 0.5));
  }

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(1, px * 0.12);
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = px * 0.08;
  ctx.shadowOffsetY = position === 'bottom' ? -px * 0.06 : position === 'top' ? px * 0.06 : 0;
  lines.forEach((line, index) => {
    const y = centers[index];
    ctx.strokeText(line, w / 2, y);
    ctx.fillText(line, w / 2, y);
  });
  ctx.restore();
}
