import type { ObjectKind } from './schema.ts';

export interface ValidateOpts {
  catalogIds?: string[];
}

export interface ValidationError {
  path: string;
  message: string;
}

const KINDS: ObjectKind[] = ['sky', 'glow', 'cloud', 'skyline', 'asset'];
const ANIM_TYPES = ['move', 'drift', 'bob', 'swing', 'pulse', 'fade'];
const PALETTE_SLOTS = ['sun', 'haze', 'far', 'mid', 'near', 'whale', 'belly', 'rim', 'cloudLight', 'cloudShadow', 'window'];

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function validateScene(data: unknown, opts: ValidateOpts = {}): { ok: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const catalogIds = new Set(opts.catalogIds ?? []);
  const allIds = new Set<string>();

  function err(path: string, message: string) {
    errors.push({ path, message });
  }

  function at(base: string, key: string | number): string {
    return base === '' ? String(key) : `${base}[${typeof key === 'number' ? key : key}]`;
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    err('', 'сцена должна быть объектом');
    return { ok: false, errors };
  }
  const s = data as Record<string, unknown>;

  if (s.version !== 1) err('version', 'version должен быть равен 1');
  if (typeof s.title !== 'string') err('title', 'title должен быть строкой');
  if (!isFiniteNum(s.duration) || s.duration <= 0) err('duration', 'duration должен быть числом больше 0');

  const pal = s.palette;
  if (pal === null || typeof pal !== 'object' || Array.isArray(pal)) {
    err('palette', 'palette должна быть объектом');
  } else {
    const p = pal as Record<string, unknown>;
    const sky = p.sky;
    if (!Array.isArray(sky) || sky.length < 2 || !sky.every(isHex)) {
      err('palette.sky', 'palette.sky должен быть массивом из не менее 2 строк #hex');
    }
    for (const slot of PALETTE_SLOTS) {
      const v = p[slot];
      if (v !== undefined && !isHex(v)) {
        err(`palette.${slot}`, `${slot} должен быть строкой #hex`);
      }
    }
  }

  const style = s.style;
  if (style !== undefined && (style === null || typeof style !== 'object' || Array.isArray(style))) {
    err('style', 'style должен быть объектом');
  } else if (style) {
    const st = style as Record<string, unknown>;
    if (st.grain !== undefined && !isFiniteNum(st.grain)) err('style.grain', 'grain должен быть числом');
    if (st.vignette !== undefined && !isFiniteNum(st.vignette)) err('style.vignette', 'vignette должен быть числом');
  }

  const cam = s.camera;
  if (cam === null || typeof cam !== 'object' || Array.isArray(cam)) {
    err('camera', 'camera должна быть объектом');
  } else {
    const c = cam as Record<string, unknown>;
    if (c.verticalFit !== undefined && !isFiniteNum(c.verticalFit)) err('camera.verticalFit', 'verticalFit должен быть числом');
    const keys = c.keys;
    if (!Array.isArray(keys)) {
      err('camera.keys', 'camera.keys должен быть массивом');
    } else {
      keys.forEach((k, i) => {
        const p = `camera.keys[${i}]`;
        if (k === null || typeof k !== 'object') {
          err(p, 'ключ камеры должен быть объектом');
          return;
        }
        const kk = k as Record<string, unknown>;
        for (const f of ['t', 'x', 'y', 'zoom']) {
          if (!isFiniteNum(kk[f])) err(`${p}.${f}`, `${f} должен быть числом`);
        }
      });
    }
  }

  const assets = s.assets;
  if (assets === null || typeof assets !== 'object' || Array.isArray(assets)) {
    err('assets', 'assets должен быть объектом');
  }

  const layers = s.layers;
  if (!Array.isArray(layers)) {
    err('layers', 'layers должен быть массивом');
  } else {
    layers.forEach((layer, li) => {
      const lp = `layers[${li}]`;
      if (layer === null || typeof layer !== 'object') {
        err(lp, 'слой должен быть объектом');
        return;
      }
      const l = layer as Record<string, unknown>;
      if (typeof l.id !== 'string' || l.id === '') err(`${lp}.id`, 'id слоя должен быть непустой строкой');
      else {
        if (allIds.has(l.id as string)) err(`${lp}.id`, `дубликат id "${l.id}"`);
        else allIds.add(l.id as string);
      }
      if (typeof l.name !== 'string' || l.name === '') err(`${lp}.name`, 'name слоя должен быть непустой строкой');
      if (!isFiniteNum(l.depth)) err(`${lp}.depth`, 'depth должен быть числом');
      if (typeof l.visible !== 'boolean') err(`${lp}.visible`, 'visible должен быть булевым');

      const objects = l.objects;
      if (!Array.isArray(objects)) {
        err(`${lp}.objects`, 'objects должен быть массивом');
      } else {
        objects.forEach((obj, oi) => {
          const op = `${lp}.objects[${oi}]`;
          if (obj === null || typeof obj !== 'object') {
            err(op, 'объект должен быть объектом');
            return;
          }
          const o = obj as Record<string, unknown>;
          if (typeof o.id !== 'string' || o.id === '') err(`${op}.id`, 'id объекта должен быть непустой строкой');
          else {
            if (allIds.has(o.id as string)) err(`${op}.id`, `дубликат id "${o.id}"`);
            else allIds.add(o.id as string);
          }
          if (typeof o.name !== 'string' || o.name === '') err(`${op}.name`, 'name объекта должен быть непустой строкой');
          if (!KINDS.includes(o.kind as ObjectKind)) err(`${op}.kind`, `kind "${o.kind}" не из списка`);
          for (const f of ['x', 'y', 's', 'rot', 'alpha']) {
            if (o[f] !== undefined && !isFiniteNum(o[f])) err(`${op}.${f}`, `${f} должен быть числом`);
          }
          if (o.color !== undefined) {
            const ok = isHex(o.color) || (typeof o.color === 'string' && (pal as Record<string, unknown> | undefined) !== undefined && (pal as Record<string, unknown>)[o.color] !== undefined);
            if (!ok) err(`${op}.color`, 'color должен быть слотом палитры или #hex');
          }
          const anim = o.anim;
          if (anim !== undefined && !Array.isArray(anim)) err(`${op}.anim`, 'anim должен быть массивом');
          if (Array.isArray(anim)) {
            anim.forEach((an, ai) => {
              const ap = `${op}.anim[${ai}]`;
              if (an === null || typeof an !== 'object') {
                err(ap, 'анимация должна быть объектом');
                return;
              }
              const a = an as Record<string, unknown>;
              if (!ANIM_TYPES.includes(a.type as string)) err(`${ap}.type`, `тип анимации "${a.type}" неизвестен`);
              if (a.type === 'move') {
                if (!Array.isArray(a.from) || a.from.length !== 2 || !a.from.every(isFiniteNum)) err(`${ap}.from`, 'from должен быть массивом из 2 чисел');
                if (!Array.isArray(a.to) || a.to.length !== 2 || !a.to.every(isFiniteNum)) err(`${ap}.to`, 'to должен быть массивом из 2 чисел');
              }
            });
          }
          if (o.kind === 'asset') {
            if (typeof o.asset !== 'string' || o.asset === '') err(`${op}.asset`, 'asset требуется для kind asset');
            else {
              const assetsObj = assets as Record<string, unknown> | undefined;
              const known = catalogIds.has(o.asset) || (assetsObj !== undefined && o.asset in assetsObj);
              if (!known) err(`${op}.asset`, `asset "${o.asset}" не найден в scene.assets или каталоге`);
            }
          }
        });
      }
    });
  }

  return { ok: errors.length === 0, errors };
}
