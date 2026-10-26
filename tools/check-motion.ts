import { motionTransform, applyMotion, MOTION_PRESETS, validateMotion } from '../engine/motion.ts';
import type { Motion } from '../engine/motion.ts';
import { validateScene } from '../engine/validate.ts';

let errors = 0;
const fail = (msg: string) => { console.error('check:motion FAIL:', msg); errors++; };
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const H = 200;
const same = (a: ReturnType<typeof motionTransform>, b: ReturnType<typeof motionTransform>, eps = 1e-9) =>
  close(a.dx, b.dx, eps) && close(a.dy, b.dy, eps) && close(a.rot, b.rot, eps) && close(a.sx, b.sx, eps) && close(a.sy, b.sy, eps);
const periods: Record<string, number> = { walk: 0.7, run: 0.45, fly: 12, swim: 3.6, hop: 1.2, sway: 4 }; // общий период всех составляющих при speed=1

for (const preset of MOTION_PRESETS) {
  const m: Motion = { preset };
  // нулевая амплитуда: тождество
  const z = motionTransform({ preset, amp: 0 }, 1.234, H);
  if (!same(z, { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 })) fail(`${preset}: amp=0 не даёт тождество`);
  // периодичность
  for (const t of [0, 0.17, 0.9]) {
    if (!same(motionTransform(m, t, H), motionTransform(m, t + periods[preset], H), 1e-7)) fail(`${preset}: не периодичен на t=${t}`);
  }
  // независимость от порядка вызовов
  const a1 = motionTransform(m, 0.37, H);
  motionTransform(m, 5, H); motionTransform(m, 0.01, H);
  if (!same(a1, motionTransform(m, 0.37, H))) fail(`${preset}: результат зависит от предыдущих вызовов`);
  // фаза сдвигает время: phase=p равно t + p*период доминирующей составляющей (для sway и walk это единственный период)
  if (preset === 'sway' || preset === 'walk') {
    const T = periods[preset];
    if (!same(motionTransform({ preset, phase: 0.25 }, 0.3, H), motionTransform(m, 0.3 + 0.25 * T, H), 1e-7)) fail(`${preset}: phase работает неверно`);
  }
  // скорость: speed=2 вдвое быстрее
  if (!same(motionTransform({ preset, speed: 2 }, 0.2, H), motionTransform(m, 0.4, H), 1e-7)) fail(`${preset}: speed=2 не равен времени ×2`);
  // конечность
  for (const v of Object.values(motionTransform({ preset, speed: 4, amp: 3, phase: 1 }, 123.456, H))) if (!Number.isFinite(v)) fail(`${preset}: не конечное значение`);
}
// конкретные свойства
const hop0 = motionTransform({ preset: 'hop' }, 0.6, H); // u=0.5, вершина прыжка
if (!close(hop0.dy, -0.25 * H, 1e-9)) fail(`hop: высота прыжка ${hop0.dy}`);
if (!(motionTransform({ preset: 'hop' }, 0.06, H).sy < 1)) fail('hop: нет сжатия при приземлении');
if (!close(motionTransform({ preset: 'run', dir: -1 }, 0, H).rot, -6 * Math.PI / 180, 1e-9)) fail('run: dir=-1 должен наклонять назад');
if (!(motionTransform({ preset: 'fly' }, 0.25, H).sy < 1)) fail('fly: нет вертикального сжатия при взмахе');

// applyMotion: опора на низ [x, y, w, h]; для sway поворот вокруг нижней точки
{
  const calls: string[] = [];
  const g = { translate: (x: number, y: number) => calls.push(`t${x.toFixed(3)},${y.toFixed(3)}`), rotate: (a: number) => calls.push(`r${a.toFixed(4)}`), scale: (x: number, y: number) => calls.push(`s${x.toFixed(3)},${y.toFixed(3)}`) };
  applyMotion(g, { preset: 'sway' }, 1, [-50, -100, 100, 200]); // низ = y + h = 100
  if (calls[0] !== 't0.000,100.000' || calls[calls.length - 1] !== 't0.000,-100.000') fail(`applyMotion: pivot не на низу модели: ${calls.join(' ')}`);
  calls.length = 0;
  applyMotion(g, { preset: 'hop' }, 0.6, [-50, -100, 100, 200]); // вершина прыжка: dy = -0.25 * 200
  if (!calls[0].startsWith('t0.000,50.000')) fail(`applyMotion: высота берётся не из bounds[3]: ${calls[0]}`);
}

// валидация
const bad: unknown[] = [{ preset: 'dance' }, { preset: 'walk', speed: 9 }, { preset: 'walk', amp: -1 }, { preset: 'walk', phase: 2 }, { preset: 'walk', dir: 0 }, [], 'walk', null];
for (const b of bad) if (validateMotion(b, 'm').length === 0) fail(`валидатор пропустил ${JSON.stringify(b)}`);
for (const g of [{ preset: 'walk' }, [{ preset: 'walk' }, { preset: 'sway', amp: 0.5 }], { preset: 'hop', speed: 0.2, amp: 3, phase: 1, dir: -1 }]) {
  const v = validateMotion(g, 'm');
  if (v.length) fail(`валидатор отклонил ${JSON.stringify(g)}: ${JSON.stringify(v)}`);
}
// через validateScene: ошибка с понятным путём
const scene = {
  version: 1, title: 't', duration: 2, palette: { sky: ['#123', '#456'] }, camera: { keys: [] }, assets: {},
  layers: [{ id: 'l1', name: 'Слой', depth: 1, visible: true, objects: [{ id: 'o1', name: 'Фигура', kind: 'shape', params: { motion: { preset: 'dance' }, model: { bounds: [-10, -10, 10, 10], parts: [{ id: 'p', type: 'circle', cx: 0, cy: 0, r: 5, fill: '#fff' }] } } }] }],
};
const vr = validateScene(scene as never, {});
if (vr.ok || !vr.errors.some((e) => e.path.endsWith('params.motion.preset'))) fail('validateScene не указал путь params.motion.preset');
const okScene = JSON.parse(JSON.stringify(scene));
okScene.layers[0].objects[0].params.motion = { preset: 'walk' };
const vo = validateScene(okScene, {});
if (!vo.ok) fail(`корректная сцена с motion отклонена: ${JSON.stringify(vo.errors)}`);

console.log(errors === 0 ? 'check:motion OK' : `check:motion FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
