# ARCHITECTURE.md — архитектура комбайна (этапы 0–3)

## Слои проекта

| Папка | Назначение |
|---|---|
| `engine/` | Рендер без UI. Только Canvas 2D API, никакого DOM. Публичный API через `engine/index.ts`. |
| `editor/` | Минимальный интерфейс редактора (загрузка сцены, скраббер, переключатель 16:9/9:16, редактор JSON, проигрывание). |
| `catalog/` | Модели объектов в JSON (например, `catalog/whale.json`). |
| `scenes/` | Сцены в JSON (например, `scenes/whale-demo.json`) и фикстуры `scenes/fixtures/`. |
| `projects/` | Проекты v1: список сцен, переходы, fps, формат (`ProjectV1`). |
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

## Этап 3 (актуальное состояние)

- **Контракт.** `engine/spec.ts` — единственный источник описания `kind`, `anim` и полей сцены; из него строятся валидатор (`engine/validate.ts`), `docs/SCHEMA-v1.md` (`npm run docs:schema`) и ИИ-подсказка (`engine/ai-io.ts`).
- **Объекты.** Добавлены `kind`: `stars`, `rain`, `snow`, `birds`, `text`, `counter`, `asset` (каталог), `shape` (inline-модель). Слой остаётся группой объектов с `depth`; новых сущностей-слоёв нет.
- **Фон.** `mountains`, `hills`, `skyline` расширены параметрами (высота, окна, дымка); луна/солнце — примеры `shape`, отдельных `kind` нет.
- **Проект.** `engine/project.ts` — `ProjectV1` (сцены, fps, формат), переходы `cut/fade/dip/slide/crossfade`, `projectFrameCount`, `locateFrame` (пара кадров + прогресс перехода), `composeFrame`.
- **Метры.** `world.unitsPerMeter` + `params.sizeM` для `asset`; без `world` поведение старых сцен не меняется. Каталог хранит `realSize` (высота/ширина в метрах).
- **Камера.** `camera.verticalFit` для 9:16, ключи `x/y/zoom`, `camera.shake` (окно, `decay: out`) и пресеты в редакторе.
- **Редактор.** Редактор JSON: область «сцена / весь проект / выбранный объект», проверка, undo/redo; панель ИИ: промпт → ответ → проверка → применение → запрос на исправление. Ручной режим остаётся основным.
- **Инструменты.** `tools/export.ts` (`--project`, `--format h|v`), `tools/contact-sheet.ts` (проект, формат из `project.format`), `tools/ai-prompt.ts` (промпт по сцене и задаче).

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
| `npm run check:schema` | Сцены, проекты и каталог соответствуют контракту v1; негативные случаи отлавливаются | Визуальное совпадение с M0 |
| `npm run check:project` | Проекты валидны: сцены, переходы, fps, формат, число кадров | Красоту и плавность |
| `npm run check:transitions` | Переходы дают непрерывный таймлайн и ожидаемое число кадров | Цветопередачу и субъективное качество |
| `npm run check:history` | Undo/redo и JSON-правки сцена/проект/объект не мутируют исходник | Работу интерфейса в браузере |
| `npm run check:names` | Имена объектов/слоёв уникальны и пригодны для UI | Полноту сцены |
| `npm run check:docs` | `docs/SCHEMA-v1.md` побайтно совпадает с генерацией из `engine/spec.ts` | Полноту архитектурной прозы |
| `npm run check:roundtrip` | JSON проходит извлечение из ответа ИИ и обратную проверку | Правильность смысла ответа ИИ |
| `npm run check:units` | `world`/`sizeM` дают реальные высоты моделей в пределах 1% | Реальную геометрию всех сцен |
| `npm run check:shake` | Тряска камеры детерминирована, лежит в окне и непрерывна | Визуальный вкус тряски |
| `npm run check:render` | Кадр воспроизводится побайтно (t=0 дважды, t=6, возврат к t=0) — нет скрытого состояния между кадрами | Совпадение с эталоном M0, красота картинки |
| `npm run compare:frames` | Кадры нового рендера побайтно совпадают с M0 (t=0,6,12 × 16:9/9:16); кадры не пустые, время влияет на картинку | То, что картинка «красивая» или соответствует замыслу |

## Экспорт MP4

- Путь B (основной): `tools/export.ts` — `engine.renderFrame` + `@napi-rs/canvas`, сырые RGBA в stdin ffmpeg (`-f rawvideo -pix_fmt rgba`), кодирование `libx264 -pix_fmt yuv420p -preset veryfast -crf 18 -movflags +faststart`, один холст и один буфер на весь экспорт, бэкпрешер через `stdin.drain`. CLI: `npm run export -- --project project.json --format h|v` (также принимает сцену; `--size`, `--fps`, `--range`, `--out`). После записи ffprobe проверяет кодек, pix_fmt, размер, fps, число кадров и длительность.
- Путь A (запасной): `tools/export-a.ts` — puppeteer-core + vite preview, `image2pipe(PNG)` в ffmpeg._MEDЛЕННЫЙ_ (~70–93 мс/кадр на этом железе).
- Путь C (WebCodecs): не исследован (идея #1 в docs/IDEAS.md).

## Что реально есть в коде (факты, без выдумок)

- `engine/index.ts` экспортирует `renderFrame`, `createRenderCache`, типы схемы и `validateScene`.
- `engine/` не импортирует `editor/` и `tools/`; в `engine/` нет обращений к `document`, `window`, `localStorage`, `DOMPoint`, `requestAnimationFrame`, `setTimeout`, `setInterval`, `Math.random`, `Date.now`, `performance.now`, `fetch`.
- `editor/main.ts` экспонирует `window.__editor = { setT(t), setAspect(a) }` для сверки с M0.
- Кит живёт в `catalog/whale.json`; сцена `scenes/whale-demo.json` ссылается на него по `asset: "whale"`.
- `scene-sandbox.html` в `reference/` не меняется — только чтение.
