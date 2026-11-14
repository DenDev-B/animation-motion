// Приёмка звука на таймлайне: раскладка, валидатор, реальные экспорты и измерения ffmpeg.
// Всё синтетическое живёт во временной папке и удаляется в finally; в репозиторий скрипт ничего не пишет.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudioPlan, projectFrameCount, sceneStartFrames, validateProject, type AudioPlanItem, type ProjectV1 } from '../engine/index.ts';
import { buildFfmpegArgs, isAudioItemAudible, type AudioInputItem } from './ffmpeg-audio.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;
const TOL_SEC = 0.1;
const SILENCE_FLOOR_DB = -60;
const SILENCE_MIN_SEC = 0.05;
const DUCK_DROP_DB = 3;
const TAIL_FLOOR_DB = -40;
const VOICE_HZ = 4000;
const MUSIC_HZ = 200;
// Измеряет уровень музыки, не глядя на голос: два lowpass режут 4000 Гц больше чем на 40 дБ.
const MUSIC_BAND = 'lowpass=f=1200,lowpass=f=1200';

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

function ffprobeJson(file: string, entries: string, select?: string): any {
  const args = ['-v', 'error'];
  if (select) args.push('-select_streams', select);
  args.push('-show_entries', entries, '-of', 'json', file);
  const r = spawnSync('ffprobe', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${(r.stderr ?? '').slice(-300)}`);
  return JSON.parse(r.stdout);
}

function audioFilterLog(file: string, filter: string): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', filter, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg -af ${filter} на ${file}: ${(r.stderr ?? '').slice(-400)}`);
  return r.stderr ?? '';
}

/** Средний уровень отрезка [from..to] в дБ; band — дополнительная фильтрация перед замером. */
function meanVolumeDb(file: string, from: number, to: number, band = ''): number {
  const filter = `atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS${band ? `,${band}` : ''},volumedetect`;
  const match = /mean_volume: (-?[\d.]+) dB/.exec(audioFilterLog(file, filter));
  if (!match) throw new Error(`volumedetect не дал mean_volume у ${file} на ${from}..${to}`);
  return Number(match[1]);
}

/** Начало первого звука: конец самой длинной начальной тишины; null — тишина на всю длину. */
function firstSoundSec(file: string): number | null {
  const log = audioFilterLog(file, `silencedetect=noise=${SILENCE_FLOOR_DB}dB:duration=${SILENCE_MIN_SEC}`);
  const end = /silence_end: (-?[\d.]+)/.exec(log);
  if (end) return Number(end[1]);
  return log.includes('silence_start') ? null : 0;
}

const scene = (title: string) => ({
  version: 1,
  title,
  duration: 3,
  palette: { sky: ['#123', '#456'] },
  camera: { keys: [] },
  assets: {},
  layers: [{ id: 'l', name: 'Слой', depth: 1, visible: true, objects: [{ id: 'sky', name: 'Небо', kind: 'sky', params: {} }] }],
});

/** Две сцены по 3 с со crossfade 0.8: 156 кадров, старты [0, 66], голос второй сцены на 2.5 с. */
function makeProject(opts: { firstVoice?: boolean; secondVoice?: boolean; music?: { gain?: number; duck?: boolean } | null }): ProjectV1 {
  const scenes = [
    { id: 's1', name: 'А', scene: scene('А'), transition: { type: 'cut' }, ...(opts.firstVoice === false ? {} : { voice: { file: 'v1.mp3', text: 'первая реплика' } }) },
    { id: 's2', name: 'Б', scene: scene('Б'), transition: { type: 'crossfade', duration: 0.8 }, ...(opts.secondVoice === false ? {} : { voice: { file: 'v2.wav', offset: 0.3 } }) },
  ];
  const project: Record<string, unknown> = { version: 1, title: 'Звук', fps: FPS, format: '16:9', scenes };
  if (opts.music) project.audio = { music: { file: 'music.m4a', ...opts.music } };
  return project as unknown as ProjectV1;
}

function exportProject(project: ProjectV1, audioDir: string, out: string, extra: string[] = []) {
  const file = out.replace(/\.mp4$/, '') + '.project.json';
  fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf8');
  return run('export.ts', ['--project', file, '--audio-dir', audioDir, '--scale', '0.25', '--out', out, '--overwrite', ...extra]);
}

