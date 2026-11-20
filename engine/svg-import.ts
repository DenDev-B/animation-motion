// Импорт SVG в части модели каталога. Чистые функции: без DOM, без Math.random/Date.now.
import type { AssetPart, CatalogAsset, Gradient } from './schema.ts';

export type ColorMode = 'keep' | 'mono' | 'slots';

export interface SvgImportOptions {
  /** Значение currentColor (по умолчанию #222222). */
  color?: string;
  /** Высота bounds после нормализации (по умолчанию 200). */
  scaleHeight?: number;
  colors?: ColorMode;
  /** Слоты палитры для режимов mono/slots по яркости: от самого тёмного к самому светлому. */
  slotNames?: string[];
  maxParts?: number;
  maxPathBytes?: number;
}

export interface SvgImportResult {
  parts: AssetPart[];
  /** После нормализации: центр в (0,0). */
  bounds: [number, number, number, number];
  /** Ширина / высота исходной геометрии. */
  aspect: number;
  warnings: string[];
}

type Mat = [number, number, number, number, number, number];
type Pt = [number, number];
type Seg = { t: 'M' | 'L' | 'C' | 'Z'; p: Pt[] };
type Rgba = { r: number; g: number; b: number; a: number };

/** Остановка градиента при парсинге SVG. */
interface GStop { offset: number; color: Rgba; }

/** Распознанный градиент <linearGradient>/<radialGradient> до привязки к части. */
interface ParsedGradient {
  id: string;
  type: 'linear' | 'radial';
  gradientUnits: 'objectBoundingBox' | 'userSpaceOnUse';
  x1: number; y1: number; x2: number; y2: number;
  cx: number; cy: number; r: number;
  stops: GStop[];
  warnings: string[];
}

const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a',
  cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', lime: '#00ff00', navy: '#000080',
  teal: '#008080', maroon: '#800000', olive: '#808000', silver: '#c0c0c0', gold: '#ffd700', darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', transparent: '#00000000',
};

