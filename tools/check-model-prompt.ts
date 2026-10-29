// Проверка промта «описание → модель»: размер, образец проходит валидатор, ответ в ```json принимается каталогом (dry).
import { buildModelPrompt, MODEL_PROMPT_MAX_BYTES, MODEL_SAMPLE } from '../engine/ai-model.ts';
import { extractJson } from '../engine/ai-io.ts';
import { validateAsset } from '../engine/validate.ts';
import { addToCatalog } from '../engine/catalog-add.ts';

let errors = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); errors++; };

const prompt = buildModelPrompt({ description: 'собака сбоку, смотрит вправо', view: 'side', facing: 'right', sizeM: 0.6 });
const bytes = Buffer.byteLength(prompt, 'utf8');
if (bytes > MODEL_PROMPT_MAX_BYTES) fail(`промт ${bytes} байт > ${MODEL_PROMPT_MAX_BYTES}`);
for (const must of ['```json', 'bounds', 'realSize', 'license', 'собака сбоку', '0.6 м', 'M L C Q Z']) if (!prompt.includes(must)) fail(`в промте нет «${must}»`);
let emptyFailed = false;
try { buildModelPrompt({ description: '  ' }); } catch { emptyFailed = true; }
if (!emptyFailed) fail('пустое описание должно давать ошибку');

const sample = validateAsset(JSON.parse(JSON.stringify(MODEL_SAMPLE)));
if (!sample.ok) fail(`образец не проходит validateAsset: ${JSON.stringify(sample.errors)}`);

const reply = 'Вот модель:\n```json\n' + JSON.stringify({ ...MODEL_SAMPLE, id: 'zz-check-model' }, null, 2) + '\n```\nГотово.';
const model = extractJson(reply);
const dry = addToCatalog(model, { id: 'zz-check-model', dry: true });
if (!dry.ok) fail('ответ в блоке json-кода не прошёл catalog:add --dry: ' + JSON.stringify(dry.errors));

const bad = { ...MODEL_SAMPLE, bounds: [0, 0, -5, 0] } as unknown;
if (validateAsset(JSON.parse(JSON.stringify(bad))).ok) fail('модель с неверными bounds не должна проходить валидатор');

console.log(errors === 0 ? 'check:model-prompt OK' : `check:model-prompt FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
