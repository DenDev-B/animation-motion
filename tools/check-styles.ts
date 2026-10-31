// Проверка пресетов стиля: данные, диапазоны и текстовый блок для промта.
import { PALETTE_SLOTS } from '../engine/spec.ts';
import { getStyle, STYLE_MOODS, STYLE_PRESETS, styleBlock } from '../engine/styles.ts';

const HEX_RE = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

const errors: string[] = [];
const fail = (message: string) => errors.push(message);

if (STYLE_PRESETS.length !== 6) fail(`пресетов ${STYLE_PRESETS.length}, а нужно ровно 6`);

const ids = new Set<string>();
for (const preset of STYLE_PRESETS) {
  const at = `стиль "${preset.id}"`;
  if (!ID_RE.test(preset.id)) fail(`${at}: id должен быть латиницей в нижнем регистре через дефис`);
  if (ids.has(preset.id)) fail(`${at}: повтор id`);
  ids.add(preset.id);
  if (!preset.name.trim()) fail(`${at}: пустое name`);
  if (!preset.description.trim()) fail(`${at}: пустое description`);
  if (!(preset.grain >= 0.03 && preset.grain <= 0.1)) fail(`${at}: grain ${preset.grain} вне 0.03..0.10`);
  if (!(preset.vignette >= 0.1 && preset.vignette <= 0.4)) fail(`${at}: vignette ${preset.vignette} вне 0.1..0.4`);
  if (!preset.atmosphere.trim()) fail(`${at}: пустая atmosphere`);
  for (const mood of STYLE_MOODS) {
    const palette = preset.palettes[mood];
    if (!palette) { fail(`${at}: нет палитры "${mood}"`); continue; }
    if (!Array.isArray(palette.sky) || palette.sky.length < 2) fail(`${at}/${mood}: sky короче 2 цветов`);
    for (const [slot, value] of Object.entries(palette)) {
      if (!PALETTE_SLOTS.includes(slot as typeof PALETTE_SLOTS[number])) fail(`${at}/${mood}: недопустимый слот "${slot}"`);
      if (slot === 'sky') {
        for (const color of palette.sky) if (!HEX_RE.test(color)) fail(`${at}/${mood}: sky "${color}" не hex`);
        continue;
      }
      if (typeof value !== 'string' || !HEX_RE.test(value)) fail(`${at}/${mood}/${slot}: "${String(value)}" не hex`);
    }
  }
  if (!getStyle(preset.id)) fail(`${at}: getStyle не находит пресет`);
  let block = '';
  try { block = styleBlock(preset.id); } catch (error) { fail(`${at}: styleBlock упал: ${error instanceof Error ? error.message : String(error)}`); }
  if (!block.trim()) fail(`${at}: пустой styleBlock`);
  if (/undefined/i.test(block)) fail(`${at}: styleBlock содержит "undefined"`);
}

if (errors.length) {
  console.error('check:styles FAIL');
  for (const message of errors) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`check:styles OK (${STYLE_PRESETS.length} пресетов)`);
