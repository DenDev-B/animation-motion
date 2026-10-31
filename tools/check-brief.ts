// Проверка ТЗ режиссёра: пример, ошибки валидатора и сборка промтов.
import fs from 'node:fs';
import path from 'node:path';
import { buildBriefPrompt, BRIEF_MAX_CHARS, BRIEF_SECTIONS, extractBrief, validateBrief } from '../engine/ai-brief.ts';
import { buildProjectPrompt, CATALOG_MAX_LINES, PROJECT_PROMPT_MAX_BYTES, type CatalogEntry } from '../engine/ai-project.ts';
import { styleBlock } from '../engine/styles.ts';

const errors: string[] = [];
const expect = (condition: boolean, message: string) => { if (!condition) errors.push(message); };

const catalogDir = path.resolve('catalog');
const index = JSON.parse(fs.readFileSync(path.join(catalogDir, 'index.json'), 'utf8')) as Array<CatalogEntry & { file: string }>;
const catalogIndex: CatalogEntry[] = index.map((entry) => {
  const model = JSON.parse(fs.readFileSync(path.join(catalogDir, entry.file), 'utf8')) as { bounds?: number[] };
  return { ...entry, bounds: model.bounds };
});

const example = fs.readFileSync(path.resolve('docs/examples/brief-example.md'), 'utf8');
const exampleCheck = validateBrief(example, { scenes: 3 });
expect(exampleCheck.ok, `пример ТЗ не прошёл: ${exampleCheck.errors.map((e) => e.message).join('; ')}`);
expect(exampleCheck.warnings.length === 0, `пример ТЗ дал предупреждения: ${exampleCheck.warnings.map((e) => e.message).join('; ')}`);

const noBlock = example.replace(/^```markdown\s*\r?\n/, '').replace(/\r?\n```\s*$/, '');
const noBlockCheck = validateBrief(noBlock, { scenes: 3 });
expect(noBlockCheck.ok, `ТЗ без блока кода не прошло: ${noBlockCheck.errors.map((e) => e.message).join('; ')}`);
expect(extractBrief(noBlock).startsWith('# ТЗ режиссёра'), 'extractBrief без блока кода должен вернуть текст целиком');

const truncated = example.replace(/```\s*$/, '').trimEnd();
expect(!validateBrief(truncated, { scenes: 3 }).ok, 'обрезанное ТЗ (без закрывающего ```) должно давать ошибку');
expect(!validateBrief('', { scenes: 3 }).ok, 'пустое ТЗ должно давать ошибку');
expect(!validateBrief(example.replace('## 5. Шоты', '## 5. Другое'), { scenes: 3 }).ok, 'ТЗ без раздела 5 должно давать ошибку');
expect(!validateBrief(`${example}\n\`\`\`json\n{}\n\`\`\``, { scenes: 3 }).ok, 'ТЗ с блоком ```json должно давать ошибку');

const briefPrompt = buildBriefPrompt({ idea: 'Что если бы киты летали над городом', scenes: 3, sceneSeconds: 8, catalogIndex, styleId: 'warm-dusk' });
for (const section of BRIEF_SECTIONS) expect(briefPrompt.includes(`## ${section}`), `в промте ТЗ нет раздела «${section}»`);
expect(briefPrompt.includes('### Шот 1'), 'в промте ТЗ нет образца заголовка шота');
expect(briefPrompt.includes('- whale |'), 'в промте ТЗ нет блока каталога');
expect(briefPrompt.includes(styleBlock('warm-dusk')), 'в промте ТЗ нет блока выбранного стиля');

const plainBriefPrompt = buildBriefPrompt({ idea: 'Что если бы киты летали над городом', scenes: 3, catalogIndex });
expect(!plainBriefPrompt.includes('## Стиль ролика'), 'без styleId блок стиля не должен появляться');

const basePrompt = buildProjectPrompt({ idea: 'Что если бы киты летали над городом', scenes: 3, catalogIndex });
expect(!basePrompt.includes('ТЗ режиссёра'), 'без brief в промте проекта не должно быть ТЗ');
expect(!basePrompt.includes('## Стиль ролика'), 'без styleId в промте проекта не должно быть блока стиля');

const briefText = extractBrief(example);
const projectPrompt = buildProjectPrompt({ idea: 'Что если бы киты летали над городом', scenes: 3, catalogIndex, brief: briefText, styleId: 'warm-dusk' });
expect(projectPrompt.includes('## ТЗ режиссёра (следуй ему)'), 'с brief в промте проекта нет раздела ТЗ');
expect(projectPrompt.includes('## Стиль ролика'), 'со styleId в промте проекта нет блока стиля');
expect(projectPrompt.includes('style.preset = "warm-dusk"'), 'в промте проекта нет требования style.preset');

// Синтетический каталог на 200 моделей: размер промта не зависит от реальной папки catalog/.
const bigCatalog: CatalogEntry[] = Array.from({ length: 200 }, (_, i) => ({
  id: `model-${i + 1}`,
  name: i === 0 ? 'Кит тестовый' : i === 1 ? 'Городской фонарь' : `Модель ${i + 1}`,
  tags: i === 0 ? ['кит', 'тест'] : i === 1 ? ['фонарь', 'город'] : ['общее', `tag-${i + 1}`],
  view: 'side',
  realSize: { heightM: 1 + (i % 40) / 10 },
  bounds: [-50, -50, 100, 100],
}));
const bigBlock = buildBriefPrompt({ idea: 'Что если бы киты летали над городом', scenes: 3, catalogIndex: bigCatalog });
const bigLines = bigBlock.split('## Каталог моделей')[1]?.split('Для моделей из каталога')[0]?.split('\n').filter((line) => line.startsWith('- ')) ?? [];
expect(bigLines.length <= CATALOG_MAX_LINES, `в промте ${bigLines.length} строк каталога, лимит ${CATALOG_MAX_LINES}`);
expect(bigLines.some((line) => line.startsWith('- model-1 |')), 'модель, совпавшая с идеей, не попала в каталог');
expect(bigLines.some((line) => line.startsWith('- model-2 |')), 'модель, совпавшая с идеей по тегу/названию, не попала в каталог');

const maxBrief = (example + '\n' + 'Палитра и действие описаны словами. '.repeat(300)).slice(0, BRIEF_MAX_CHARS);
const largest = buildProjectPrompt({ idea: 'Что если бы киты летали над городом и над ним пролетает огромный кит', scenes: 3, catalogIndex: bigCatalog, brief: maxBrief, styleId: 'ink-paper' });
for (const [label, prompt] of [['промт ТЗ', briefPrompt], ['промт проекта без ТЗ', basePrompt], ['промт проекта с ТЗ 6000 и каталогом 200', largest]] as const) {
  const bytes = Buffer.byteLength(prompt, 'utf8');
  expect(bytes <= PROJECT_PROMPT_MAX_BYTES, `${label}: ${bytes} байт, лимит ${PROJECT_PROMPT_MAX_BYTES}`);
}

if (errors.length) {
  console.error('check:brief FAIL');
  for (const message of errors) console.error(`- ${message}`);
  process.exit(1);
}
console.log('check:brief OK');
