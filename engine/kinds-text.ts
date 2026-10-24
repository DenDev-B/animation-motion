import type { RenderCache } from './kinds.ts';
import { clamp, EASE } from './math.ts';
import { col } from './color.ts';

export const TEXT_FONT_FAMILY = 'sans-serif';

function num(p: Record<string, unknown>, key: string, fallback: number): number {
  const value = p[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(p: Record<string, unknown>, key: string, fallback: string): string {
  const value = p[key];
  return typeof value === 'string' ? value : fallback;
}

export function counterValue(p: Record<string, unknown>, t: number): string {
  const from = num(p, 'from', 0);
  const to = num(p, 'to', 1000);
  const t0 = num(p, 't0', 0);
  const t1 = num(p, 't1', 1);
  const easeName = str(p, 'ease', 'inOut') as keyof typeof EASE;
  const ease = EASE[easeName] ?? EASE.inOut;
  const k = t1 > t0 ? clamp((t - t0) / (t1 - t0)) : (t >= t1 ? 1 : 0);
  const value = from + (to - from) * ease(k);
  const decimals = Math.max(0, Math.min(4, Math.round(num(p, 'decimals', 0))));
  const fixed = Math.abs(value).toFixed(decimals);
  const [integer, fraction] = fixed.split('.');
  const separator = str(p, 'thousands', ' ');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  const body = `${value < 0 && Number(fixed) !== 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
  return `${str(p, 'prefix', '')}${body}${str(p, 'suffix', '')}`;
}

interface TextStyle {
  size: number;
  weight: number;
  align: CanvasTextAlign;
  color: string;
  stroke: number;
  strokeColor: string;
  shadow: number;
  lineHeight: number;
  maxWidth: number | undefined;
}

function textStyle(p: Record<string, unknown>, pal: Record<string, unknown>): TextStyle {
  const alignRaw = str(p, 'align', 'center');
  const align: CanvasTextAlign = alignRaw === 'left' || alignRaw === 'right' ? alignRaw : 'center';
  const maxWidth = p.maxWidth;
  return {
    size: num(p, 'size', 64),
    weight: num(p, 'weight', 700) === 400 ? 400 : 700,
    align,
    color: col(str(p, 'color', '#ffffff'), pal),
    stroke: clamp(num(p, 'stroke', 0), 0, 20),
    strokeColor: col(str(p, 'strokeColor', '#000000'), pal),
    shadow: clamp(num(p, 'shadow', 0), 0, 30),
    lineHeight: num(p, 'lineHeight', 1.2),
    maxWidth: typeof maxWidth === 'number' && Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : undefined,
  };
}

function layoutLines(g: CanvasRenderingContext2D, text: string, maxWidth: number | undefined): string[] {
  if (!maxWidth) return text.split('\n');
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && g.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function drawLines(g: CanvasRenderingContext2D, lines: string[], style: TextStyle): void {
  const lineHeight = style.size * style.lineHeight;
  const top = -((lines.length - 1) * lineHeight) / 2;
  g.textAlign = style.align;
  g.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    const y = top + i * lineHeight;
    if (style.shadow > 0) {
      g.shadowBlur = style.shadow;
      g.shadowColor = 'rgba(0, 0, 0, 0.55)';
      g.fillStyle = style.color;
      g.fillText(lines[i], 0, y);
      g.shadowBlur = 0;
      g.shadowColor = 'rgba(0, 0, 0, 0)';
    }
    if (style.stroke > 0) {
      g.lineWidth = style.stroke;
      g.strokeStyle = style.strokeColor;
      g.strokeText(lines[i], 0, y);
    }
    g.fillStyle = style.color;
    g.fillText(lines[i], 0, y);
  }
}

function applyFont(g: CanvasRenderingContext2D, style: TextStyle): void {
  g.font = `${style.weight} ${style.size}px ${TEXT_FONT_FAMILY}`;
}

export function drawText(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>): void {
  const style = textStyle(p, pal);
  applyFont(g, style);
  drawLines(g, layoutLines(g, str(p, 'text', ''), style.maxWidth), style);
}

export function drawCounter(g: CanvasRenderingContext2D, p: Record<string, unknown>, pal: Record<string, unknown>, t: number): void {
  const style = textStyle(p, pal);
  applyFont(g, style);
  drawLines(g, layoutLines(g, counterValue(p, t), style.maxWidth), style);
}
