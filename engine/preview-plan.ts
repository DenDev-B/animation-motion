// Лесенка предпросмотра: кадр / кусок / всё, плюс уменьшенный масштаб.
// Чистая функция: по длине ролика, fps, формату и запросу считает, какие кадры и в каком размере рендерить.
// Без Math.random/Date.now: результат зависит только от входа.

export type Aspect = '16:9' | '9:16';

export const PREVIEW_SCALES = [0.25, 0.5, 1] as const;

export interface PreviewRequest {
  /** Один кадр в момент t (секунды). Взаимоисключимо с range. */
  frame?: number;
  /** Кусок [from, to) в секундах. По умолчанию весь ролик. */
  range?: { from: number; to: number };
  /** Масштаб размера кадра: 0.25, 0.5 или 1 (по умолчанию 1). */
  scale?: number;
}

export interface PreviewPlan {
  mode: 'frame' | 'clip' | 'all';
  /** Первый глобальный индекс кадра. */
  startFrame: number;
  /** Сколько кадров. Для mode=frame всегда 1. */
  count: number;
  width: number;
  height: number;
  scale: number;
}

export type PreviewPlanResult = { ok: true; plan: PreviewPlan } | { ok: false; message: string };

const BASE_HEIGHT = 1080;

/** Размер полного кадра: 1920x1080 или 1080x1920. */
export function baseSize(aspect: Aspect): { width: number; height: number } {
  return aspect === '16:9' ? { width: 1920, height: BASE_HEIGHT } : { width: BASE_HEIGHT, height: 1920 };
}

/** Размер с учётом масштаба; стороны чётные, иначе yuv420p/h264 не соберётся. */
export function scaledSize(aspect: Aspect, scale: number): { width: number; height: number } {
  const base = baseSize(aspect);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(base.width * scale), height: even(base.height * scale) };
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param totalFrames сколько кадров во всём ролике (для проекта это projectFrameCount)
 * @param fps частота кадров ролика
 */
export function planPreview(totalFrames: number, fps: number, aspect: Aspect, req: PreviewRequest = {}): PreviewPlanResult {
  if (!Number.isInteger(totalFrames) || totalFrames < 1) return { ok: false, message: 'в ролике нет кадров' };
  if (!isNum(fps) || fps <= 0) return { ok: false, message: 'fps должен быть больше 0' };
  const scale = req.scale ?? 1;
  if (!(PREVIEW_SCALES as readonly number[]).includes(scale)) {
    return { ok: false, message: `масштаб ${scale} не поддерживается; допустимо: ${PREVIEW_SCALES.join(', ')}` };
  }
  if (req.frame !== undefined && req.range !== undefined) return { ok: false, message: 'укажите либо кадр, либо кусок, но не оба сразу' };
  const { width, height } = scaledSize(aspect, scale);
  const duration = totalFrames / fps;

  if (req.frame !== undefined) {
    if (!isNum(req.frame) || req.frame < 0 || req.frame >= duration) {
      return { ok: false, message: `кадр t=${req.frame} вне ролика (0 ≤ t < ${duration.toFixed(3)} с)` };
    }
    const index = Math.min(totalFrames - 1, Math.round(req.frame * fps));
    return { ok: true, plan: { mode: 'frame', startFrame: index, count: 1, width, height, scale } };
  }

  if (req.range !== undefined) {
    const { from, to } = req.range;
    if (!isNum(from) || !isNum(to) || from < 0 || to <= from) return { ok: false, message: `некорректный кусок ${from}:${to}; нужно 0 ≤ от < до` };
    if (to > duration + 1e-9) return { ok: false, message: `кусок заканчивается на ${to} с, а ролик длится ${duration.toFixed(3)} с` };
    const startFrame = Math.round(from * fps);
    const end = Math.min(totalFrames, Math.round(to * fps));
    if (end <= startFrame) return { ok: false, message: `кусок ${from}:${to} короче одного кадра при ${fps} fps` };
    return { ok: true, plan: { mode: 'clip', startFrame, count: end - startFrame, width, height, scale } };
  }

  return { ok: true, plan: { mode: 'all', startFrame: 0, count: totalFrames, width, height, scale } };
}

/** Имя-хвост для файла, чтобы пробы не затирали полный экспорт: "", "_x0.5", "_clip2-6", "_frame3.5". */
export function previewSuffix(plan: PreviewPlan, fps: number): string {
  const parts: string[] = [];
  if (plan.mode === 'frame') parts.push(`frame${(plan.startFrame / fps).toFixed(2)}`);
  else if (plan.mode === 'clip') parts.push(`clip${(plan.startFrame / fps).toFixed(2)}-${((plan.startFrame + plan.count) / fps).toFixed(2)}`);
  if (plan.scale !== 1) parts.push(`x${plan.scale}`);
  return parts.length ? `_${parts.join('_')}` : '';
}
