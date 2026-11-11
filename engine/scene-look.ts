// Образ сцены одной командой: применить стиль (палитра + зерно + виньетка + эффекты кадра) и выбрать приём камеры.
// Чистые функции: вход не меняется, результат новый. Без DOM и файлов.
import type { CameraShot, SceneV1 } from './schema.ts';
import { CAMERA_SHOT_NAMES } from './camera-presets.ts';
import { getStyle, STYLE_MOODS, STYLE_PRESETS, type StyleMood } from './styles.ts';

export type LookResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Применяет стиль к сцене. Меняются palette (слоты стиля и небо), style.{preset, grain, vignette, grade, bloom, depthHaze}.
 * Слои, объекты, камера и анимации не трогаются. Объекты с цветом hex в params не перекрашиваются:
 * перекрашиваются только те, что берут цвет из слотов палитры.
 * Прежние эффекты кадра (grade, bloom, depthHaze) убираются, чтобы стиль не складывался со старым.
 */
export function applySceneStyle(scene: SceneV1, styleId: string, mood: StyleMood): LookResult<SceneV1> {
  const preset = getStyle(styleId);
  if (!preset) return { ok: false, message: `неизвестный стиль «${styleId}»; доступные: ${STYLE_PRESETS.map((p) => p.id).join(', ')}` };
  if (!STYLE_MOODS.includes(mood)) return { ok: false, message: `неизвестное настроение «${mood}»; доступные: ${STYLE_MOODS.join(', ')}` };
  const next = structuredClone(scene);
  const palette = preset.palettes[mood];
  next.palette = { ...next.palette, ...structuredClone(palette) };
  const { grade: _grade, bloom: _bloom, depthHaze: _haze, ...keep } = next.style ?? {};
  next.style = { ...keep, preset: preset.id, grain: preset.grain, vignette: preset.vignette, ...structuredClone(preset.effects ?? {}) };
  return { ok: true, value: next };
}

export interface ShotChange { scene: SceneV1; droppedKeys: number }

/**
 * Ставит готовый приём камеры. shot работает только при пустых camera.keys, поэтому ключи удаляются;
 * сколько их было, возвращается в droppedKeys (интерфейс предупреждает владельца). shot=null убирает приём, ключи не трогает.
 */
export function setSceneShot(scene: SceneV1, shot: CameraShot | null): LookResult<ShotChange> {
  const next = structuredClone(scene);
  if (shot === null) {
    const { shot: _removed, ...rest } = next.camera;
    next.camera = rest;
    return { ok: true, value: { scene: next, droppedKeys: 0 } };
  }
  if (!(CAMERA_SHOT_NAMES as readonly string[]).includes(shot.name)) return { ok: false, message: `неизвестный приём «${shot.name}»; доступные: ${CAMERA_SHOT_NAMES.join(', ')}` };
  if (shot.strength !== undefined && !(shot.strength >= 0.1 && shot.strength <= 3)) return { ok: false, message: 'strength должен быть числом от 0.1 до 3' };
  if (shot.t0 !== undefined && !(shot.t0 >= 0 && shot.t0 < scene.duration)) return { ok: false, message: `t0 должен быть от 0 до ${scene.duration} (длительность сцены)` };
  if (shot.duration !== undefined && !(shot.duration > 0)) return { ok: false, message: 'duration должен быть больше нуля' };
  const droppedKeys = next.camera.keys.length;
  next.camera = { ...next.camera, keys: [], shot: { ...shot } };
  return { ok: true, value: { scene: next, droppedKeys } };
}
