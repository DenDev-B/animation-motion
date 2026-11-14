# Сторонние материалы

## Fluent Emoji Flat (Microsoft)

В каталог (`catalog/*-flat.json`, 162 модели) вошли рисунки набора Fluent Emoji Flat, пересобранные в наш формат моделей скриптом `tools/import-iconify.ts`. Список рисунков и размеров в метрах: `catalog-sources/fluent-emoji.json`. Размеры ориентировочные.

- Автор: Microsoft Corporation
- Источник: https://github.com/microsoft/fluentui-emoji (через npm-пакет `@iconify-json/fluent-emoji-flat`)
- Лицензия: MIT. Условие лицензии: сохранять уведомление об авторских правах и текст лицензии при распространении копий. Поэтому этот файл лежит в репозитории, а у каждой модели записаны автор и лицензия.

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Перед публикацией сверьте текст лицензии со страницей набора: она может меняться.

## Озвучка (TTS)

Ничего из перечисленного ниже в репозиторий не попадает и не поставляется с проектом — `npm run tts` только вызывает внешние программы (`docs/TTS.md`).

- **Piper** — движок озвучки, который вызывает внешний процесс. Лицензия: GPLv3. Мы его не устанавливаем, не вшиваем и не распространяем: владелец ставит сам (`pip install piper-tts`) и запускает своей командой.
- **Голоса Piper** — модель на `.onnx` и её конфиг. Лицензию каждого голоса надо сверить по карточке голоса на Hugging Face и записать сюда; названия голосов и лицензии здесь не приведены, потому что набор голосов меняется. Файлы голосов и готовые `audio/tts/*.wav` в git не коммитятся (`.gitignore`: `audio/*`).
- **Windows SAPI (`System.Speech`)** — системный компонент Windows, используется только тот голос, который установлен в системе у владельца. Мы ничего не включаем в поставку.
