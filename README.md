# animation-motion

Локальный комбайное для создания видео из кода: текст → сцены → графика на Canvas 2D → MP4. Этап 0 — каркас проекта (Vite + TypeScript, без фреймворков).

## Быстрый старт

- Запуск: двойной клик по `run.bat` — редактор откроется на http://localhost:5173 (остановить — `stop.bat`).
- Ключи ИИ: скопируйте `.env.example` в `.env.local` и впишите `GEMINI_API_KEY` и `GROQ_API_KEY`. `.env.local` в git не попадает, ключи никуда не отправляйте и в чат их не слать.
- Вкладка «Проект»: введите идею ролика и нажмите «Создать одной кнопкой (Gemini → Groq)». Чекбокс «Сразу собрать видео» после создания проекта запускает полный экспорт.
- Вкладка «Склейка»: «Экспорт MP4» собирает весь ролик (работает при запуске через `run.bat`, нужен локальный сервис), «Проба» — кадр, кусок или уменьшенную версию: быстрее, но финал не заменяет. Из командной строки: `npm run export -- --project <project.json>`.
- Вкладка «Сцены»: панель «Образ сцены» — стиль, настроение, приём камеры.
- Каталог: 172 модели; авторы и лицензии — в `docs/THIRD-PARTY.md`.
- Open Code + MCP: `run-mcp.bat`, тестовый промт — в `docs/MCP-TEST.md`.

## Команды

- `npm run dev` — запуск dev-сервера (Vite)
- `npm run build` — сборка в `dist/`
- `npm run preview` — предпросмотр сборки
- `npm run typecheck` — проверка типов TypeScript
- `npm run check:schema` — валидация JSON-сцены и схемы
- `npm run check:project` — проверка формата проекта и переходов между кадрами
- `npm run check:history` — проверка отмены и повтора
- `npm run check:render` — самопроверка воспроизводимости кадров через Node
- `npm run compare:frames` — сверка Node-рендера с эталоном M0 в `reference/m0/baseline/`
- `npm run export -- <scene.json> --format h|v [--fps 30] [--range A:B] [--out ...] [--crf 18] [--preset veryfast]` — экспорт одной сцены в MP4
- `npm run export -- --project <project.json> [--format 16:9|9:16] [--fps 30]` — экспорт проекта в MP4
- `npm run contact -- --project <project.json> [--step 0.5] [--cols 6] [--thumb 320]` — контактный лист в `out/contact/`

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