function audible(items: AudioPlanItem[], totalSec: number, audioDir: string, durations: Record<string, number>): AudioInputItem[] {
  return items
    .map<AudioInputItem>((item) => ({ ...item, filePath: path.join(audioDir, item.file), durationSec: durations[item.file] }))
    .filter((item) => isAudioItemAudible(item, totalSec));
}

try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-audio-'));
  try {
    const audioDir = path.join(tmp, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    // тон голоса высоко (4000 Гц), тон музыки низко (200 Гц) — их раздельно измеряют фильтры ниже
    ffmpegTo(['-f', 'lavfi', '-i', `sine=frequency=${VOICE_HZ}:duration=0.6:sample_rate=48000`, '-ac', '2', '-c:a', 'libmp3lame', path.join(audioDir, 'v1.mp3')], 'v1.mp3');
    ffmpegTo(['-f', 'lavfi', '-i', `sine=frequency=${VOICE_HZ}:duration=1.0:sample_rate=48000`, '-ac', '1', '-c:a', 'pcm_s16le', path.join(audioDir, 'v2.wav')], 'v2.wav');
    ffmpegTo(['-f', 'lavfi', '-i', `sine=frequency=${MUSIC_HZ}:duration=2.0:sample_rate=48000`, '-ac', '1', '-c:a', 'aac', path.join(audioDir, 'music.m4a')], 'music.m4a');
    const mp3 = ffprobeJson(path.join(audioDir, 'v1.mp3'), 'stream=codec_name,channels,sample_rate', 'a:0').streams[0];
    const m4a = ffprobeJson(path.join(audioDir, 'music.m4a'), 'stream=codec_name,channels,sample_rate', 'a:0').streams[0];
    const wav = ffprobeJson(path.join(audioDir, 'v2.wav'), 'stream=codec_name,channels,sample_rate', 'a:0').streams[0];
    console.log(`входы: v1.mp3 ${mp3.channels} кан. ${mp3.sample_rate} Гц, music.m4a ${m4a.channels} кан. ${m4a.sample_rate} Гц, v2.wav ${wav.channels} кан.`);

    console.log('--- а) раскладка таймлайна с перекрытием перехода ---');
    const mix = makeProject({ music: { gain: 0.5 } });
    const mixCheck = validateProject(mix);
    ok(mixCheck.ok, `проект со звуком валиден${mixCheck.ok ? '' : `: ${JSON.stringify(mixCheck.errors)}`}`);
    const starts = sceneStartFrames(mix);
    ok(starts.join(',') === '0,66', `начала сцен в кадрах: [${starts}], ожидалось [0, 66]`);
    const totalFrames = projectFrameCount(mix);
    ok(totalFrames === 156, `длительность проекта: ${totalFrames} кадров, ожидалось 156 (3+3 минус 0.8 наложения)`);
    const plan = buildAudioPlan(mix);
    ok(Math.abs(plan.totalSec - totalFrames / FPS) < 1e-9, `дорожка равна видео: ${f2(plan.totalSec)} с при ${totalFrames}/${FPS} с`);
    const laid = plan.items.map((i) => `${i.kind}:${f2(i.startSec)}`).join(' ');
    ok(laid === 'voice:0.00 voice:2.50 music:0.00', `раскладка: ${laid}, ожидалось voice:0.00 voice:2.50 music:0.00`);

    console.log('--- б) окно куска как чистая функция ---');
    const durations: Record<string, number> = { 'v1.mp3': 0.6, 'v2.wav': 1.0, 'music.m4a': 2.0 };
    const clip13 = buildAudioPlan(mix, { startSec: 1, endSec: 3 });
    ok(f2(clip13.totalSec) === '2.00', `окно 1..3: дорожка ${f2(clip13.totalSec)} с`);
    const clip13Laid = clip13.items.map((i) => `${i.kind}:${f2(i.startSec)}`).join(' ');
    ok(clip13Laid === 'voice:-1.00 voice:1.50 music:-1.00', `окно 1..3 сдвигает всё на -1 с: ${clip13Laid}`);
    const clip13Heard = audible(clip13.items, clip13.totalSec, audioDir, durations).map((i) => i.file).join(',');
    ok(clip13Heard === 'v2.wav,music.m4a', `окно 1..3 слышно: ${clip13Heard} (v1 целиком до окна отброшен)`);
    const clip312 = buildAudioPlan(mix, { startSec: 3, endSec: 12 });
    ok(f2(clip312.totalSec) === '2.20', `окно 3..12 зажато концом ролика: ${f2(clip312.totalSec)} с из 5.20`);
    const clip312Laid = clip312.items.map((i) => `${i.kind}:${f2(i.startSec)}`).join(' ');
    ok(clip312Laid === 'voice:-3.00 voice:-0.50 music:-3.00', `окно 3..12: ${clip312Laid} (голос 2 начинается на 0.5 с раньше окна)`);
    const clip312Heard = audible(clip312.items, clip312.totalSec, audioDir, durations).map((i) => i.file).join(',');
    ok(clip312Heard === 'v2.wav,music.m4a', `окно 3..12 слышно: ${clip312Heard} (v1 лёг целиком до окна)`);
    ok(JSON.stringify(clip312) === JSON.stringify(buildAudioPlan(mix, { startSec: 3, endSec: 12 })), 'окно детерминировано: одинаковый вход даёт одинаковый план');
    ok(JSON.stringify(mix) === JSON.stringify(makeProject({ music: { gain: 0.5 } })), 'plan не меняет проект');

    console.log('--- в) валидатор звука ---');
    const badPath: Array<[string, string]> = [['../секрет.wav', 'родительский каталог'], ['/tmp/x.wav', 'абсолютный путь'], ['C:/audio/x.wav', 'буква диска'], ['voice\\s1.wav', 'обратный слэш'], ['s1.txt', 'чужое расширение']];
    for (const [file, why] of badPath) {
      const broken = structuredClone(mix) as any;
      broken.scenes[0].voice.file = file;
      const res = validateProject(broken);
      ok(!res.ok && res.errors.some((e) => e.path === 'scenes[0].voice.file'), `путь «${file}» (${why}): ошибка на scenes[0].voice.file`);
    }
    const badNumbers: Array<[string, (p: any) => void, string]> = [
      ['offset < 0', (p) => { p.scenes[0].voice.offset = -0.1; }, 'scenes[0].voice.offset'],
      ['gain голоса > 2', (p) => { p.scenes[0].voice.gain = 3; }, 'scenes[0].voice.gain'],
      ['gain голоса < 0', (p) => { p.scenes[0].voice.gain = -1; }, 'scenes[0].voice.gain'],
      ['gain музыки > 1', (p) => { p.audio.music.gain = 1.5; }, 'audio.music.gain'],
      ['duck не bool', (p) => { p.audio.music.duck = 'yes'; }, 'audio.music.duck'],
      ['text длиннее 2000', (p) => { p.scenes[0].voice.text = 'а'.repeat(2001); }, 'scenes[0].voice.text'],
      ['words не по порядку', (p) => { p.scenes[0].voice.words = [{ w: 'раз', t0: 0.5, t1: 0.8 }, { w: 'два', t0: 0.3, t1: 0.4 }]; }, 'scenes[0].voice.words[1].t0'],
      ['words t1 <= t0', (p) => { p.scenes[0].voice.words = [{ w: 'раз', t0: 0.5, t1: 0.5 }]; }, 'scenes[0].voice.words[0].t1'],
    ];
    for (const [label, mutate, wantPath] of badNumbers) {
      const broken = structuredClone(mix) as any;
      mutate(broken);
      const res = validateProject(broken);
      ok(!res.ok && res.errors.some((e) => e.path === wantPath), `${label}: ошибка на ${wantPath}`);
    }
    const goodWords = structuredClone(mix) as any;
    goodWords.scenes[0].voice.words = [{ w: 'раз', t0: 0.05, t1: 0.3 }, { w: 'два', t0: 0.3, t1: 0.55 }];
    ok(validateProject(goodWords).ok, 'корректные слова с стык-в-стык t0 принимаются');

    console.log('--- г) реальный экспорт двух сцен с crossfade (масштаб 0.25) ---');
    const mixMp4 = path.join(tmp, 'mix.mp4');
    const exportMix = exportProject(mix, audioDir, mixMp4);
    ok(exportMix.status === 0, `export.ts со звуком завершился${exportMix.status === 0 ? '' : `: ${exportMix.stdout.slice(-500)}${exportMix.stderr.slice(-300)}`}`);
    const graph = /звук filter_complex: (.+)/.exec(exportMix.stdout ?? '')?.[1] ?? '(строка не найдена)';
    console.log(`filter_complex: ${graph}`);
    ok(graph.includes('loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000'), 'после loudnorm стоит aresample=48000');
    ok(graph.includes('sidechaincompress'), 'музыка приглушается по голосу (duck по умолчанию)');
    const verifyMix = run('verify-export.ts', [mixMp4, '480', '270', String(FPS), '5.2', '--expect-audio']);
    ok(verifyMix.status === 0, `verify-export --expect-audio PASS на полном ролике${verifyMix.status === 0 ? '' : `\n${verifyMix.stdout}`}`);
    const outStream = ffprobeJson(mixMp4, 'stream=codec_name,sample_rate,channels', 'a:0').streams[0];
    ok(outStream?.codec_name === 'aac' && outStream?.sample_rate === '48000', `выходной поток: ${outStream?.codec_name} ${outStream?.sample_rate} Гц ${outStream?.channels} кан.`);

    console.log('--- д) первый звук строго там, где начинается голос 2 ---');
    const voiceOnly = makeProject({ firstVoice: false });
    const voiceMp4 = path.join(tmp, 'voice.mp4');
    const exportVoice = exportProject(voiceOnly, audioDir, voiceMp4);
    ok(exportVoice.status === 0, `export.ts без музыки завершился${exportVoice.status === 0 ? '' : `: ${exportVoice.stdout.slice(-500)}`}`);
    const onset = firstSoundSec(voiceMp4);
    ok(onset !== null && Math.abs(onset - 2.5) <= TOL_SEC, `первый звук на ${onset === null ? '—' : f2(onset)} с, ожидание 2.50 ±${TOL_SEC} с (старт сцены 2.2 + offset 0.3)`);

    console.log('--- е) кусок: длительность аудио = видео, начало голоса сдвинуто на -startSec окна ---');
    const clipMp4 = path.join(tmp, 'clip.mp4');
    const exportClip = exportProject(voiceOnly, audioDir, clipMp4, ['--range', '1:3']);
    ok(exportClip.status === 0, `export.ts --range 1:3 со звуком завершился${exportClip.status === 0 ? '' : `: ${exportClip.stdout.slice(-500)}`}`);
    const verifyClip = run('verify-export.ts', [clipMp4, '480', '270', String(FPS), '2', '--expect-audio']);
    ok(verifyClip.status === 0, `приёмка куска с аудио PASS${verifyClip.status === 0 ? '' : `\n${verifyClip.stdout}`}`);
    const clipTimes = ['v:0', 'a:0'].map((sel) => Number(ffprobeJson(clipMp4, 'stream=duration', sel).streams[0]?.duration));
    ok(clipTimes.every(Number.isFinite) && Math.abs(clipTimes[0] - clipTimes[1]) <= TOL_SEC, `длительности куска: видео ${clipTimes[0].toFixed(3)} с, аудио ${clipTimes[1].toFixed(3)} с, допуск ${TOL_SEC} с`);
    const clipOnset = firstSoundSec(clipMp4);
    ok(clipOnset !== null && Math.abs(clipOnset - 1.5) <= TOL_SEC, `голос в куске начинается на ${clipOnset === null ? '—' : f2(clipOnset)} с, ожидание 1.50 = 2.5 − 1.0 (старт окна)`);

    // окно 3..5 лежит целиком за концом 2-секундного файла музыки: трек повторяется и не должен потеряться
    const musicOnly = makeProject({ firstVoice: false, secondVoice: false, music: { gain: 0.5 } });
    const musicClipMp4 = path.join(tmp, 'music-clip.mp4');
    const exportMusicClip = exportProject(musicOnly, audioDir, musicClipMp4, ['--range', '3:5']);
    ok(exportMusicClip.status === 0 && /звук: 1 файл/.test(exportMusicClip.stdout ?? ''), `кусок 3:5 только с музыкой собран (${/звук: [^\n]*/.exec(exportMusicClip.stdout ?? '')?.[0] ?? 'строка звука не найдена'})`);
    const verifyMusicClip = run('verify-export.ts', [musicClipMp4, '480', '270', String(FPS), '2', '--expect-audio']);
    ok(verifyMusicClip.status === 0, `музыка в куске из середины ролика не потерялась: приёмка с аудио PASS${verifyMusicClip.status === 0 ? '' : `\n${verifyMusicClip.stdout}`}`);

    console.log('--- ж) duck: музыка под голосом и хвост после последней реплики ---');
    const noDuck = makeProject({ music: { gain: 0.5, duck: false } });
    const noDuckMp4 = path.join(tmp, 'noduck.mp4');
    const exportNoDuck = exportProject(noDuck, audioDir, noDuckMp4);
    ok(exportNoDuck.status === 0, `export.ts с duck=false завершился${exportNoDuck.status === 0 ? '' : `: ${exportNoDuck.stdout.slice(-500)}`}`);
    // голос 1 занимает 0..0.6 с; замер в его середине, полосовым фильтром — только музыка на 200 Гц
    const duckLevel = meanVolumeDb(mixMp4, 0.15, 0.5, MUSIC_BAND);
    const flatLevel = meanVolumeDb(noDuckMp4, 0.15, 0.5, MUSIC_BAND);
    console.log(`замеры музыки в окне голоса 0.15..0.50 с: duck=true ${duckLevel.toFixed(1)} dB, duck=false ${flatLevel.toFixed(1)} dB, разница ${(flatLevel - duckLevel).toFixed(1)} dB`);
    ok(flatLevel - duckLevel >= DUCK_DROP_DB, `под голосом музыка тише минимум на ${DUCK_DROP_DB} дБ (получено ${(flatLevel - duckLevel).toFixed(1)})`);
    const beforeVoice = meanVolumeDb(mixMp4, 2.0, 2.4, MUSIC_BAND);
    console.log(`для сравнения музыка до голоса (2.00..2.40 с): ${beforeVoice.toFixed(1)} dB`);
    ok(duckLevel < beforeVoice - DUCK_DROP_DB, `duck=true тише собственной музыки вне голоса на ${(beforeVoice - duckLevel).toFixed(1)} дБ`);
    const tail = meanVolumeDb(mixMp4, 4.0, 4.9);
    console.log(`хвост музыки после последней реплики (голос кончается на 3.50 с), окно 4.00..4.90 с: ${tail.toFixed(1)} dB`);
    ok(tail >= TAIL_FLOOR_DB, `хвост музыки не тише ${TAIL_FLOOR_DB} дБ (получено ${tail.toFixed(1)}) — обрыва после сайдчейна нет`);

    console.log('--- и) проект без audio: команда ffmpeg не изменилась ---');
    const REFERENCE_ARGS = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1920x1080', '-r', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-y', 'out.mp4'];
    const baseArgs = { width: 1920, height: 1080, fps: FPS, preset: 'slow', crf: 20, outFile: 'out.mp4' };
    ok(JSON.stringify(buildFfmpegArgs(baseArgs)) === JSON.stringify(REFERENCE_ARGS), 'без audio: массив аргументов побайтово равен прежнему');
    ok(JSON.stringify(buildFfmpegArgs({ ...baseArgs, audio: { items: [], totalSec: 0 } })) === JSON.stringify(REFERENCE_ARGS), 'audio с пустым списком: тот же массив, без -filter_complex и без -c:a');
    const withAudio = buildFfmpegArgs({ ...baseArgs, audio: { items: [{ kind: 'music', file: 'music.m4a', startSec: 0, gain: 0.5, filePath: path.join(audioDir, 'music.m4a'), durationSec: 2 }], totalSec: 5.2 } });
    ok(withAudio.join(' ').includes('-c:a aac -b:a 192k -ar 48000'), 'со звуком к тем же аргументам добавлены -c:a aac -ar 48000');

    console.log('--- приёмка пустой дорожки ---');
    const silentMp4 = path.join(tmp, 'silent.mp4');
    ffmpegTo(['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', silentMp4], 'пустой mp4');
    const verifySilent = run('verify-export.ts', [silentMp4, '320', '240', String(FPS), '1', '--expect-audio']);
    ok(verifySilent.status === 0 && verifySilent.stdout.includes('громкость пропущена'), `полностью тихая дорожка проходит без проверки LUFS${verifySilent.stdout.includes('громкость пропущена') ? '' : `\n${verifySilent.stdout}`}`);

    console.log(failures.length ? `check:audio FAIL (${failures.length})` : 'check:audio PASS');
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} catch (e) {
  console.error(`ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