function parseColor(raw: string, current: string, warnings: string[]): Rgba | 'none' | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === 'none') return 'none';
  if (v === 'currentcolor') return parseColor(current, '#222222', warnings);
  if (v.startsWith('url(')) { warnings.push(`градиент/паттерн заменён цветом: ${raw}`); return null; }
  let hex = NAMED[v] ?? v;
  if (hex.startsWith('#')) {
    hex = hex.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    if (/^[\da-f]{6}$/.test(hex)) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
    if (/^[\da-f]{8}$/.test(hex)) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: parseInt(hex.slice(6, 8), 16) / 255 };
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const n = m[1].split(/[\s,\/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
    if (n.length >= 3 && n.every(Number.isFinite)) {
      const a = m[1].split(/[\s,\/]+/).filter(Boolean)[3];
      return { r: Math.round(n[0]), g: Math.round(n[1]), b: Math.round(n[2]), a: a === undefined ? 1 : (a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a)) };
    }
  }
  warnings.push(`неизвестный цвет «${raw}», часть пропущена или цвет заменён по умолчанию`);
  return null;
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const toHex = (c: Rgba, alpha = 1): string => {
  const a = c.a * alpha;
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${a < 0.999 ? hex2(a * 255) : ''}`;
};
const luma = (c: Rgba) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// ---------- XML ----------
interface Node { name: string; attrs: Record<string, string>; children: Node[] }

function parseXml(src: string, warnings: string[]): Node {
  const root: Node = { name: '#root', attrs: {}, children: [] };
  const stack: Node[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) {
      const i = stack.map((n) => n.name).lastIndexOf(m[1]);
      if (i > 0) stack.length = i;
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3] ?? ''))) attrs[a[1]] = a[2] ?? a[3] ?? '';
      const node: Node = { name: m[2].replace(/^svg:/, ''), attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
    }
  }
  const svg = root.children.find((n) => n.name === 'svg');
  if (!svg) throw new Error('В файле нет элемента <svg>.');
  void warnings;
  return svg;
}

// ---------- transform ----------
function parseTransform(raw: string | undefined, warnings: string[]): Mat {
  let m = IDENT;
  if (!raw) return m;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(raw))) {
    const n = (t[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let k: Mat | null = null;
    switch (t[1]) {
      case 'translate': k = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]; break;
      case 'scale': k = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const a = ((n[0] ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        const r: Mat = [c, s, -s, c, 0, 0];
        k = n.length >= 3 ? mul(mul([1, 0, 0, 1, n[1], n[2]], r), [1, 0, 0, 1, -n[1], -n[2]]) : r;
        break;
      }
      case 'matrix': if (n.length === 6) k = n as Mat; break;
      case 'skewX': k = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': k = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    if (!k || !k.every(Number.isFinite)) warnings.push(`transform «${t[0]}» не распознан и пропущен`);
    else m = mul(m, k);
  }
  return m;
}

// ---------- path ----------
const KAPPA = 0.5522847498307936;

function arcToCubics(p0: Pt, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, p1: Pt): Pt[][] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [[[p0[0], p0[1]], [p1[0], p1[1]], p1]];
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (p0[0] + p1[0]) / 2, cy = sp * cxp + cp * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n, alpha = (4 / 3) * Math.tan(step / 4);
  const out: Pt[][] = [];
  const pt = (a: number): Pt => [cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp];
  const dv = (a: number): Pt => [-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp];
  for (let i = 0; i < n; i++) {
    const a0 = th1 + i * step, a1 = a0 + step;
    const s = pt(a0), e = i === n - 1 ? p1 : pt(a1), d0 = dv(a0), d1 = dv(a1);
    out.push([[s[0] + alpha * d0[0], s[1] + alpha * d0[1]], [e[0] - alpha * d1[0], e[1] - alpha * d1[1]], e]);
  }
  return out;
}

const ARGC: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function parsePathData(d: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  const len = d.length;
  const skip = () => { while (i < len && /[\s,]/.test(d[i])) i++; };
  const num = (): number => {
    skip();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error(`Ошибка в path: ожидалось число около позиции ${i}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new Error(`Ошибка в path: ожидался флаг дуги 0/1 около позиции ${i}`);
    i++;
    return Number(c);
  };
  let cur: Pt = [0, 0], start: Pt = [0, 0];
  let lastC: Pt | null = null, lastQ: Pt | null = null;
  let cmd = '';
  skip();
  while (i < len) {
    skip();
    if (i >= len) break;
    if (/[A-Za-z]/.test(d[i])) { cmd = d[i++]; if (!(cmd.toUpperCase() in ARGC)) throw new Error(`Неизвестная команда path «${cmd}»`); }
    else if (!cmd) throw new Error('Ошибка в path: данные не начинаются с команды');
    const up = cmd.toUpperCase(), rel = cmd !== up;
    if (up === 'Z') { segs.push({ t: 'Z', p: [] }); cur = start; lastC = lastQ = null; cmd = ''; skip(); continue; }
    const ox = rel ? cur[0] : 0, oy = rel ? cur[1] : 0;
    switch (up) {
      case 'M': { const p: Pt = [num() + ox, num() + oy]; segs.push({ t: 'M', p: [p] }); cur = start = p; cmd = rel ? 'l' : 'L'; lastC = lastQ = null; break; }
      case 'L': { const p: Pt = [num() + ox, num() + oy]; segs.push({ t: 'L', p: [p] }); cur = p; lastC = lastQ = null; break; }
      case 'H': { const p: Pt = [num() + ox, cur[1]]; segs.push({ t: 'L', p: [p] }); cur = p; lastC = lastQ = null; break; }
      case 'V': { const p: Pt = [cur[0], num() + oy]; segs.push({ t: 'L', p: [p] }); cur = p; lastC = lastQ = null; break; }
      case 'C': { const a: Pt = [num() + ox, num() + oy], b: Pt = [num() + ox, num() + oy], p: Pt = [num() + ox, num() + oy]; segs.push({ t: 'C', p: [a, b, p] }); cur = p; lastC = b; lastQ = null; break; }
      case 'S': { const a: Pt = lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur; const b: Pt = [num() + ox, num() + oy], p: Pt = [num() + ox, num() + oy]; segs.push({ t: 'C', p: [a, b, p] }); cur = p; lastC = b; lastQ = null; break; }
      case 'Q': { const q: Pt = [num() + ox, num() + oy], p: Pt = [num() + ox, num() + oy]; segs.push({ t: 'C', p: [[cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p] }); cur = p; lastQ = q; lastC = null; break; }
      case 'T': { const q: Pt = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur; const p: Pt = [num() + ox, num() + oy]; segs.push({ t: 'C', p: [[cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p] }); cur = p; lastQ = q; lastC = null; break; }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), la = flag(), sw = flag();
        const p: Pt = [num() + ox, num() + oy];
        for (const c of arcToCubics(cur, rx, ry, rot, la === 1, sw === 1, p)) segs.push({ t: 'C', p: c });
        if (arcToCubics(cur, rx, ry, rot, la === 1, sw === 1, p).length === 0) { /* нулевая дуга */ }
        cur = p; lastC = lastQ = null; break;
      }
    }
  }
  return segs;
}

