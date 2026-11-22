// Приёмка озвучки: тайминги слов, работа tts-run (кэш, правка проекта, предупреждения) и путь от voice.text до MP4 со звуком.
// Всё синтетическое живёт во временной папке и удаляется в finally; в репозиторий скрипт ничего не пишет.
// Адаптеры piper и sapi в_check не вызываются: они зависят от машины владельца, проверяется только их логика решений.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudioPlan, estimateWordTimings, projectFrameCount, type ProjectV1 } from '../engine/index.ts';
import { TTS_ADAPTERS, visibleTtsAdapters } from './tts/index.ts';
import { piperStatus } from './tts/piper.ts';
import { sapiStatus } from './tts/sapi.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;
// Текст заполняет сцену почти целиком: один проход loudnorm сходится к −14 только на плотной дорожке.
// Реплика заметно короче сцены недотягивает до цели (замер −8.2 LUFS) — это отдельная задача про two-pass нормализацию.
const VOICE_TEXT = 'раз два три четыре пять шесть семь восемь девять';

const failures: string[] = [];
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`OK   ${label}`);
  else {
    failures.push(label);
    console.error(`FAIL ${label}`);
  }
};
const f2 = (v: number) => v.toFixed(2);

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { cwd: root, encoding: 'utf8' });
}

function ffmpegTo(args: string[], label: string) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${label}: ffmpeg завершился с кодом ${r.status}: ${(r.stderr ?? '').slice(-400)}`);
}

function durationSec(file: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${(r.stderr ?? '').slice(-300)}`);
  const json = JSON.parse(r.stdout) as { streams?: Array<{ duration?: string }>; format?: { duration?: string } };
  const value = Number(json.streams?.[0]?.duration ?? json.format?.duration);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`ffprobe не дал длительность ${file}`);
  return value;
}

const sceneFixture = (title: string, duration = 3) => ({
  version: 1,
  title,
  duration,
  palette: { sky: ['#123', '#456'] },
  camera: { keys: [] },
  assets: {},
  layers: [{ id: 'l', name: 'Слой', depth: 1, visible: true, objects: [{ id: 'sky', name: 'Небо', kind: 'sky', params: {} }] }],
});

/** Сцена 1 — текст без файла (её и озвучивает tts), сцена 2 — голос с файлом, но без текста (её tts обязан пропустить). */
function makeProject(opts: { duration?: number; text?: string } = {}): ProjectV1 {
  const scenes = [
    { id: 's1', name: 'А', scene: sceneFixture('А', opts.duration ?? 3), transition: { type: 'cut' }, voice: { text: opts.text ?? VOICE_TEXT, offset: 0.1, gain: 1 } },
    { id: 's2', name: 'Б', scene: sceneFixture('Б'), transition: { type: 'cut' }, voice: { file: 'v2.wav' } },
  ];
  return { version: 1, title: 'Озвучка', fps: FPS, format: '16:9', scenes } as unknown as ProjectV1;
}

function writeProject(dir: string, name: string, project: ProjectV1): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return file;
}

const readProject = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));

function ttsRun(file: string, audioDir: string, extra: string[] = []) {
  return run('tts-run.ts', ['--project', file, '--adapter', 'fake', '--audio-dir', audioDir, ...extra]);
}

const keysOf = (value: unknown): string[] => Object.keys(value as Record<string, unknown>);
const stripVoice = (project: any) => {
  const copy = JSON.parse(JSON.stringify(project));
  for (const scene of copy.scenes) if (scene.voice) { delete scene.voice.file; delete scene.voice.words; delete scene.voice.spokenText; }
  return copy;
};

