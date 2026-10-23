# ARCHITECTURE.md — архитектура комбайна (этап 0)

## Слои проекта

| Папка | Назначение |
|---|---|
| `engine/` | Рендер без UI. Только Canvas 2D API, никакого DOM. Публичный API через `engine/index.ts`. |
| `editor/` | Минимальный интерфейс редактора (загрузка сцены, скраббер, переключатель 16:9/9:16, редактор JSON, проигрывание). |
| `catalog/` | Модели объектов в JSON (например, `catalog/whale.json`). |
| `scenes/` | Сцены в JSON (например, `scenes/whale-demo.json`). |
| `tools/` | Скрипты: извлечение сцены из M0, проверка схемы, self-test рендера, сравнение кадров с M0. |
| `reference/` | Эталоны, только чтение (`reference/m0/scene-sandbox.html` — исходный прототип M0). |
| `docs/` | Проектная документация (AGENTS.md, PROJECT_RULES.md, PROJECT_STATE.md, motion-roadmap.md, IDEAS.md, ARCHITECTURE.md). |
| `out/` | Временные выходные данные проверок (PNG, отчёты), не коммитится (в `.gitignore`). |

## Поток данных

JSON-сцена (`scenes/*.json`) + каталог (`catalog/*.json`) → `renderFrame(ctx, scene: SceneV1, t: number, size: {w,h}, env: RenderEnv)` → холст Canvas 2D.

`env` (тип `RenderEnv` в `engine/index.ts`) содержит:
- `createCanvas(w, h)` — создаёт canvas-подобный объект. В редакторе это `document.createElement('canvas')` с заданным width/height; в `engine/` сам холст не создаёт.
- `catalog: Record<string, CatalogAsset>` — каталог моделей (кит и др.), доступный рендеру по `id`.
- `cache: ReturnType<typeof createRenderCache>` — кэш спрайтов облаков, геометрии горизонта и шумовой плитки, чтобы не пересчитывать между кадрами.

Почему `engine/` не знает про DOM: рендер должен быть детерминированной чистой функцией от `(ctx, scene, t, size, env)`, пригодной к запуску вне браузера (Node, оффлайн-рендер, сравнение кадров). Все DOM-зависимостиisolрованы в `editor/`.

## Правила рендера (по одной строке на пункт, см. PROJECT_RULES.md § «Правила рендера»)

1. Кадр = чистая функция от времени `t` и сцены; время приходит параметром, не вычисляется внутри. (PROJECT_RULES.md:18)
2. В коде рендера запрещены `Math.random`, `Date.now`, `performance.now`; случайность только через `rng(seed)`. (PROJECT_RULES.md:19)
3. Мировые единицы: высота кадра = 1000, центр (0,0), ось y вниз; размеры в сценах — в мировых единицах, реальные — в метрах отдельным полем. (PROJECT_RULES.md:20)
4. Слои рисуются в порядке списка (первый самый дальний); `depth` задаёт параллакс: 0 фон, 1 действие, >1 передний план. (PROJECT_RULES.md:21)
5. Цвета из `palette` (слоты) или `#hex`; один стиль, смена настроения = смена палитры. (PROJECT_RULES.md:22)
6. Форматы 16:9 и 9:16 работают оба. (PROJECT_RULES.md:23)

## Проверки и что они доказывают

| Команда | Доказывает | Не доказывает |
|---|---|---|
| `npm run typecheck` | Типы TypeScript корректны, `tsc --noEmit` чист | Работоспособность рендера, совпадение с M0 |
| `npm run build` | Vite-сборка успешна, модули склеиваются | Качество картинки, точность кадров |
| `npm run check:schema` | Сцены и каталог соответствуют контракту v1; негативные случаи отлавливаются | Визуальное совпадение с M0 |
| `npm run check:render` | Кадр воспроизводится побайтно (t=0 дважды, t=6, возврат к t=0) — нет скрытого состояния между кадрами | Совпадение с эталоном M0, красота картинки |
| `npm run compare:frames` | Кадры нового рендера побайтно совпадают с M0 (t=0,6,12 × 16:9/9:16); кадры не пустые, время влияет на картинку | То, что картинка «красивая» или соответствует замыслу |

## Что реально есть в коде (факты, без выдумок)

- `engine/index.ts` экспортирует `renderFrame`, `createRenderCache`, типы схемы и `validateScene`.
- `engine/` не импортирует `editor/` и `tools/`; в `engine/` нет обращений к `document`, `window`, `localStorage`, `DOMPoint`, `requestAnimationFrame`, `setTimeout`, `setInterval`, `Math.random`, `Date.now`, `performance.now`, `fetch`.
- `editor/main.ts` экспонирует `window.__editor = { setT(t), setAspect(a) }` для сверки с M0.
- Кит живёт в `catalog/whale.json`; сцена `scenes/whale-demo.json` ссылается на него по `asset: "whale"`.
- `scene-sandbox.html` в `reference/` не меняется — только чтение.
