import { ANIM_SPEC, KIND_SPEC, PALETTE_SLOTS, SPEC_KEYS } from './spec.ts';

export interface ValidateOpts { catalogIds?: string[]; }
export interface ValidationError { path: string; message: string; }
export interface ValidationResult { ok: boolean; errors: ValidationError[]; warnings: ValidationError[]; }

const HEX_RE = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isColor = (value: unknown): value is string => typeof value === 'string' && HEX_RE.test(value);
const isSlotOrColor = (value: unknown, palette?: Record<string, unknown>): boolean => isColor(value) || (typeof value === 'string' && (palette?.[value] !== undefined || PALETTE_SLOTS.includes(value as typeof PALETTE_SLOTS[number])));
const PATH_TYPES = ['path', 'line', 'circle'];

function fieldError(path: string, label: string, allowed: string, example: string): ValidationError {
  return { path, message: `${label} не соответствует типу или диапазону; допустимо: ${allowed}; пример: ${example}` };
}

function checkUnknown(value: Record<string, unknown>, keys: readonly string[], path: string, warnings: ValidationError[]) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) warnings.push({ path: path ? `${path}.${key}` : key, message: 'неизвестное поле; сохранено без изменений' });
}

function validateField(value: unknown, field: { name: string; type: string; min?: number; max?: number; exclusiveMin?: boolean; values?: readonly string[] }, path: string, errors: ValidationError[], palette?: Record<string, unknown>) {
  let valid = true;
  switch (field.type) {
    case 'number': valid = isFiniteNum(value); break;
    case 'int': valid = Number.isInteger(value) && isFiniteNum(value); break;
    case 'bool': valid = typeof value === 'boolean'; break;
    case 'string': valid = typeof value === 'string'; break;
    case 'color': valid = isSlotOrColor(value, palette); break;
    case 'enum': valid = typeof value === 'string' && !!field.values?.includes(value); break;
    case 'array': valid = Array.isArray(value); break;
    case 'object': valid = isRecord(value); break;
  }
  if (!valid) {
    errors.push(fieldError(path, field.name, field.values ? field.values.join('|') : field.type, field.values?.[0] ?? String(field.min ?? 'значение')));
    return;
  }
  if (isFiniteNum(value) && ((field.min !== undefined && (field.exclusiveMin ? value <= (field.min ?? 0) : value < field.min)) || (field.max !== undefined && value > field.max))) {
    const min = field.min ?? 0;
    const bound = field.exclusiveMin ? `>${min}` : `>=${min}`;
    errors.push(fieldError(path, field.name, `${bound}${field.max === undefined ? '' : ` и <=${field.max}`}`, String(min + (field.exclusiveMin ? 1 : 0))));
  }
}

function validateAnimations(value: unknown, path: string, errors: ValidationError[], warnings: ValidationError[], duration?: number) {
  if (!Array.isArray(value)) {
    errors.push(fieldError(path, 'anim', 'массив анимаций', '[]'));
    return;
  }
  value.forEach((entry, index) => {
    const animPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      errors.push(fieldError(animPath, 'анимация', 'объект', '{"type":"move"}'));
      return;
    }
    if (typeof entry.type !== 'string' || !Object.hasOwn(ANIM_SPEC, entry.type)) {
      errors.push(fieldError(`${animPath}.type`, `тип анимации ${String(entry.type)}`, Object.keys(ANIM_SPEC).join('|'), 'move'));
      return;
    }
    const fields = ANIM_SPEC[entry.type];
    checkUnknown(entry, ['type', ...fields.map(({ name }) => name)], animPath, warnings);
    for (const field of fields) {
      const fieldValue = entry[field.name];
      if (fieldValue === undefined) {
        if (['from', 'to'].includes(field.name) && entry.type === 'move') errors.push(fieldError(`${animPath}.${field.name}`, field.name, 'массив из 2 конечных чисел', '[0, 0]'));
        continue;
      }
      if (field.name === 'from' || field.name === 'to') {
        if (!Array.isArray(fieldValue) || fieldValue.length !== 2 || !fieldValue.every(isFiniteNum)) errors.push(fieldError(`${animPath}.${field.name}`, field.name, 'массив из 2 конечных чисел', '[0, 0]'));
      } else validateField(fieldValue, field, `${animPath}.${field.name}`, errors);
    }
    const t0 = entry.t0;
    const t1 = entry.t1;
    if (isFiniteNum(t0) && isFiniteNum(t1) && t0 > t1) errors.push(fieldError(`${animPath}.t1`, 't1', 'не меньше t0', String(t0)));
    if (duration !== undefined) for (const key of ['t0', 't1']) if (isFiniteNum(entry[key]) && (entry[key] as number) > duration) {
      errors.push(fieldError(`${animPath}.${key}`, key, `число от 0 до duration (${duration})`, String(duration)));
    }
  });
}