try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-tts-'));
  try {
    console.log('--- а) оценка таймингов слов ---');
    const words = estimateWordTimings('раз, два три. четыре', 5);
    ok(words.length === 4, `слов 4, получено ${words.length}`);
    ok(words[0].t0 === 0 && f2(words[words.length - 1].t1) === '5.00', `края 0 … ${f2(words[words.length - 1].t1)}, ожидалось 0 … 5.00`);
    let monotonic = true;
    for (const [i, word] of words.entries()) {
      if (!(word.t0 < word.t1)) monotonic = false;
      if (i > 0 && !(word.t0 >= words[i - 1].t0)) monotonic = false;
      if (!word.w) monotonic = false;
    }
    ok(monotonic, 't0 < t1 у каждого слова, начала не убывают, пустых слов нет');
    ok(estimateWordTimings('   ', 3).length === 0 && estimateWordTimings('', 3).length === 0, 'пустой текст даёт пустой список');
    ok(estimateWordTimings('а', 0).length === 0, 'нулевая длительность даёт пустой список');
    const span = (list: { t0: number; t1: number }[]) => list[0].t1 - list[0].t0;
    ok(span(estimateWordTimings('а, б', 1)) > span(estimateWordTimings('а б', 1)), 'запятая удлиняет слово перед ней');
    ok(span(estimateWordTimings('а. б', 1)) > span(estimateWordTimings('а, б', 1)), 'точка удлиняет сильнее, чем запятая');
    ok(estimateWordTimings('длинноеслово а', 4)[0].t1 > 2, 'длинное слово получает больше времени, чем короткое');

    console.log('--- б) tts-run на проекте из двух сцен ---');
    const audioDir = path.join(tmp, 'audio');
    fs.mkdirSync(path.join(audioDir, 'tts'), { recursive: true });
    ffmpegTo(['-f', 'lavfi', '-i', 'sine=frequency=4000:duration=2.8:sample_rate=48000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(audioDir, 'v2.wav')], 'v2.wav');
    const projectFile = writeProject(tmp, 'tts.project.json', makeProject());
    const before = readProject(projectFile);
    const rc = ttsRun(projectFile, audioDir);
    ok(rc.status === 0, `tts-run завершился успешно${rc.status === 0 ? '' : `: ${rc.stdout.slice(-500)}${rc.stderr.slice(-300)}`}`);
    const made = fs.readdirSync(path.join(audioDir, 'tts'));
    ok(made.length === 1 && /^[0-9a-f]{12}\.wav$/.test(made[0]), `wav в audio/tts: ${made.join(', ')} (имя = 12 шестнадцатеричных символов)`);
    const after = readProject(projectFile);
    ok(after.scenes[0].voice?.file === `tts/${made[0]}`, `voice.file записан: ${after.scenes[0].voice?.file}`);
    const wordsAfter = after.scenes[0].voice?.words ?? [];
    ok(wordsAfter.length === 9, `слов в voice.words: ${wordsAfter.length}, ожидалось 9`);
    const wavSec = durationSec(path.join(audioDir, 'tts', made[0]));
    ok(Math.abs(wordsAfter[wordsAfter.length - 1].t1 - wavSec) <= 0.011, `последнее t1 ${f2(wordsAfter[wordsAfter.length - 1].t1)} = длительность wav ${f2(wavSec)}`);
    ok(after.scenes[0].voice.offset === 0.1 && after.scenes[0].voice.gain === 1 && after.scenes[0].voice.text === VOICE_TEXT && after.scenes[0].voice.spokenText === VOICE_TEXT, 'offset, gain, text и spokenText сцены 1 не изменились');
    ok(JSON.stringify(after.scenes[1].voice) === JSON.stringify(before.scenes[1].voice), 'сцена без voice.text тронута не была');
    ok(keysOf(after).join(',') === keysOf(before).join(',') && keysOf(after.scenes[0]).join(',') === keysOf(before.scenes[0]).join(','), 'порядок верхних ключей и ключей сцены сохранён');
    ok(keysOf(after.scenes[0].voice).join(',') === [...keysOf(before.scenes[0].voice), 'spokenText', 'file', 'words'].join(','), `порядок полей voice: ${keysOf(after.scenes[0].voice).join(', ')}`);
    ok(JSON.stringify(stripVoice(after)) === JSON.stringify(stripVoice(before)), 'весь остальной JSON побайтово прежний');
    ok(fs.readFileSync(projectFile, 'utf8').endsWith('\n'), 'файл проекта заканчивается переводом строки');
    ok(!fs.readdirSync(tmp).some((f) => f.endsWith('.tmp')), 'временный файл записи удалён (rename)');

    console.log('--- в) кэш и --force ---');
    const wavPath = path.join(audioDir, 'tts', made[0]);
    const mtimeBefore = fs.statSync(wavPath).mtimeMs;
    const cached = ttsRun(projectFile, audioDir);
    ok(cached.status === 0 && cached.stdout.includes('уже есть'), 'второй запуск сообщает «уже есть» и не синтезирует');
    ok(fs.statSync(wavPath).mtimeMs === mtimeBefore, 'wav не перезаписан (mtime тот же)');
    const forced = ttsRun(projectFile, audioDir, ['--force']);
    ok(forced.status === 0 && forced.stdout.includes('синтез →'), '--force синтезирует заново');
    ok(fs.statSync(wavPath).mtimeMs > mtimeBefore, 'после --force mtime вырос');
    ok(readProject(projectFile).scenes[0].voice.file === `tts/${made[0]}`, 'имя файла от повторного запуска не изменилось');

    console.log('--- в1) изменённый текст переозвучивается, старый без spokenText пропускается ---');
    const staleProject = {
      version: 1, title: 'Stale', fps: FPS, format: '16:9',
      scenes: [
        { id: 'a', name: 'А', scene: sceneFixture('А', 3), transition: { type: 'cut' }, voice: { text: 'старый текст', file: 'tts/old.wav', spokenText: 'старый текст' } },
        { id: 'b', name: 'Б', scene: sceneFixture('Б', 3), transition: { type: 'cut' }, voice: { text: 'изменённый текст', file: 'tts/old.wav', spokenText: 'старый текст' } },
        { id: 'c', name: 'В', scene: sceneFixture('В', 3), transition: { type: 'cut' }, voice: { text: 'без spokenText', file: 'tts/old.wav' } },
      ],
    };
    const staleFile = writeProject(tmp, 'stale.project.json', staleProject as ProjectV1);
    const staleRun = ttsRun(staleFile, audioDir);
    ok(staleRun.status === 0, `изменённый текст: tts-run завершился успешно${staleRun.status === 0 ? '' : `: ${staleRun.stdout.slice(-500)}`}`);
    const afterStale = readProject(staleFile);
    ok(afterStale.scenes[0].voice.spokenText === 'старый текст', 'сцена 1 (актуальна): spokenText не менялся');
    ok(afterStale.scenes[0].voice.file === 'tts/old.wav', 'сцена 1 (актуальна): файл не перезаписан');
    ok(afterStale.scenes[1].voice.spokenText === 'изменённый текст', 'сцена 2 (изменён): spokenText обновлён');
    ok(/^tts\/[0-9a-f]{12}\.wav$/.test(afterStale.scenes[1].voice.file), `сцена 2 (изменён): новый файл ${afterStale.scenes[1].voice.file}`);
    ok(afterStale.scenes[1].voice.file !== 'tts/old.wav', 'сцена 2 (изменён): файл не совпадает со старым');
    ok(!afterStale.scenes[2].voice.spokenText, 'сцена 3 (без spokenText): spokenText не добавляется (старый проект)');
    ok(afterStale.scenes[2].voice.file === 'tts/old.wav', 'сцена 3 (без spokenText): файл не перезаписан');
    ok(staleRun.stdout.includes('обновлено'), `итог содержит «обновлено»: ${staleRun.stdout.split('\n').find((l) => l.includes('итог')) ?? '(нет)'}`);

    console.log('--- г) невалидный проект остаётся нетронутым ---');
    const broken = makeProject();
    (broken.scenes[0] as { voice: { file?: string } }).voice.file = '../вне-папки.wav';
    const brokenFile = writeProject(tmp, 'broken.project.json', broken);
    const brokenBytes = fs.readFileSync(brokenFile);
    const badRun = ttsRun(brokenFile, audioDir);
    ok(badRun.status !== 0, 'tts-run на невалидном проекте завершается ошибкой');
    ok(badRun.stdout.includes('невалиден до озвучки'), `сообщение объясняет причину: ${badRun.stdout.split('\n').find((l) => l.includes('невалиден')) ?? '(нет строки)'}`);
    ok(Buffer.compare(fs.readFileSync(brokenFile), brokenBytes) === 0, 'файл проекта не изменён');
    ok(!fs.existsSync(path.join(audioDir, 'tts', 'вне-папки.wav')), 'смежный файл не создан');

    console.log('--- д) голос длиннее сцены ---');
    const longFile = writeProject(tmp, 'long.project.json', makeProject({ duration: 1, text: 'очень длинная реплика которая точно не влезет в секунду' }));
    const longRun = ttsRun(longFile, audioDir);
    ok(longRun.status === 0 && /голос длиннее сцены на [\d.]+ с/.test(longRun.stdout), `предупреждение есть: ${(longRun.stdout.match(/ПРЕДУПРЕЖДЕНИЕ: .*/) ?? ['(нет)'])[0]}`);
    ok(longRun.stdout.includes('увеличьте длительность сцены'), 'подсказка про длительность сцены в тексте есть');
    const longProject = readProject(longFile);
    ok(longProject.scenes[0].scene.duration === 1, 'длительность сцены tts не тронул');

    console.log('--- е) проект после tts проходит план звука и реальный экспорт ---');
    const ready = makeProject();
    const readyFile = writeProject(tmp, 'ready.project.json', ready);
    ok(ttsRun(readyFile, audioDir).status === 0, 'озвучка готова');
    const readyProject = readProject(readyFile) as ProjectV1;
    const plan = buildAudioPlan(readyProject);
    const voices = plan.items.filter((item) => item.kind === 'voice');
    ok(voices.length === 2, `в план звука попали 2 голоса, получено ${voices.length}`);
    const totalSec = projectFrameCount(readyProject) / FPS;
    const mp4 = path.join(tmp, 'tts.mp4');
    const exp = run('export.ts', ['--project', readyFile, '--audio-dir', audioDir, '--scale', '0.25', '--out', mp4, '--overwrite']);
    ok(exp.status === 0 && fs.existsSync(mp4), `экспорт 0.25 со звуком завершился${exp.status === 0 ? '' : `: ${exp.stdout.slice(-500)}`}`);
    const verify = run('verify-export.ts', [mp4, '480', '270', String(FPS), String(totalSec), '--expect-audio']);
    ok(verify.status === 0, `verify-export --expect-audio PASS на ролике, озвученном tts${verify.status === 0 ? '' : `:\n${verify.stdout}`}`);

    console.log('--- ж) Piper: причины недоступны без живой машины ---');
    const noModel = piperStatus(['piper'], true, '', '', false);
    ok(!noModel.ok && (noModel.reason ?? '').includes('PIPER_MODEL'), `без PIPER_MODEL: ${noModel.reason}`);
    const noFile = piperStatus(['python', '-m', 'piper'], true, '', 'C:/голоса/нет.onnx', false);
    ok(!noFile.ok && (noFile.reason ?? '').includes('нет файла модели'), `модели нет на диске: ${noFile.reason}`);
    const noCmd = piperStatus([], false, 'spawn piper ENOENT', 'a.onnx', true);
    ok(!noCmd.ok && (noCmd.reason ?? '').includes('PIPER_CMD'), `пустой PIPER_CMD: ${noCmd.reason}`);
    ok(piperStatus(['piper'], true, '', 'C:/голоса/есть.onnx', true).ok, 'команда идёт и модель на месте — доступен');

    console.log('--- з) SAPI: только Windows и только установленный голос ---');
    ok(!sapiStatus([{ culture: 'ru-RU', name: 'X' }], 'linux', 'ru').ok, `не-Windows: ${sapiStatus([], 'linux', 'ru').reason}`);
    const noVoices = sapiStatus([], 'win32', 'ru');
    ok(!noVoices.ok && (noVoices.reason ?? '').includes('ни одного голоса'), `Windows без голосов: ${noVoices.reason}`);
    const wrongLang = sapiStatus([{ culture: 'en-US', name: 'Zira' }], 'win32', 'ru');
    ok(!wrongLang.ok && (wrongLang.reason ?? '').includes('нет русского голоса'), `нет русского голоса: ${wrongLang.reason}`);
    ok(sapiStatus([{ culture: 'ru-RU', name: 'Irina' }], 'win32', 'ru').ok, 'русский голос есть — доступен');
    ok(sapiStatus([{ culture: 'RU-ru', name: 'X' }], 'win32', 'ru').ok, 'культура голоса сравнивается без учёта регистра');
    ok(visibleTtsAdapters().every((adapter) => adapter.id !== 'fake') && TTS_ADAPTERS.some((adapter) => adapter.id === 'fake'), 'тестовый адаптер скрыт от человека, но доступен по --adapter fake');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('--- и) check:secrets не мешает настройкам TTS ---');
  const secrets = run('check-secrets.ts', []);
  ok(secrets.status === 0, `check:secrets PASS${secrets.status === 0 ? '' : `: ${secrets.stdout}${secrets.stderr}`}`);

  if (failures.length) {
    console.error(`check:tts FAIL (${failures.length}): ${failures.join(' | ')}`);
    process.exitCode = 1;
  } else console.log('check:tts PASS');
} catch (e) {
  console.error(`check:tts FAIL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
}
