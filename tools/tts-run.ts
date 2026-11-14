// Озвучка сцен по тексту: синтез в audio/tts/<хэш>.wav, оценка таймингов слов и правка voice в проекте.
// Проект без voice.text не трогается; существующие поля и порядок ключей сохраняются — меняется только запись voice.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateWordTimings, validateProject, type ProjectV1 } from '../engine/index.ts';
import { diagnoseAdapters, firstAvailableAdapter, getTtsAdapter, TTS_ADAPTERS } from './tts/index.ts';
import type { TtsAdapter } from './tts/types.ts';

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

// Длительность wav: у части контейнеров stream=duration пустой, тогда берём format=duration (тот же приём, что в export.ts).
function audioDurationSec(file: string): number {
  let out: string;
  try {
    out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  } catch (e) {
    fail(`ffprobe не прочитал ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const json = JSON.parse(out) as { streams?: Array<{ duration?: string }>; format?: { duration?: string } };
  const duration = Number(json.streams?.[0]?.duration ?? json.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) fail(`ffprobe не дал длительность файла ${file}`);
  return duration;
}

/** Имя wav: один и тот же текст тем же голосом даёт тот же файл, смена голоса или текста — новый. */
function voiceFileName(adapter: TtsAdapter, voice: string, lang: string, text: string): string {
  const key = [adapter.id, voice, lang, text].join('\n');
  return `${crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 12)}.wav`;
}

function writeErrors(errors: Array<{ path?: string; message: string }>, title: string) {
  log(title);
  for (const error of errors) log(` - ${error.path ?? ''}: ${error.message}`);
}

async function resolveAdapter(args: Args): Promise<TtsAdapter> {
  if (args.adapterId) {
    const adapter = getTtsAdapter(args.adapterId);
    if (!adapter) fail(`неизвестный адаптер «${args.adapterId}». Доступны: ${TTS_ADAPTERS.map((a) => a.id).join(', ')}`);
    const result = await adapter.detect();
    if (!result.ok) fail(`адаптер «${adapter.label}» недоступен: ${result.reason ?? 'причина не указана'}\nПодробности — docs/TTS.md`);
    return adapter;
  }
  const found = await firstAvailableAdapter();
  if (!found.adapter) {
    fail(`ни один адаптер озвучки недоступен:\n${found.reasons.map((reason) => ` - ${reason}`).join('\n')}\nУкажите --adapter явно или настройте один из них; подробности — docs/TTS.md`);
  }
  log(`адаптер выбран автоматически: ${found.adapter.label}`);
  return found.adapter;
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
  const adapter = await resolveAdapter(args);
  const voice = await adapter.voiceId({ lang: args.lang });
  log(`голос: ${voice || 'не определён'} · язык: ${args.lang} · папка звука: ${args.audioDir}`);

  let changed = 0;
  for (const index of wanted) {
    const entry = project.scenes[index];
    const label = `сцена ${index + 1} («${entry.name}»)`;
    if (!entry.voice) {
      log(`${label}: озвучки нет — пропуск`);
      continue;
    }
    const text = (entry.voice.text ?? '').trim();
    if (!text) {
      log(`${label}: voice.text пуст — пропуск (файл озвучки можно положить руками и указать voice.file)`);
      continue;
    }
    const relFile = `tts/${voiceFileName(adapter, voice, args.lang, text)}`;
    const outWav = path.join(args.audioDir, relFile);
    const cached = fs.existsSync(outWav);
    if (cached && !args.force) log(`${label}: ${relFile} уже есть — без синтеза`);
    else {
      await adapter.synthesize(text, outWav, { lang: args.lang });
      log(`${label}: синтез → ${relFile}`);
    }
    const durationSec = audioDurationSec(outWav);
    entry.voice.file = relFile;
    entry.voice.words = estimateWordTimings(text, durationSec);
    changed++;
    const sceneDuration = entry.scene.duration;
    const endSec = (entry.voice.offset ?? 0) + durationSec;
    if (endSec > sceneDuration + 1e-6) {
      log(`ПРЕДУПРЕЖДЕНИЕ: ${label}: голос длиннее сцены на ${(endSec - sceneDuration).toFixed(2)} с (звук ${durationSec.toFixed(2)} с + offset ${(entry.voice.offset ?? 0).toFixed(2)} с против сцены ${sceneDuration} с): увеличьте длительность сцены — tts её не меняет`);
    }
    log(`${label}: ${durationSec.toFixed(2)} с, слов ${entry.voice.words.length}${cached && !args.force ? ', wav из кэша' : ''}`);
  }

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