const circleSegs = (cx: number, cy: number, rx: number, ry: number): Seg[] => {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    { t: 'M', p: [[cx + rx, cy]] },
    { t: 'C', p: [[cx + rx, cy + ky], [cx + kx, cy + ry], [cx, cy + ry]] },
    { t: 'C', p: [[cx - kx, cy + ry], [cx - rx, cy + ky], [cx - rx, cy]] },
    { t: 'C', p: [[cx - rx, cy - ky], [cx - kx, cy - ry], [cx, cy - ry]] },
    { t: 'C', p: [[cx + kx, cy - ry], [cx + rx, cy - ky], [cx + rx, cy]] },
    { t: 'Z', p: [] },
  ];
};

function rectSegs(x: number, y: number, w: number, h: number, rx: number, ry: number): Seg[] {
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) return [{ t: 'M', p: [[x, y]] }, { t: 'L', p: [[x + w, y]] }, { t: 'L', p: [[x + w, y + h]] }, { t: 'L', p: [[x, y + h]] }, { t: 'Z', p: [] }];
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    { t: 'M', p: [[x + rx, y]] }, { t: 'L', p: [[x + w - rx, y]] },
    { t: 'C', p: [[x + w - rx + kx, y], [x + w, y + ry - ky], [x + w, y + ry]] }, { t: 'L', p: [[x + w, y + h - ry]] },
    { t: 'C', p: [[x + w, y + h - ry + ky], [x + w - rx + kx, y + h], [x + w - rx, y + h]] }, { t: 'L', p: [[x + rx, y + h]] },
    { t: 'C', p: [[x + rx - kx, y + h], [x, y + h - ry + ky], [x, y + h - ry]] }, { t: 'L', p: [[x, y + ry]] },
    { t: 'C', p: [[x, y + ry - ky], [x + rx - kx, y], [x + rx, y]] }, { t: 'Z', p: [] },
  ];
}

// ---------- градиенты ----------

