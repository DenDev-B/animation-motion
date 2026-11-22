// Озвучка сцен по тексту: синтез в audio/tts/<хэш>.wav, оценка таймингов слов и правка voice в проекте.
// Проект без voice.text не трогается; существующие поля и порядок ключей сохраняются — меняется только запись voice.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProject, type ProjectV1 } from '../engine/index.ts';
import { applyVoiceResult, type VoiceResult } from '../engine/voice-batch.ts';
import { diagnoseAdapters, TTS_ADAPTERS } from './tts/index.ts';
import { synthesizeVoice } from './tts/synthesize.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = [
  'использование: node tools/tts-run.ts --project <file.project.json> [--scene N | --all] [--adapter piper|sapi] [--force] [--lang ru]',
  '               node tools/tts-run.ts --doctor',
  'Имена адаптеров: ' + TTS_ADAPTERS.map((adapter) => `${adapter.id}${adapter.hidden ? ' (служебный)' : ''}`).join(', ') + '.',
  'Без --scene и --all обрабатываются все сцены с voice.text. --force перезаписывает уже готовые wav.',
  'Файлы кладутся в audio/tts/ (папку задают --audio-dir); режим «свой файл» — это когда voice.file указан вручную, адаптер не нужен.',
].join('\n');

function log(m: string) { process.stdout.write(m + '\n'); }
function fail(m: string): never { log(`ОШИБКА: ${m}`); process.exit(1); }

interface Args {
  project: string;
  scene?: number;
  adapterId?: string;
  force: boolean;
  lang: string;
  audioDir: string;
  doctor: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { project: '', force: false, lang: 'ru', audioDir: path.join(root, 'audio'), doctor: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${a}: нужно значение\n${USAGE}`);
      return value;
    };
    if (a === '--project') args.project = next();
    else if (a === '--scene') args.scene = Number(next());
    else if (a === '--all') continue;
    else if (a === '--adapter') args.adapterId = next();
    else if (a === '--force') args.force = true;
    else if (a === '--lang') args.lang = next().trim() || 'ru';
    else if (a === '--audio-dir') args.audioDir = path.resolve(next());
    else if (a === '--doctor') args.doctor = true;
    else fail(`неизвестный аргумент ${a}\n${USAGE}`);
  }
  if (args.scene !== undefined && (!Number.isInteger(args.scene) || args.scene < 1)) fail('--scene — целое число не меньше 1 (нумерация сцены с 1)');
  if (args.doctor) return args;
  if (!args.project) fail(`нужен --project\n${USAGE}`);
  return args;
}

// Идентификаторы каталога: без них validateProject сочтёт самодельные модели недостающими (тот же приём, что в export.ts).
function catalogIds(): string[] {
  const dir = path.join(root, 'catalog');
  const ids: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { id?: unknown };
      if (typeof entry.id === 'string') ids.push(entry.id);
    } catch {
      // битую модель каталога ловит export.ts — здесь нужны только идентификаторы
    }
  }
  return ids;
}

function writeErrors(errors: Array<{ path?: string; message: string }>, title: string) {
  log(title);
  for (const error of errors) log(` - ${error.path ?? ''}: ${error.message}`);
}

async function runDoctor(): Promise<void> {
  for (const entry of await diagnoseAdapters()) {
    log(`${entry.adapter.label}: ${entry.result.ok ? 'OK' : `недоступен — ${entry.result.reason ?? 'причина не указана'}`}`);
  }
  log('режим «свой файл»: wav в audio/ и voice.file в проекте — адаптер не нужен');
}

async function main() {
  const args = parseArgs();
  if (args.doctor) {
    await runDoctor();
    return;
  }
  const projectPath = path.resolve(args.project);
  if (!fs.existsSync(projectPath)) fail(`нет файла проекта ${projectPath}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  } catch (e) {
    fail(`${projectPath} не читается как JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const opts = { catalogIds: catalogIds() };
  const before = validateProject(raw, opts);
  if (!before.ok) {
    writeErrors(before.errors, 'проект невалиден до озвучки — файл не изменён');
    process.exit(1);
  }
  const project = raw as ProjectV1;
  const wanted = args.scene ? [args.scene - 1] : project.scenes.map((_entry, index) => index);
  log(`язык: ${args.lang} · папка звука: ${args.audioDir}`);

  let changed = 0;
  let skipped = 0;
  let updated = 0;
  for (const index of wanted) {
    const entry = project.scenes[index];
    const label = `сцена ${index + 1} («${entry.name}»)`;
    if (!entry.voice) {
      log(`${label}: озвучки нет — пропуск`);
      skipped++;
      continue;
    }
    const text = (entry.voice.text ?? '').trim();
    if (!text) {
      log(`${label}: voice.text пуст — пропуск (файл озвучки можно положить руками и указать voice.file)`);
      skipped++;
      continue;
    }
    const file = entry.voice.file;
    const spokenText = entry.voice.spokenText;
    // голос уже готов и актуален: spokenText совпадает с текстом
    if (file && spokenText === undefined) {
      log(`${label}: ${file} уже есть — без синтеза (старый проект без spokenText)`);
      skipped++;
      continue;
    }
    if (file && spokenText !== undefined && spokenText.trim() === text && !args.force) {
      log(`${label}: ${file} уже есть (уже актуален) — без синтеза`);
      skipped++;
      continue;
    }
    const result = await synthesizeVoice({ text, adapterId: args.adapterId, lang: args.lang, audioDir: args.audioDir, force: args.force, allowFake: true });
    if (result.cached) log(`${label}: ${result.file} уже есть — без синтеза`);
    else log(`${label}: синтез → ${result.file}`);
    applyVoiceResult(entry, text, result);
    changed++;
    if (file && args.force) updated++;
    const sceneDuration = entry.scene.duration;
    const endSec = (entry.voice.offset ?? 0) + result.durationSec;
    if (endSec > sceneDuration + 1e-6) {
      log(`ПРЕДУПРЕЖДЕНИЕ: ${label}: голос длиннее сцены на ${(endSec - sceneDuration).toFixed(2)} с (звук ${result.durationSec.toFixed(2)} с + offset ${(entry.voice.offset ?? 0).toFixed(2)} с против сцены ${sceneDuration} с): увеличьте длительность сцены — tts её не меняет`);
    }
    log(`${label}: ${result.durationSec.toFixed(2)} с, слов ${result.words.length}${result.cached ? ', wav из кэша' : ''}`);
  }

  const voiced = changed;
  log(`итог: озвучено ${voiced}, пропущено ${skipped}, обновлено ${updated}`);
  if (changed === 0) {
    log('нет сцен с voice.text — проект не изменён');
    return;
  }
  const after = validateProject(project, opts);
  if (!after.ok) {
    writeErrors(after.errors, 'проект невалиден после правки — файл не изменён');
    process.exit(1);
  }
  // атомарная запись: временный файл в той же папке, потом rename
  const tmpFile = `${projectPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpFile, projectPath);
  log(`записано ${projectPath}: сцен с озвучкой ${changed}`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
