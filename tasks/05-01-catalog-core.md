# Задание 05-01: каталог приложения, метаданные моделей, ссылки по id

## Сделать
1. **Метаданные модели** (необязательные поля CatalogAsset, также читаются у inline-модели `shape`): `meta?: { view?: 'side'|'bottom'|'front'|'top'|'three-quarter', facing?: 'left'|'right', tags?: string[], anchor?: [x,y], license?: { name: string, author?: string, source?: string, url?: string, attribution?: boolean }, realSize?: { widthM?: number, heightM?: number } }`. Верхнеуровневый `realSize` старых моделей продолжает работать (приоритет верхнего). `meta.license.attribution = true` означает «автора надо указывать».
2. spec.ts, validateAsset (понятные русские ошибки; для каталога обязательны id, name, meta.view, meta.license.name и хотя бы одно измерение realSize; для inline-shape не обязательны), `npm run docs:schema`.
3. **Индекс каталога**: `npm run catalog:index` генерирует catalog/index.json (id, name, file, tags, view, realSize, license.name, attribution). `npm run check:catalog` (в `npm run check`): индекс актуален, все модели валидны.
4. **Загрузчик** `engine/catalog.ts` (чистые функции без DOM/Node API): `resolveAsset(id, scene, catalogMap)`: сначала scene.assets (переопределение), затем каталог. Если id не найден, ошибка валидатора со списком доступных id (первые 20). Node-обёртка читает catalog/; редактор получает список через dev-сервер (GET /api/catalog из 05-02; пока временно из статического импорта индекса). Валидатор сцены принимает ссылку на asset из каталога без копии в scene.assets.
5. **Миграция существующих моделей** (whale, human, house, plane и др.): добавить meta (view, facing, теги на русском и английском, license.name = "own", attribution=false), realSize как есть (кит 15 м по ширине). Внешний вид сцен не меняется.
6. `npm run project:bundle -- <project.json>`: копия проекта со встроенными использованными моделями (scene.assets). Копия валидна и рендерится идентично оригиналу (EXACT: кадры 0, середина, последний).
7. `ai:prompt` для сцены или проекта вместо вставки полных моделей добавляет блок «Доступные модели каталога» (id, name, tags, view, realSize), по строке на модель. Размер промта stage3-demo вырастает не более чем на 3 КБ.
8. Список титров: функция `collectCredits(project, catalogMap)` возвращает уникальные записи (модель, автор, лицензия, источник) для моделей, использованных в проекте, с attribution=true. CLI `npm run credits -- <project.json>` печатает текст и пишет out/credits/<имя>_credits.txt.

## Приёмка
M0 6/6 EXACT, SHA whale-demo прежний, check:catalog PASS, bundle EXACT, `npm run check` PASS.

## Не делать
Не вводить позы и клипы. Не менять сцены и проекты.