function parsePctOrNumber(raw: string | undefined, def: number): number {
  if (raw === undefined || raw === '') return def;
  const v = raw.trim();
  if (v.endsWith('%')) return (parseFloat(v) / 100);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function parseStopColor(stop: Node, warnings: string[]): Rgba | null {
  const attr = stop.attrs['stop-color'];
  let raw = attr !== undefined ? attr : '';
  const style = stop.attrs.style ?? '';
  if (!raw && style) {
    for (const decl of style.split(';')) {
      const ix = decl.indexOf(':');
      if (ix > 0 && decl.slice(0, ix).trim().toLowerCase() === 'stop-color') raw = decl.slice(ix + 1).trim();
    }
  }
  if (!raw) return null;
  const c = parseColor(raw, '#000000', warnings);
  return c === 'none' ? null : c;
}

function parseStopOpacity(stop: Node): number {
  const attr = stop.attrs['stop-opacity'];
  let raw = attr !== undefined ? attr : '';
  const style = stop.attrs.style ?? '';
  if (!raw && style) {
    for (const decl of style.split(';')) {
      const ix = decl.indexOf(':');
      if (ix > 0 && decl.slice(0, ix).trim().toLowerCase() === 'stop-opacity') raw = decl.slice(ix + 1).trim();
    }
  }
  if (!raw) return 1;
  const n = parseFloat(raw.replace('%', ''));
  if (!Number.isFinite(n)) return 1;
  return raw.endsWith('%') ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function parseGradientStops(n: Node, warnings: string[]): GStop[] {
  const stops: GStop[] = [];
  for (const c of n.children) {
    if (c.name.toLowerCase() !== 'stop') continue;
    const offsetRaw = c.attrs.offset ?? '';
    let offset = parseFloat(offsetRaw.replace('%', ''));
    if (!Number.isFinite(offset)) offset = 0;
    if (offsetRaw.endsWith('%')) offset /= 100;
    offset = Math.max(0, Math.min(1, offset));
    const color = parseStopColor(c, warnings);
    if (!color) continue;
    const a = parseStopOpacity(c);
    stops.push({ offset, color: { ...color, a: color.a * a } });
  }
  stops.sort((a, b) => a.offset - b.offset);
  return stops;
}

function mergeStops(parent: GStop[] | null, own: GStop[]): GStop[] {
  if (!parent || parent.length === 0) return own;
  if (own.length === 0) return [...parent];
  const merged = [...parent];
  for (const s of own) {
    const i = merged.findIndex((m) => m.offset === s.offset);
    if (i >= 0) merged[i] = s; else merged.push(s);
  }
  merged.sort((a, b) => a.offset - b.offset);
  return merged;
}

function resolveGradientId(raw: string): string | null {
  const m = /^url\(#?([^)]+)\)$/i.exec(raw.trim());
  if (m) return m[1];
  const m2 = /^#?([A-Za-z][\w-]*)$/i.exec(raw.trim());
  return m2 ? m2[1] : null;
}

interface RawGradient {
  id: string;
  type: 'linear' | 'radial';
  gradientUnits: 'objectBoundingBox' | 'userSpaceOnUse';
  x1: number; y1: number; x2: number; y2: number;
  cx: number; cy: number; r: number;
  href: string | null;
  stops: GStop[];
  warnings: string[];
}

function parseGradientElement(n: Node, warnings: string[]): RawGradient | null {
  const id = n.attrs.id ?? '';
  if (!id) { warnings.push('градиент без id пропущен'); return null; }
  const type = n.name.toLowerCase() === 'radialgradient' ? 'radial' : 'linear';
  const href = resolveGradientId(n.attrs['xlink:href'] ?? n.attrs.href ?? '');
  const gu = (n.attrs.gradientUnits ?? 'objectBoundingBox').toLowerCase();
  const gradientUnits = gu === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';
  if (gu !== 'objectBoundingBox' && gu !== 'userSpaceOnUse') warnings.push(`градиент «${id}»: некорректный gradientUnits, используется objectBoundingBox`);

  const spread = (n.attrs.spreadMethod ?? 'pad').toLowerCase();
  if (spread !== 'pad') warnings.push(`градиент «${id}»: spreadMethod "${spread}" не поддерживается, используется pad`);
  if (n.attrs.gradientTransform) warnings.push(`градиент «${id}»: gradientTransform не поддерживается, игнорируется`);
  if (type === 'radial' && (n.attrs.fx !== undefined || n.attrs.fy !== undefined)) warnings.push(`градиент «${id}»: fx/fy не поддерживаются, игнорируются`);

  let x1 = parsePctOrNumber(n.attrs.x1, 0), y1 = parsePctOrNumber(n.attrs.y1, 0);
  let x2 = parsePctOrNumber(n.attrs.x2, type === 'linear' ? 1 : 0), y2 = parsePctOrNumber(n.attrs.y2, 0);
  let cx = parsePctOrNumber(n.attrs.cx, 0.5), cy = parsePctOrNumber(n.attrs.cy, 0.5);
  let r = parsePctOrNumber(n.attrs.r, 0.5);

  return { id, type, gradientUnits, x1, y1, x2, y2, cx, cy, r, href, stops: parseGradientStops(n, warnings), warnings: [] };
}

function resolveGradientHrefs(gradients: Map<string, RawGradient>, warnings: string[]): Map<string, RawGradient> {
  const resolved = new Map<string, RawGradient>();
  const visiting = new Set<string>();
  const resolve = (id: string): RawGradient | null => {
    const g = gradients.get(id);
    if (!g) return null;
    if (resolved.has(id)) return resolved.get(id)!;
    if (visiting.has(id)) { warnings.push(`градиент «${id}»: циклическая ссылка href, остановки не унаследованы`); return g; }
    visiting.add(id);
    let base = g;
    if (g.href) {
      const parent = resolve(g.href);
      if (parent) base = { ...g, stops: mergeStops(parent.stops, g.stops) };
      else warnings.push(`градиент «${id}»: href на несуществующий градиент «${g.href}»`);
    }
    visiting.delete(id);
    resolved.set(id, base);
    return base;
  };
  for (const id of gradients.keys()) resolve(id);
  return resolved;
}
interface RawPart { id?: string; segs: Seg[]; fill: Rgba | 'none'; gradientRef: string | null; fillAlpha: number; stroke: Rgba | null; strokeAlpha: number; strokeW: number; pBounds: [number, number, number, number] | null }
interface Style { fill: string; stroke: string; sw: string; op: number; fop: string; sop: string; color: string }

const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'color'];

function readStyle(n: Node, parent: Style): Style {
  const props: Record<string, string> = {};
  for (const k of STYLE_KEYS) if (n.attrs[k] !== undefined) props[k] = n.attrs[k];
  if (n.attrs.style) for (const decl of n.attrs.style.split(';')) {
    const ix = decl.indexOf(':');
    if (ix > 0) props[decl.slice(0, ix).trim().toLowerCase()] = decl.slice(ix + 1).trim();
  }
  const op = props.opacity ?? n.attrs.opacity;
  return {
    fill: props.fill ?? parent.fill, stroke: props.stroke ?? parent.stroke, sw: props['stroke-width'] ?? parent.sw,
    fop: props['fill-opacity'] ?? parent.fop, sop: props['stroke-opacity'] ?? parent.sop,
    color: props.color ?? parent.color, op: parent.op * (op !== undefined && Number.isFinite(parseFloat(op)) ? Math.max(0, Math.min(1, parseFloat(op))) : 1),
  };
}

const numAttr = (n: Node, k: string, def = 0): number => {
  const v = parseFloat(n.attrs[k] ?? '');
  return Number.isFinite(v) ? v : def;
};

const UNSUPPORTED = new Set(['image', 'text', 'tspan', 'filter', 'mask', 'clippath', 'use', 'symbol', 'pattern', 'foreignobject', 'style', 'script']);
const SKIP_SILENT = new Set(['title', 'desc', 'metadata', 'stop', 'sodipodi:namedview', 'namedview']);

const fmt = (x: number) => String(Math.round(x * 100) / 100);

export function importSvg(src: string, opts: SvgImportOptions = {}): SvgImportResult {
  const warnings: string[] = [];
  const warned = new Set<string>();
  const warnOnce = (msg: string) => { if (!warned.has(msg)) { warned.add(msg); warnings.push(msg); } };
  const svg = parseXml(src, warnings);
  const current = opts.color ?? '#222222';
  const targetH = opts.scaleHeight ?? 200;
  const maxParts = opts.maxParts ?? 200;
  const maxBytes = opts.maxPathBytes ?? 200 * 1024;
  const mode: ColorMode = opts.colors ?? 'keep';

  let base = IDENT;
  const vb = (svg.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    // viewBox только сдвигает начало; масштаб потом нормализуется по геометрии
    base = [1, 0, 0, 1, -vb[0], -vb[1]];
  } else if (svg.attrs.viewBox) warnOnce('viewBox некорректен и проигнорирован');

  const raws: RawPart[] = [];
  const gradients = new Map<string, RawGradient>();
  const rootStyle: Style = { fill: '#000000', stroke: 'none', sw: '1', op: 1, fop: '1', sop: '1', color: current };

  /** Преобразует распознанный градиент в формат движка в нормализованных координатах части. */
  const convertGradient = (g: RawGradient, pb: [number, number, number, number], cx: number, cy: number, scale: number): Gradient | null => {
    const pw = pb[2] - pb[0], ph = pb[3] - pb[1];
    const toNorm = (x: number, y: number): [number, number] => {
      if (g.gradientUnits === 'objectBoundingBox') {
        x = pb[0] + x * pw; y = pb[1] + y * ph;
      }
      return [(x - cx) * scale, (y - cy) * scale];
    };
    if (g.type === 'linear') {
      const [fx1, fy1] = toNorm(g.x1, g.y1);
      const [fx2, fy2] = toNorm(g.x2, g.y2);
      if (fx1 === fx2 && fy1 === fy2) return null;
      return { type: 'linear', from: [fx1, fy1], to: [fx2, fy2], stops: engineStops(g.stops) };
    }
    const [fcx, fcy] = toNorm(g.cx, g.cy);
    let fr = g.r;
    if (g.gradientUnits === 'objectBoundingBox') fr = fr * Math.sqrt(pw * pw + ph * ph) / Math.sqrt(2);
    return { type: 'radial', c: [fcx, fcy], r: fr * Math.max(scale, 1e-9), stops: engineStops(g.stops) };
  };

  const engineStops = (stops: GStop[]): [number, string][] => stops.map((s) => [s.offset, toHex(s.color, s.color.a)]);

  const addShape = (n: Node, segs: Seg[], st: Style, m: Mat, strokeOnly = false) => {
    const fillRaw = strokeOnly ? 'none' : st.fill;
    let fill: Rgba | 'none' | null = null;
    let gradientRef: string | null = null;
    if (fillRaw.startsWith('url(')) {
      const gid = resolveGradientId(fillRaw);
      if (gid && gradients.has(gid)) gradientRef = gid;
      else {
        warnOnce(`градиент «${fillRaw}» не найден, заменён цветом`);
        fill = parseColor(rootStyle.fill, st.color, []) as Rgba;
      }
    } else {
      fill = parseColor(fillRaw, st.color, warnings);
    }
    if (fill === null) fill = parseColor(rootStyle.fill, st.color, []) as Rgba;
    let stroke = parseColor(st.stroke, st.color, warnings);
    if (stroke === null && st.stroke.trim().startsWith('url(')) stroke = parseColor(current, current, []);
    const sw = Math.abs(parseFloat(st.sw)) || 0;
    const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const tsegs = segs.map((s) => ({ t: s.t, p: s.p.map((p) => apply(m, p)) }));
    let pb: [number, number, number, number] | null = null;
    if (tsegs.length > 0) {
      let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
      const pgrow = (p: Pt) => { px0 = Math.min(px0, p[0]); py0 = Math.min(py0, p[1]); px1 = Math.max(px1, p[0]); py1 = Math.max(py1, p[1]); };
      for (const s of tsegs) {
        if (s.t === 'M' || s.t === 'L') { pgrow(s.p[0]); }
        else if (s.t === 'C') { pgrow(s.p[2]); }
        // Z: замыкает контур, новой точки не добавляет
      }
      if (Number.isFinite(px0)) pb = [px0, py0, px1, py1];
    }
    const strokeC = stroke && stroke !== 'none' && sw > 0 ? stroke : null;
    if (fill === 'none' && !gradientRef && !strokeC) return;
    raws.push({
      id: n.attrs.id, segs: tsegs, fill: fill === 'none' ? 'none' : fill!, gradientRef,
      fillAlpha: st.op * (Number.isFinite(parseFloat(st.fop)) ? parseFloat(st.fop) : 1),
      stroke: strokeC, strokeAlpha: st.op * (Number.isFinite(parseFloat(st.sop)) ? parseFloat(st.sop) : 1), strokeW: sw * sc, pBounds: pb,
    });
  };

  const walk = (n: Node, st: Style, m: Mat) => {
    for (const c of n.children) {
      const name = c.name.toLowerCase();
      if (name === 'lineargradient' || name === 'radialgradient') {
        const g = parseGradientElement(c, warnings);
        if (g) gradients.set(g.id, g);
        continue;
      }
      if (SKIP_SILENT.has(name)) continue;
      if (UNSUPPORTED.has(name)) { warnOnce(`элемент <${c.name}> не поддерживается и пропущен`); continue; }
      if (c.attrs.display === 'none') continue;
      const cs = readStyle(c, st);
      const cm = mul(m, parseTransform(c.attrs.transform, warnings));
      try {
        switch (name) {
          case 'g': case 'a': case 'svg': case 'switch': case 'defs': walk(c, cs, cm); break;
          case 'path': addShape(c, parsePathData(c.attrs.d ?? ''), cs, cm); break;
          case 'circle': { const r = numAttr(c, 'r'); if (r > 0) addShape(c, circleSegs(numAttr(c, 'cx'), numAttr(c, 'cy'), r, r), cs, cm); break; }
          case 'ellipse': { const rx = numAttr(c, 'rx'), ry = numAttr(c, 'ry'); if (rx > 0 && ry > 0) addShape(c, circleSegs(numAttr(c, 'cx'), numAttr(c, 'cy'), rx, ry), cs, cm); break; }
          case 'rect': {
            const w = numAttr(c, 'width'), h = numAttr(c, 'height');
            let rx = numAttr(c, 'rx', NaN), ry = numAttr(c, 'ry', NaN);
            if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
            if (Number.isNaN(ry)) ry = rx;
            if (w > 0 && h > 0) addShape(c, rectSegs(numAttr(c, 'x'), numAttr(c, 'y'), w, h, rx, ry), cs, cm);
            break;
          }
          case 'polygon': case 'polyline': {
            const v = (c.attrs.points ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
            const segs: Seg[] = [];
            for (let i = 0; i + 1 < v.length; i += 2) segs.push({ t: i === 0 ? 'M' : 'L', p: [[v[i], v[i + 1]]] });
            if (segs.length >= 2) { if (name === 'polygon') segs.push({ t: 'Z', p: [] }); addShape(c, segs, cs, cm); }
            break;
          }
          case 'line': addShape(c, [{ t: 'M', p: [[numAttr(c, 'x1'), numAttr(c, 'y1')]] }, { t: 'L', p: [[numAttr(c, 'x2'), numAttr(c, 'y2')]] }], cs, cm, true); break;
          default: warnOnce(`элемент <${c.name}> не распознан и пропущен`);
        }
      } catch (e) {
        warnOnce(`элемент <${c.name}${c.attrs.id ? ` id=${c.attrs.id}` : ''}>: ${(e as Error).message}`);
      }
    }
  };
  walk(svg, readStyle(svg, rootStyle), base);

  const resolvedGradients = resolveGradientHrefs(gradients, warnings);
  if (raws.length === 0) throw new Error('В SVG не найдено поддерживаемой геометрии (path, circle, rect и т.п.).');
  if (raws.length > maxParts) throw new Error(`Слишком много частей: ${raws.length} (лимит ${maxParts}). Упростите SVG (объедините пути) или повысьте лимит.`);

  // bounds по геометрии
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p: Pt) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const r of raws) {
    let cur: Pt = [0, 0], st: Pt = [0, 0];
    for (const s of r.segs) {
      if (s.t === 'M') { cur = st = s.p[0]; grow(cur); }
      else if (s.t === 'L') { cur = s.p[0]; grow(cur); }
      else if (s.t === 'Z') cur = st;
      else {
        grow(s.p[2]);
        for (const ax of [0, 1] as const) {
          const a = cur[ax], b = s.p[0][ax], c = s.p[1][ax], d = s.p[2][ax];
          const qa = -a + 3 * b - 3 * c + d, qb = 2 * (a - 2 * b + c), qc = b - a;
          const ts: number[] = [];
          if (Math.abs(qa) < 1e-12) { if (Math.abs(qb) > 1e-12) ts.push(-qc / qb); }
          else { const disc = qb * qb - 4 * qa * qc; if (disc >= 0) { const sq = Math.sqrt(disc); ts.push((-qb + sq) / (2 * qa), (-qb - sq) / (2 * qa)); } }
          for (const t of ts) if (t > 0 && t < 1) {
            const u = 1 - t;
            const pt: Pt = [0, 0];
            for (const k of [0, 1] as const) pt[k] = u * u * u * cur[k] + 3 * u * u * t * s.p[0][k] + 3 * u * t * t * s.p[1][k] + t * t * t * s.p[2][k];
            grow(pt);
          }
        }
        cur = s.p[2];
      }
    }
  }
  if (!Number.isFinite(x0) || x1 - x0 + (y1 - y0) <= 0) throw new Error('Геометрия SVG пустая (нулевой размер).');
  const w = x1 - x0, h = y1 - y0;
  const scale = h > 1e-9 ? targetH / h : targetH / w;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const nrm = (p: Pt): string => `${fmt((p[0] - cx) * scale)} ${fmt((p[1] - cy) * scale)}`;

  // цвета
  const fills = raws.map((r) => (r.fill === 'none' ? null : r.fill));
  const strokes = raws.map((r) => r.stroke);
  const slotNames = opts.slotNames ?? ['rim', 'whale', 'mid', 'belly'];
  const colorMap = new Map<string, string>();
  const keyOf = (c: Rgba) => `${c.r},${c.g},${c.b}`;
  if (mode === 'slots') {
    const freq = new Map<string, { c: Rgba; n: number }>();
    for (const c of [...fills, ...strokes]) if (c) { const k = keyOf(c); const e = freq.get(k); if (e) e.n++; else freq.set(k, { c, n: 1 }); }
    const top = [...freq.values()].sort((a, b) => b.n - a.n || luma(a.c) - luma(b.c)).slice(0, slotNames.length).sort((a, b) => luma(a.c) - luma(b.c));
    top.forEach((e, i) => colorMap.set(keyOf(e.c), slotNames[Math.min(i, slotNames.length - 1)]));
  }
  const colorOut = (c: Rgba, alpha: number): string => {
    if (mode === 'mono') return slotNames[1] ?? 'whale';
    if (mode === 'slots') { const s = colorMap.get(keyOf(c)); if (s && alpha >= 0.999 && c.a >= 0.999) return s; }
    return toHex(c, alpha);
  };

  const usedIds = new Set<string>();
  let totalBytes = 0;
  const parts: AssetPart[] = raws.map((r, i) => {
    let id = `p${i + 1}`;
    if (r.id && /^[A-Za-z][\w-]{0,40}$/.test(r.id) && !usedIds.has(r.id)) id = r.id;
    usedIds.add(id);
    const d = r.segs.map((s) => (s.t === 'Z' ? 'Z' : `${s.t} ${s.p.map(nrm).join(' ')}`)).join(' ');
    totalBytes += d.length;
    let fill: string | Gradient;
    if (r.gradientRef) {
      const g = resolvedGradients.get(r.gradientRef);
      const grad = g && r.pBounds ? convertGradient(g, r.pBounds, cx, cy, scale) : null;
      if (grad) fill = grad;
      else {
        warnOnce(`градиент «${r.gradientRef}»: не удалось скомпилировать, заменён цветом`);
        const first = g?.stops[0];
        fill = first ? toHex(first.color, first.color.a) : (r.fill === 'none' ? 'none' : colorOut(r.fill, r.fillAlpha));
      }
    } else fill = r.fill === 'none' ? 'none' : colorOut(r.fill, r.fillAlpha);
    const part: AssetPart = { id, name: `Часть ${i + 1}`, fill, d };
    if (r.stroke) part.stroke = { color: colorOut(r.stroke, r.strokeAlpha), w: Math.max(0.1, Math.round(r.strokeW * scale * 100) / 100) };
    return part;
  });
  if (totalBytes > maxBytes) throw new Error(`Слишком большие данные путей: ${Math.round(totalBytes / 1024)} КБ (лимит ${Math.round(maxBytes / 1024)} КБ). Упростите SVG.`);

  const hw = (w * scale) / 2, hh = (h * scale) / 2;
  return {
    parts,
    bounds: [Math.round(-hw * 100) / 100, Math.round(-hh * 100) / 100, Math.round(w * scale * 100) / 100, Math.round(h * scale * 100) / 100],
    aspect: h > 1e-9 ? w / h : 1,
    warnings,
  };
}

// ---------- общая сборка модели импорта ----------
export interface BuildImportedModelOpts {
  id: string;
  name: string;
  view: 'side' | 'bottom' | 'front' | 'top' | 'three-quarter';
  facing?: 'left' | 'right';
  sizeM: number;
  sizeAxis?: 'height' | 'width';
  tags?: string[];
  license: { name: string; author?: string; source?: string; url?: string; attribution?: boolean };
}

export function buildImportedModel(res: SvgImportResult, opts: BuildImportedModelOpts): CatalogAsset {
  const aspect = res.aspect || 1;
  const sizeAxis = opts.sizeAxis ?? 'height';
  let widthM: number, heightM: number;
  if (sizeAxis === 'width') { widthM = opts.sizeM; heightM = opts.sizeM / aspect; }
  else { heightM = opts.sizeM; widthM = opts.sizeM * aspect; }
  return {
    version: 1,
    id: opts.id,
    name: opts.name,
    bounds: res.bounds,
    realSize: { heightM, widthM },
    meta: {
      view: opts.view,
      facing: opts.facing,
      tags: opts.tags ?? [],
      license: {
        name: opts.license.name,
        author: opts.license.author ?? '',
        source: opts.license.source ?? '',
        url: opts.license.url,
        attribution: opts.license.attribution ?? false,
      },
    },
    parts: res.parts,
  };
}
