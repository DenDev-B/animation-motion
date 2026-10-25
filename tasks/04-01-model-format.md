# Задание 04-01: формат модели v1 (точки, позы, клипы, метаданные)

## Контракт (всё необязательное, старые модели без изменений)
Расширение CatalogAsset и inline-модели `shape`:
- `parts[].points?: [number, number][]` (3..80 точек) + `closed?: boolean` (по умолчанию true) + `smooth?: number` (0..1, 0 = ломаная, 1 = максимально сглаженная кривая; реализовать сплайном Catmull-Rom → кубические Безье). У части должно быть РОВНО одно из `d` или `points` (для part.type=path); для line/circle поля как раньше.
- `poses?: Record<string, { parts: Record<partId, { points?: [x,y][] (та же длина, что у базовых points части), off?: [x,y], rot?: number (радианы, вокруг pivot части или центра bounds), s?: number, alpha?: number }> }>`. Базовая поза неявная (`base`) = части как нарисованы.
- `clips?: Record<string, { period: number (сек, > 0), loop?: boolean (по умолчанию true), ease?: 'lin'|'sine'|'inOut', keys: { pose: string (имя позы или 'base'), at: number (0..1, по возрастанию, первый ключ at=0) }[] }>`. Значение клипа в момент t = блендинг соседних поз по фазе ((t / period) + phase) mod 1, цикл замыкается на первую позу.
- `meta?: { view?: 'side'|'bottom'|'front'|'top'|'three-quarter', facing?: 'left'|'right', tags?: string[], license?: { name: string, source?: string, author?: string }, anchor?: [x,y], realSize?: { widthM?: number, heightM?: number } }` (realSize остаётся и на верхнем уровне для старых моделей; новые поля читать из обоих мест, верхний приоритетнее).
- `mesh?: unknown` заготовка под этап 9: не валидировать содержимое и не рисовать.
- Параметры объекта (kind asset и shape): `params.pose?: string` (статичная поза), `params.clip?: string`, `params.clipSpeed?: number (>0, 1)`, `params.clipPhase?: number (0..1, 0)`. Если заданы оба pose и clip, клип главнее.

## Сделать
1. Типы, engine/spec.ts, валидатор (validateAsset): длины points одинаковы во всех позах, ссылки на части и позы существуют, at по возрастанию, period > 0, пределы размеров (до 40 частей, до 80 точек на часть), понятные русские ошибки с путями.
2. Рендер: общая функция вычисления состояния частей `evalPartState(asset, params, t)` (чистая, без DOM), используется и в Node, и в редакторе; существующие `partAnim` и `anim` частей работают как раньше поверх позы. Кэш контуров по хэшу (id, поза/фаза квантованы до 1/240).
3. docs/SCHEMA-model-v1.md генерируется из spec (`npm run docs:schema`), с двумя короткими примерами (рыба из points с 2 позами и клип «плыть»; тот же пример через `shape`).
4. Проверки: старые модели EXACT; поза A при фазе 0 даёт кадр, побайтно равный статичной позе A; середина между позами равна ожидаемому усреднению точек (проверка чистой функции, допуск 1e-9); клип периодичен (кадр t и t+period EXACT); независимость от порядка кадров; негативные тесты (минимум 15).
5. Фикстуры scenes/fixtures/model-fish-clip.json (рыба из points, 3 позы, клип) и model-fish-clip-shape.json (то же через shape); контактные листы 16x9 и 9x16.

## Приёмка
M0 6/6 EXACT, SHA whale-demo прежний, `npm run check` PASS, check:docs PASS.

## Не делать
Не вводить кости. Не реализовывать mesh. Не менять схему сцены.