export function validateAsset(json: unknown, options: { inline?: boolean } = {}): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!isRecord(json)) return { ok: false, errors: [{ path: '', message: 'модель должна быть объектом' }], warnings };
  const asset = json;
  if (!options.inline && asset.version !== 1) err('version', 'version модели должен быть 1; пример: 1');
  if (!options.inline && (typeof asset.id !== 'string' || !asset.id)) err('id', 'id модели должен быть непустой строкой; пример: whale');
  if (!options.inline && (typeof asset.name !== 'string' || !asset.name)) err('name', 'name модели должен быть непустой строкой; пример: Кит');
  if (options.inline && asset.version !== undefined && asset.version !== 1) err('version', 'version модели должен быть 1; пример: 1');
  if (options.inline && asset.id !== undefined && typeof asset.id !== 'string') err('id', 'id должен быть строкой; пример: inline');
  if (options.inline && asset.name !== undefined && typeof asset.name !== 'string') err('name', 'name должен быть строкой; пример: Фигура');
  if (!Array.isArray(asset.bounds) || asset.bounds.length !== 4 || !asset.bounds.every(isFiniteNum)) err('bounds', 'bounds должны содержать 4 конечных числа; допустимо: [x, y, w>0, h>0]; пример: [0, 0, 100, 100]');
  else if (asset.bounds[2] <= 0 || asset.bounds[3] <= 0) err('bounds', 'ширина и высота bounds должны быть больше нуля; пример: [0, 0, 100, 100]');
  if (!Array.isArray(asset.parts) || asset.parts.length === 0) err('parts', 'parts должен быть непустым массивом; пример: [{"id":"body","d":"M 0 0 Z"}]');
  else {
    const ids = new Set<string>();
    asset.parts.forEach((raw, index) => {
      const base = `parts[${index}]`;
      if (!isRecord(raw)) { err(base, 'часть должна быть объектом; пример: {"id":"body","d":"M 0 0 Z"}'); return; }
      const part = raw;
      if (typeof part.id !== 'string' || !part.id) err(`${base}.id`, 'id части должен быть непустой строкой; пример: body');
      else if (ids.has(part.id)) err(`${base}.id`, `id части "${part.id}" повторяется; укажите уникальный id`);
      else ids.add(part.id);
      const type = part.type ?? 'path';
      if (typeof type !== 'string' || !PATH_TYPES.includes(type)) err(`${base}.type`, `type должен быть одним из ${PATH_TYPES.join(', ')}; пример: path`);
      if (type === 'circle') {
        for (const key of ['cx', 'cy']) if (!isFiniteNum(part[key])) err(`${base}.${key}`, `${key} должен быть конечным числом; пример: 0`);
        if (!isFiniteNum(part.r) || part.r <= 0) err(`${base}.r`, 'r должен быть конечным числом больше нуля; пример: 10');
      } else if (typeof part.d !== 'string' || !part.d.trim()) err(`${base}.d`, 'd должен быть непустой строкой пути; пример: M 0 0 Z');
      for (const key of ['off', 'rim']) if (part[key] !== undefined && (!Array.isArray(part[key]) || part[key].length !== 2 || !part[key].every(isFiniteNum))) err(`${base}.${key}`, `${key} должен быть массивом из 2 конечных чисел; пример: [0, 0]`);
      if (part.fill !== undefined && (typeof part.fill !== 'string' || (part.fill !== 'none' && !isSlotOrColor(part.fill)))) err(`${base}.fill`, 'fill должен быть hex, слотом палитры или none; пример: #ffffff');
      if (part.stroke !== undefined) {
        if (!isRecord(part.stroke)) err(`${base}.stroke`, 'stroke должен быть объектом {color, w}; пример: {"color":"rim","w":2}');
        else {
          if (!isSlotOrColor(part.stroke.color)) err(`${base}.stroke.color`, 'цвет stroke должен быть hex или слотом палитры; пример: rim');
          if (!isFiniteNum(part.stroke.w) || part.stroke.w <= 0) err(`${base}.stroke.w`, 'w должен быть конечным числом больше нуля; пример: 2');
        }
      }
      if (part.anim !== undefined) validateAnimations(part.anim, `${base}.anim`, errors, warnings);
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateScene(data: unknown, opts: ValidateOpts = {}): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const catalogIds = new Set(opts.catalogIds ?? []);
  const allIds = new Set<string>();
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!isRecord(data)) return { ok: false, errors: [{ path: '', message: 'сцена должна быть объектом' }], warnings };
  const s = data;
  checkUnknown(s, SPEC_KEYS.scene, '', warnings);
  if (s.version !== 1) err('version', 'version должен быть 1; допустимо: 1; пример: 1');
  if (typeof s.title !== 'string') err('title', 'title должен быть строкой; пример: Сцена');
  if (!isFiniteNum(s.duration) || s.duration <= 0) err('duration', 'duration должен быть конечным числом больше нуля; пример: 12');
  const duration = isFiniteNum(s.duration) ? s.duration : undefined;
  const palette = isRecord(s.palette) ? s.palette : undefined;
  if (!palette) err('palette', 'palette должна быть объектом; пример: {"sky":["#123","#456"]}');
  else {
    if (!Array.isArray(palette.sky) || palette.sky.length < 2) err('palette.sky', 'нужны минимум 2 цвета; допустимо: массив hex-цветов; пример: ["#123","#456"]');
    else palette.sky.forEach((color, index) => { if (!isColor(color)) err(`palette.sky[${index}]`, 'цвет должен быть #rgb, #rrggbb или #rrggbbaa; пример: #abc'); });
    for (const slot of PALETTE_SLOTS) if (slot !== 'sky' && palette[slot] !== undefined && !isColor(palette[slot])) err(`palette.${slot}`, `${slot} должен быть #rgb, #rrggbb или #rrggbbaa; пример: #abc`);
  }
  if (s.style !== undefined) {
    if (!isRecord(s.style)) err('style', 'style должен быть объектом; пример: {}');
    else {
      const st = s.style;
      checkUnknown(st, SPEC_KEYS.style, 'style', warnings);
      for (const key of ['grain', 'vignette']) if (st[key] !== undefined && (!isFiniteNum(st[key]) || st[key] < 0 || st[key] > 1)) err(`style.${key}`, `${key} должен быть числом от 0 до 1; пример: 0.5`);
      if (st.preset !== undefined && typeof st.preset !== 'string') err('style.preset', 'preset должен быть строкой; пример: dusk');
    }
  }
  if (!isRecord(s.camera)) err('camera', 'camera должна быть объектом; пример: {"keys":[]}');
  else {
    const camera = s.camera;
    checkUnknown(camera, SPEC_KEYS.camera, 'camera', warnings);
    if (camera.verticalFit !== undefined && !isFiniteNum(camera.verticalFit)) err('camera.verticalFit', 'verticalFit должен быть конечным числом; пример: 0.52');
    if (!Array.isArray(camera.keys)) err('camera.keys', 'camera.keys должен быть массивом; пример: []');
    else {
      let previous = -Infinity;
      camera.keys.forEach((raw, index) => {
        const base = `camera.keys[${index}]`;
        if (!isRecord(raw)) { err(base, 'ключ камеры должен быть объектом; пример: {"t":0,"x":0,"y":0,"zoom":1}'); return; }
        checkUnknown(raw, ['t', 'x', 'y', 'zoom'], base, warnings);
        for (const key of ['t', 'x', 'y', 'zoom']) if (!isFiniteNum(raw[key])) err(`${base}.${key}`, `${key} должен быть конечным числом; пример: ${key === 'zoom' ? '1' : '0'}`);
        if (isFiniteNum(raw.zoom) && raw.zoom <= 0) err(`${base}.zoom`, 'zoom должен быть больше нуля; пример: 1');
        if (isFiniteNum(raw.t)) {
          if (raw.t <= previous) err(`${base}.t`, 't должен строго возрастать без дублей; пример: 2');
          if (raw.t < 0 || (duration !== undefined && raw.t > duration)) err(`${base}.t`, `t должен быть в диапазоне 0..duration (${duration ?? 'duration'}); пример: 0`);
          previous = raw.t;
        }
      });
    }
  }
  const assets = isRecord(s.assets) ? s.assets : undefined;
  if (!assets) err('assets', 'assets должен быть объектом; пример: {}');
  else for (const [id, asset] of Object.entries(assets)) {
    const result = validateAsset(asset, { inline: true });
    for (const issue of result.errors) err(`assets.${id}${issue.path ? `.${issue.path}` : ''}`, issue.message);
    for (const warning of result.warnings) warnings.push({ ...warning, path: `assets.${id}${warning.path ? `.${warning.path}` : ''}` });
  }
  if (!Array.isArray(s.layers)) err('layers', 'layers должен быть массивом; пример: []');
  else s.layers.forEach((rawLayer, layerIndex) => {
    const base = `layers[${layerIndex}]`;
    if (!isRecord(rawLayer)) { err(base, 'слой должен быть объектом; пример: {"id":"layer-1","name":"Фон","depth":0,"visible":true,"objects":[]}'); return; }
    const layer = rawLayer;
    checkUnknown(layer, SPEC_KEYS.layer, base, warnings);
    if (typeof layer.id !== 'string' || !layer.id) err(`${base}.id`, 'id слоя должен быть непустой строкой; пример: layer-1');
    else if (allIds.has(layer.id)) err(`${base}.id`, `id "${layer.id}" уже использован; укажите уникальный id`);
    else allIds.add(layer.id);
    if (typeof layer.name !== 'string' || !layer.name) err(`${base}.name`, 'name слоя должен быть непустой строкой; пример: Фон');
    if (!isFiniteNum(layer.depth)) err(`${base}.depth`, 'depth должен быть конечным числом; пример: 0');
    if (typeof layer.visible !== 'boolean') err(`${base}.visible`, 'visible должен быть булевым; пример: true');
    if (!Array.isArray(layer.objects)) { err(`${base}.objects`, 'objects должен быть массивом; пример: []'); return; }
    layer.objects.forEach((rawObject, objectIndex) => {
      const objectPath = `${base}.objects[${objectIndex}]`;
      if (!isRecord(rawObject)) { err(objectPath, 'объект должен быть объектом; пример: {"id":"obj-1","name":"Небо","kind":"sky"}'); return; }
      const object = rawObject;
      checkUnknown(object, SPEC_KEYS.object, objectPath, warnings);
      if (typeof object.id !== 'string' || !object.id) err(`${objectPath}.id`, 'id объекта должен быть непустой строкой; пример: obj-1');
      else if (allIds.has(object.id)) err(`${objectPath}.id`, `id "${object.id}" уже использован; укажите уникальный id`);
      else allIds.add(object.id);
      if (typeof object.name !== 'string' || !object.name) err(`${objectPath}.name`, 'name объекта должен быть непустой строкой; пример: Небо');
      if (typeof object.kind !== 'string' || !Object.hasOwn(KIND_SPEC, object.kind)) err(`${objectPath}.kind`, `kind "${String(object.kind)}" неизвестен; допустимо: ${Object.keys(KIND_SPEC).join(', ')}; пример: cloud`);
      for (const key of ['x', 'y', 's', 'rot', 'alpha']) if (object[key] !== undefined && !isFiniteNum(object[key])) err(`${objectPath}.${key}`, `${key} должен быть конечным числом; пример: 0`);
      if (isFiniteNum(object.s) && object.s <= 0) err(`${objectPath}.s`, 's должен быть больше нуля; пример: 1');
      if (isFiniteNum(object.alpha) && (object.alpha < 0 || object.alpha > 1)) err(`${objectPath}.alpha`, 'alpha должен быть от 0 до 1; пример: 1');
      if (object.color !== undefined && !isSlotOrColor(object.color, palette)) err(`${objectPath}.color`, 'color должен быть слотом палитры или hex #rgb/#rrggbb/#rrggbbaa; пример: far');
      if (isRecord(object.params)) {
        const spec = typeof object.kind === 'string' && Object.hasOwn(KIND_SPEC, object.kind) ? KIND_SPEC[object.kind as keyof typeof KIND_SPEC] : undefined;
        checkUnknown(object.params, spec?.params.map(({ name }) => name) ?? [], `${objectPath}.params`, warnings);
        for (const field of spec?.params ?? []) {
          const value = object.params[field.name];
          if (value === undefined) continue;
          validateField(value, field, `${objectPath}.params.${field.name}`, errors, palette);
        }
        for (const [minKey, maxKey] of [['minW', 'maxW'], ['minH', 'maxH']]) {
          const min = object.params[minKey], max = object.params[maxKey];
          if (isFiniteNum(min) && isFiniteNum(max) && min > max) err(`${objectPath}.params.${minKey}`, `${minKey} не должен превышать ${maxKey}; пример: ${minKey}=40, ${maxKey}=100`);
        }
      } else if (object.params !== undefined) err(`${objectPath}.params`, 'params должен быть объектом; пример: {}');
      if (object.anim !== undefined) validateAnimations(object.anim, `${objectPath}.anim`, errors, warnings, duration);
      if (object.partAnim !== undefined) {
        if (!isRecord(object.partAnim)) err(`${objectPath}.partAnim`, 'partAnim должен быть объектом; пример: {}');
        else for (const [id, anims] of Object.entries(object.partAnim)) validateAnimations(anims, `${objectPath}.partAnim.${id}`, errors, warnings, duration);
      }
      if (object.kind === 'asset') {
        if (typeof object.asset !== 'string' || !object.asset) err(`${objectPath}.asset`, 'asset обязателен для kind asset; пример: whale');
        else if (!catalogIds.has(object.asset) && !(assets && object.asset in assets)) err(`${objectPath}.asset`, `asset "${object.asset}" не найден в scene.assets или каталоге; пример: whale`);
      } else if (object.kind === 'shape') {
        if (!isRecord(object.params)) err(`${objectPath}.params`, 'params должен быть объектом; пример: {}');
        else {
          const model = object.params.model;
          const res = validateAsset(model, { inline: true });
          for (const issue of res.errors) err(`${objectPath}.params.model${issue.path ? `.${issue.path}` : ''}`, issue.message);
          for (const warning of res.warnings) warnings.push({ ...warning, path: `${objectPath}.params.model${warning.path ? `.${warning.path}` : ''}` });
        }
      }
    });
  });
  return { ok: errors.length === 0, errors, warnings };
}

export function validateObject(value: unknown, opts: ValidateOpts = {}): ValidationResult {
  const scene = {
    version: 1,
    title: 'Проверка объекта',
    duration: 1,
    palette: { sky: ['#000', '#fff'] },
    camera: { keys: [] },
    assets: {},
    layers: [{ id: 'validation-layer', name: 'Проверка', depth: 0, visible: true, objects: [value] }],
  };
  const result = validateScene(scene, opts);
  const prefix = 'layers[0].objects[0]';
  return {
    ok: result.ok,
    errors: result.errors.filter(({ path }) => path.startsWith(prefix)).map((issue) => ({ ...issue, path: issue.path.slice(prefix.length).replace(/^\./, '') })),
    warnings: result.warnings.filter(({ path }) => path.startsWith(prefix)).map((issue) => ({ ...issue, path: issue.path.slice(prefix.length).replace(/^\./, '') })),
  };
}
