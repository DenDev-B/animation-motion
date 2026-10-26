import fs from 'node:fs';
import path from 'node:path';
import { importSvg } from '../engine/svg-import.ts';
import { validateAsset } from '../engine/validate.ts';

const dir = path.join(process.cwd(), 'tests', 'svg');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();
let errors = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const r1 = importSvg(src, { colors: 'keep' });
  const r2 = importSvg(src, { colors: 'keep' });
  if (JSON.stringify(r1) !== JSON.stringify(r2)) { console.error(f, 'not reproducible'); errors++; }
  const b = r1.bounds;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) { console.error(f, 'bounds not [x,y,w,h]'); errors++; }
  else {
    const [x, y, w, h] = b;
    if (w <= 0 || h <= 0) { console.error(f, 'bounds width/height not positive'); errors++; }
    if (Math.abs(x - (-w / 2)) > 1e-6 || Math.abs(y - (-h / 2)) > 1e-6) { console.error(f, 'bounds not centered (x=-w/2, y=-h/2)'); errors++; }
  }
  const model: any = { version: 1, id: 't', name: 't', bounds: r1.bounds, realSize: { heightM: 1, widthM: r1.aspect }, meta: { view: 'side', license: { name: 'own' } }, parts: r1.parts };
  const v = validateAsset(model);
  if (!v.ok) { console.error(f, 'invalid', JSON.stringify(v.errors)); errors++; }
  if (f === 'tests/svg/6.svg' || f.endsWith('6.svg')) {
    const hasGrad = r1.warnings.some((w) => /gradient|градиент/i.test(w));
    const hasText = r1.warnings.some((w) => /text|текст/i.test(w));
    if (!hasGrad || !hasText) { console.error(f, 'missing warnings'); errors++; }
  }
}

// Дуги: круг из двух дуг (7.svg) после импорта лежит на окружности радиуса 100 (высота нормализована до 200), допуск 0.5%.
{
  const src = fs.readFileSync(path.join(dir, '7.svg'), 'utf8');
  const r = importSvg(src, { colors: 'keep' });
  const nums = (r.parts[0].d as string).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  // M p0, затем C по три точки: проверяем конечные точки каждой кривой и середину t=0.5
  let bad = 0;
  const onCircle = (x: number, y: number) => Math.abs(Math.hypot(x, y) - 100) <= 0.5;
  if (!onCircle(pts[0][0], pts[0][1])) bad++;
  for (let i = 1; i + 2 < pts.length; i += 3) {
    const p0 = pts[i - 1], a = pts[i], b = pts[i + 1], e = pts[i + 2];
    if (!onCircle(e[0], e[1])) bad++;
    const mx = (p0[0] + 3 * a[0] + 3 * b[0] + e[0]) / 8, my = (p0[1] + 3 * a[1] + 3 * b[1] + e[1]) / 8;
    if (!onCircle(mx, my)) bad++;
  }
  if (bad > 0) { console.error('7.svg: точки дуг не на окружности:', bad); errors++; }
}
console.log(errors === 0 ? 'check:svg-import OK' : `check:svg-import FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
