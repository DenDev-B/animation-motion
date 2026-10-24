import type { TransitionDir, TransitionType } from './project.ts';

export interface ComposeSize { w: number; h: number; }
export interface ComposeOptions { color?: string; dir?: TransitionDir; }

function reset(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function fill(ctx: CanvasRenderingContext2D, size: ComposeSize, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size.w, size.h);
}

export function composeFrame(
  ctxOut: CanvasRenderingContext2D,
  ctxA: CanvasRenderingContext2D,
  ctxB: CanvasRenderingContext2D,
  kind: TransitionType,
  progress: number,
  size: ComposeSize,
  options: ComposeOptions = {},
): void {
  const p = Math.min(1, Math.max(0, progress));
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * p);
  reset(ctxOut);
  if (kind === 'cut') {
    ctxOut.drawImage((p < 0.5 ? ctxA : ctxB).canvas, 0, 0);
    return;
  }
  if (p === 0) { ctxOut.drawImage(ctxA.canvas, 0, 0); return; }
  if (p === 1) { ctxOut.drawImage(ctxB.canvas, 0, 0); return; }

  if (kind === 'crossfade') {
    ctxOut.clearRect(0, 0, size.w, size.h);
    ctxOut.globalAlpha = 1 - eased;
    ctxOut.drawImage(ctxA.canvas, 0, 0);
    ctxOut.globalCompositeOperation = 'lighter';
    ctxOut.globalAlpha = eased;
    ctxOut.drawImage(ctxB.canvas, 0, 0);
    reset(ctxOut);
    return;
  }

  if (kind === 'fade' || kind === 'dip') {
    const color = options.color ?? '#000';
    if (p <= 0.5) {
      ctxOut.drawImage(ctxA.canvas, 0, 0);
      ctxOut.globalAlpha = Math.min(1, eased * 2);
      fill(ctxOut, size, color);
    } else {
      fill(ctxOut, size, color);
      ctxOut.globalAlpha = Math.max(0, (eased - 0.5) * 2);
      ctxOut.drawImage(ctxB.canvas, 0, 0);
    }
    reset(ctxOut);
    return;
  }

  if (kind === 'slide') {
    const dir = options.dir ?? 'left';
    const shift = dir === 'left' ? [-size.w * eased, size.w * (1 - eased)] : dir === 'right' ? [size.w * eased, -size.w * (1 - eased)] : [0, 0];
    const vertical = dir === 'up' ? [-size.h * eased, size.h * (1 - eased)] : dir === 'down' ? [size.h * eased, -size.h * (1 - eased)] : [0, 0];
    const ax = shift[0], bx = shift[1], ay = vertical[0], by = vertical[1];
    ctxOut.drawImage(ctxA.canvas, ax, ay);
    ctxOut.drawImage(ctxB.canvas, bx, by);
    return;
  }

  const dir = options.dir ?? 'left';
  ctxOut.drawImage(ctxA.canvas, 0, 0);
  ctxOut.save();
  ctxOut.beginPath();
  if (dir === 'left') ctxOut.rect(size.w * (1 - eased), 0, size.w * eased, size.h);
  else if (dir === 'right') ctxOut.rect(0, 0, size.w * eased, size.h);
  else if (dir === 'up') ctxOut.rect(0, size.h * (1 - eased), size.w, size.h * eased);
  else ctxOut.rect(0, 0, size.w, size.h * eased);
  ctxOut.clip();
  ctxOut.drawImage(ctxB.canvas, 0, 0);
  ctxOut.restore();
}
