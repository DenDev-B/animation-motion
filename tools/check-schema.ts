import fs from 'node:fs';
import assert from 'node:assert';
import { validateScene } from '../engine/validate.ts';
import { extractDemoScene } from '../tools/extract-m0-scene.ts';
import type { SceneV1 } from '../engine/schema.ts';

const catalogIds = ['whale'];
const { scene: expected } = extractDemoScene();
const raw = JSON.parse(fs.readFileSync('scenes/whale-demo.json', 'utf8')) as unknown;
const actual = raw as SceneV1;

// (а) сцена проходит валидацию
const ok = validateScene(actual, { catalogIds });
assert.ok(ok.ok, `whale-demo.json не проходит валидацию: ${JSON.stringify(ok.errors)}`);

// (б) отрицательные проверки
function expectFail(modifier: (s: any) => void, label: string) {
  const s = JSON.parse(JSON.stringify(actual));
  modifier(s);
  const res = validateScene(s, { catalogIds });
  assert.ok(!res.ok, `${label}: ожидалась ошибка, сцена прошла`);
  assert.ok(res.errors.length > 0, `${label}: ошибок нет`);
}

expectFail((s) => { s.layers.push({ ...s.layers[0] }); }, 'дубль id');
expectFail((s) => { s.layers[0].objects[0].kind = 'unknown' as never; }, 'неизвестный kind');
expectFail((s) => { delete s.palette; }, 'нет palette');
expectFail((s) => { s.version = 2; }, 'version 2');
expectFail((s) => { s.layers[0].objects.push({ id: 'obj-x', name: 'x', kind: 'asset', asset: 'nope' }); }, 'asset на несуществующий id');
expectFail((s) => { s.layers[0].objects[0].anim = [{ type: 'wiggle' }] as never; }, 'неизвестный anim.type');

// (в) структура совпадает с demo() M0 (id игнорируются)
function stripIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIds);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'id') continue;
      if (val === undefined) continue;
      out[k] = stripIds(val);
    }
    return out;
  }
  return v;
}

assert.strictEqual(JSON.stringify(stripIds(actual)), JSON.stringify(stripIds(expected)));

console.log('check:schema OK');
