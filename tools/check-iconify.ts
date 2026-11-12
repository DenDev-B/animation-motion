// Пакетный импорт Iconify: чистая функция на синтетическом наборе и инварианты импортированной части каталога.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAsset } from '../engine/validate.ts';
import { buildModelsFromIconify, indexEntry, type IconifyInfo, type IconifySet, type ListItem } from './import-iconify.ts';

let failures = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`OK   ${label}`); } catch (e) { failures++; console.error(`FAIL ${label}: ${e instanceof Error ? e.message : String(e)}`); } };

const info: IconifyInfo = { name: 'Тестовый набор', author: { name: 'Автор Теста', url: 'https://example.org' }, license: { title: 'MIT', spdx: 'MIT', url: 'https://example.org/LICENSE' } };
const set: IconifySet = {
  width: 32, height: 32,
  icons: {
    box: { body: '<path fill="#ff0000" d="M4 4h24v24H4z"/><circle cx="16" cy="16" r="6" fill="#00ff00"/>' },
    wide: { body: '<path fill="#0000ff" d="M0 8h32v16H0z"/>' },
    grad: { body: '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><path fill="url(#g)" d="M4 4h24v24H4z"/>' },
    empty: { body: '<g fill="none"></g>' },
  },
  aliases: { cube: { parent: 'box' } },
};
const list: ListItem[] = [
  { icon: 'box', id: 'box-t', name: 'Коробка', tags: ['коробка', 'box'], view: 'front', sizeM: 2 },
  { icon: 'wide', id: 'wide-t', name: 'Лента', tags: ['лента'], view: 'side', sizeM: 10, sizeAxis: 'width', facing: 'left' },
  { icon: 'cube', id: 'cube-t', name: 'Куб (псевдоним)', tags: [], view: 'front', sizeM: 1 },
  { icon: 'grad', id: 'grad-t', name: 'Градиент', tags: [], view: 'front', sizeM: 1 },
  { icon: 'empty', id: 'empty-t', name: 'Пусто', tags: [], view: 'front', sizeM: 1 },
  { icon: 'nope', id: 'nope-t', name: 'Нет', tags: [], view: 'front', sizeM: 1 },
  { icon: 'box', id: 'box-t', name: 'Дубль id', tags: [], view: 'front', sizeM: 1 },
  { icon: 'box', id: 'busy', name: 'Занят', tags: [], view: 'front', sizeM: 1 },
];

const r = buildModelsFromIconify(set, info, list, new Set(['busy']));
t('в каталог идут только годные: box, wide, cube', () => assert.deepEqual(r.models.map((m) => m.id), ['box-t', 'wide-t', 'cube-t']));
t('пропуски названы с причиной: градиент, пусто, нет рисунка, дубль, занятый id', () => {
  const why = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
  assert.match(why['grad-t'], /градиент/); assert.match(why['empty-t'], /не удался|нет ни одной части/); assert.match(why['nope-t'], /нет рисунка/);
  assert.match(why['busy'], /уже есть/); assert.equal(r.skipped.length, 5);
});
t('все модели проходят validateAsset', () => { for (const m of r.models) assert.ok(validateAsset(m).ok, m.id); });
t('лицензия, автор, источник и титры записаны', () => {
  for (const m of r.models) {
    const lic = m.meta?.license; assert.ok(lic, m.id);
    assert.equal(lic.name, 'MIT'); assert.equal(lic.author, 'Автор Теста');
    assert.equal(lic.attribution, true); assert.match(lic.source ?? '', /Тестовый набор/);
  }
});
t('размер по высоте и по ширине', () => {
  const box = r.models[0]; const wide = r.models[1];
  assert.equal(box.realSize?.heightM, 2); assert.ok(Math.abs((box.realSize?.widthM ?? 0) - 2) < 0.01);
  assert.equal(wide.realSize?.widthM, 10); assert.ok(Math.abs((wide.realSize?.heightM ?? 0) - 5) < 0.01, 'лента 32x16: высота вдвое меньше ширины');
  assert.equal(wide.meta?.facing, 'left');
});
t('результат детерминирован', () => assert.equal(JSON.stringify(buildModelsFromIconify(set, info, list, new Set(['busy']))), JSON.stringify(r)));
t('без лицензии набора импорт запрещён', () => assert.throws(() => buildModelsFromIconify(set, { name: 'x' }, list), /лиценз/));
t('строка индекса: поля как у остального каталога', () => {
  const e = indexEntry(r.models[0]);
  assert.deepEqual(Object.keys(e), ['id', 'name', 'file', 'tags', 'view', 'realSize', 'license', 'attribution']);
  assert.equal(e.file, 'box-t.json'); assert.equal(e.license, 'MIT'); assert.equal(e.attribution, true);
});

// ---- инварианты импортированной части каталога ----
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = path.join(root, 'catalog');
const index = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index.json'), 'utf8')) as Array<ReturnType<typeof indexEntry>>;
const items = JSON.parse(fs.readFileSync(path.join(root, 'catalog-sources', 'fluent-emoji.json'), 'utf8')) as ListItem[];
t('список: id уникальны, размеры положительны, виды допустимы', () => {
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const i of items) { assert.ok(i.sizeM > 0, i.id); assert.ok(['side', 'bottom', 'front', 'top', 'three-quarter'].includes(i.view), i.id); assert.ok(i.tags.length > 0 && i.name, i.id); }
});
t('каждый пункт списка есть в каталоге: файл, индекс, модель валидна', () => {
  const byId = new Map(index.map((e) => [e.id, e]));
  for (const i of items) {
    const file = path.join(catalogDir, `${i.id}.json`);
    assert.ok(fs.existsSync(file), `нет файла ${i.id}.json`); assert.ok(byId.has(i.id), `нет в индексе ${i.id}`);
    assert.ok(validateAsset(JSON.parse(fs.readFileSync(file, 'utf8'))).ok, `${i.id} не проходит validateAsset`);
  }
});
t('в индексе нет повторов id и нет записей без файла', () => {
  assert.equal(new Set(index.map((e) => e.id)).size, index.length);
  for (const e of index) assert.ok(fs.existsSync(path.join(catalogDir, e.file)), `нет файла ${e.file}`);
});
t('импортированные модели: MIT, автор Microsoft, титры включены', () => {
  for (const i of items) {
    const m = JSON.parse(fs.readFileSync(path.join(catalogDir, `${i.id}.json`), 'utf8'));
    assert.equal(m.meta.license.name, 'MIT', i.id); assert.equal(m.meta.license.author, 'Microsoft Corporation', i.id); assert.equal(m.meta.license.attribution, true, i.id);
  }
});
t('лицензионный текст лежит в репозитории (docs/THIRD-PARTY.md)', () => {
  const doc = fs.readFileSync(path.join(root, 'docs', 'THIRD-PARTY.md'), 'utf8');
  assert.match(doc, /Microsoft Corporation/); assert.match(doc, /Permission is hereby granted/);
});

console.log(failures ? `check:iconify FAIL (${failures})` : 'check:iconify PASS');
process.exit(failures ? 1 : 0);
