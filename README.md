# animation-motion

Локальный комбайное для создания видео из кода: текст → сцены → графика на Canvas 2D → MP4. Этап 0 — каркас проекта (Vite + TypeScript, без фреймворков).

## Команды

- `npm run dev` — запуск dev-сервера (Vite)
- `npm run build` — сборка в `dist/`
- `npm run preview` — предпросмотр сборки
- `npm run typecheck` — проверка типов TypeScript
- `npm run check:schema` — валидация JSON-сцены и схемы
- `npm run check:render` — самопроверка воспроизводимости кадров (Chrome headless)
- `npm run compare:frames` — сверка кадров нового рендера с эталоном M0 (Chrome headless, пиксели, out/compare/)

## Структура

| Папка | Назначение |
|---|---|
| `engine/` | рендер без UI |
| `editor/` | интерфейс редактора |
| `catalog/` | модели объектов (JSON) |
| `scenes/` | сцены (JSON) |
| `tools/` | скрипты экспорта и конвертации |
| `tasks/` | текстовые задания этапов |
| `docs/` | проектная документация |
| `reference/` | эталоны, только чтение |

Правила: `PROJECT_RULES.md`. Этапы: `docs/motion-roadmap.md`.
