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
  const model: any = { version: 1, id: 't', name: 't', bounds: r1.bounds, realSize: { heightM: 1, widthM: r1.aspect }, meta: { view: 'side', license: { name: 'own' } }, parts: r1.parts };
  const v = validateAsset(model);
  if (!v.ok) { console.error(f, 'invalid', JSON.stringify(v.errors)); errors++; }
  if (f === 'tests/svg/6.svg' || f.endsWith('6.svg')) {
    const hasGrad = r1.warnings.some((w) => /gradient|градиент/i.test(w));
    const hasText = r1.warnings.some((w) => /text|текст/i.test(w));
    if (!hasGrad || !hasText) { console.error(f, 'missing warnings'); errors++; }
  }
}
console.log(errors === 0 ? 'check:svg-import OK' : `check:svg-import FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
