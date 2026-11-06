import assert from 'node:assert';
import { checkModelJsonText, formatModelJson, previewAssetFor, catalogWithDraft } from '../editor/catalog.ts';
import type { CatalogAsset } from '../engine/schema.ts';

const asset: CatalogAsset = { version: 1, id: 'box', name: 'Ящик', bounds: [-10, -10, 20, 20], realSize: { widthM: 1 }, meta: { view: 'side', license: { name: 'own' } }, parts: [{ id: 'p', name: 'p', d: 'M -10 -10 L 10 -10 L 10 10 L -10 10 Z', fill: '#fff' }] };
const text = formatModelJson(asset);
assert.ok(text.includes('\n  '), 'JSON с отступами');
const round = checkModelJsonText(text);
assert.ok(round.ok && round.asset, 'текст редактора возвращается в валидную модель');
assert.deepEqual(round.asset, asset, 'формат → разбор без потерь');

// правка кода: меняем цвет — черновик главнее каталога
const edited = checkModelJsonText(text.replace('#fff', '#ff0000'));
assert.ok(edited.ok, 'правка цвета валидна');
assert.equal(previewAssetFor(asset, edited)?.parts[0].fill, '#ff0000', 'превью берёт черновик');
const cat = { box: asset };
assert.equal(catalogWithDraft(cat, edited.asset).box.parts[0].fill, '#ff0000', 'в каталоге превью модель подменена');
assert.equal(cat.box.parts[0].fill, '#fff', 'сам каталог не изменился');

// сломанный код: превью остаётся на модели каталога, ошибки с путём
const broken = checkModelJsonText(text.replace('"bounds"', '"bounds_"'));
assert.ok(!broken.ok && broken.errors.length > 0, 'потеря bounds — ошибка');
assert.equal(previewAssetFor(asset, broken), asset, 'при ошибке превью = каталог');
assert.ok(!checkModelJsonText('{ не json').ok, 'битый JSON — ошибка разбора');

// градиент в коде модели проходит проверку
const grad = checkModelJsonText(text.replace('"fill": "#fff"', '"fill": {"type":"linear","from":[0,-10],"to":[0,10],"stops":[[0,"#fff"],[1,"#000"]]}'));
assert.ok(grad.ok, `градиент допустим: ${JSON.stringify(grad.errors)}`);
console.log('check:catalog-code PASS');
