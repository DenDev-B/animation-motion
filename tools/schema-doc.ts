import { ANIM_SPEC, KIND_SPEC, PALETTE_SLOTS, SCENE_SPEC } from '../engine/spec.ts';

function table(fields: readonly { name: string; type: string; min?: number; exclusiveMin?: boolean; max?: number; default?: unknown; values?: readonly string[]; description: string }[]): string {
  return ['| Поле | Тип / диапазон | По умолчанию | Описание |', '|---|---|---|---|', ...fields.map((field) => {
    const minimum = field.min === undefined ? '−∞' : `${field.exclusiveMin ? '>' : '≥'}${field.min}`;
    const range = field.values ? field.values.join(' · ') : field.min !== undefined || field.max !== undefined ? `${minimum}${field.max === undefined ? '…∞' : `…≤${field.max}`}` : '—';
    return `| \`${field.name}\` | ${field.type}; ${range} | ${field.default === undefined ? '—' : `\`${JSON.stringify(field.default)}\``} | ${field.description} |`;
  })].join('\n');
}

export function renderSchemaMarkdown(): string {
  const kinds = Object.entries(KIND_SPEC).map(([name, spec]) => `### \`${name}\`\n\n${spec.description}\n\n${table(spec.params)}`).join('\n\n');
  const animations = Object.entries(ANIM_SPEC).map(([name, fields]) => `### \`${name}\`\n\n${table(fields)}`).join('\n\n');
  return `# Схема сцены v1\n\nСцена — JSON с \`version: 1\`. Размеры задаются в условных единицах: высота кадра 1000, центр координат — середина, ось Y направлена вниз. Неизвестные поля сохраняются и выдаются как предупреждения.\n\n## Поля сцены\n\n${table(SCENE_SPEC.fields)}\n\n## Палитра\n\nСлоты: ${PALETTE_SLOTS.map((slot) => `\`${slot}\``).join(', ')}. \`sky\` — массив минимум из двух цветов; остальные слоты — отдельные цвета. Цвета: \`#rgb\`, \`#rrggbb\` или \`#rrggbbaa\`.\n\n## Стиль\n\n${table(SCENE_SPEC.style)}\n\n## Камера\n\n${table(SCENE_SPEC.camera)}\n\nКлюч камеры имеет поля \`t\`, \`x\`, \`y\`, \`zoom\`; время ключей должно возрастать, \`zoom > 0\`.\n\n## Слой\n\n${table(SCENE_SPEC.layer)}\n\n## Объект\n\n${table(SCENE_SPEC.object)}\n\n## Типы объектов и params\n\n${kinds}\n\n## Анимации\n\nПериодические анимации требуют \`period > 0\`; \`ease\` у move — один из sine, inOut, out, lin. Все кадры являются функцией времени и seed.\n\n${animations}\n\n## Модель каталога\n\nМодель содержит \`version\`, \`id\`, \`name\`, \`bounds: [x, y, width, height]\` и непустой \`parts\`. У каждой части уникальный \`id\`; тип — path (по умолчанию), line или circle.\n\n## Примеры\n\nМинимальная сцена:\n\n\`\`\`json\n{"version":1,"title":"Небо","duration":3,"palette":{"sky":["#123","#456"]},"camera":{"keys":[]},"assets":{},"layers":[]}\n\`\`\`\n\nОблако:\n\n\`\`\`json\n{"id":"cloud-1","name":"Облако","kind":"cloud","params":{"w":400,"h":140,"seed":1}}\n\`\`\`\n`;
}
