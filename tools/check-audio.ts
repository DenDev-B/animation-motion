// Приёмка звука на таймлайне: раскладка, валидатор, реальные экспорты и измерения ffmpeg.
// Всё синтетическое живёт во временной папке и удаляется в finally; в репозиторий скрипт ничего не пишет.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudioPlan, projectFrameCount, sceneStartFrames, validateProject, type AudioPlanItem, type ProjectV1 } from '../engine/index.ts';
import { buildAudioFilter, buildFfmpegArgs, buildMeasureFilter, isAudioItemAudible, masterFilter, GAIN_LIMIT_DB, type AudioInputItem } from './ffmpeg-audio.ts';
import { gainDbFrom, parseLoudnormReport } from './audio-gain.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;
const TOL_SEC = 0.1;
const SILENCE_FLOOR_DB = -60;
const SILENCE_MIN_SEC = 0.05;
const DUCK_DROP_DB = 3;
const TAIL_FLOOR_DB = -40;
const LOUD_TARGET_DB = -14;
// Потолок приёмки true peak: на 0.5 дБ ниже потолка alimiter (−1.5 dBTP) — запас на кодирование AAC.
const PEAK_CEILING_DB = -1.0;
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

/** Интегральная громкость и true peak всего файла по ebur128 — тот же измеритель, что проверяет verify-export. */
function loudnessOf(file: string): { i: number; tp: number } {
  const log = audioFilterLog(file, 'ebur128=peak=true');
  const i = /Summary:[\s\S]*?\n\s*I:\s*(-?[\d.]+|-inf) LUFS/.exec(log)?.[1];
  const tp = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(log)?.[1];
  if (i === undefined || tp === undefined) throw new Error(`ebur128 не дал I или True peak у ${file}`);
  return { i: Number(i), tp: Number(tp) };
}

const scene = (title: string, duration = 3) => ({
  version: 1,
  title,
  duration,
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

/** Одна сцена заданной длины с одним голосом: случай «реплика короче сцены», где один проход loudnorm не сходился. */
function toneProject(file: string, sceneSec: number, gain?: number): ProjectV1 {
  const entry: Record<string, unknown> = {
    id: 's1', name: 'Тон', scene: scene('Тон', sceneSec), transition: { type: 'cut' },
    voice: { file, ...(gain === undefined ? {} : { gain }) },
  };
  return { version: 1, title: 'Громкость', fps: FPS, format: '16:9', scenes: [entry] } as unknown as ProjectV1;
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
    fs.mkdirSync(path.join(audioDir, 'sfx'), { recursive: true });
    ffmpegTo(['-f', 'lavfi', '-i', `sine=frequency=${VOICE_HZ}:duration=0.3:sample_rate=48000`, '-ac', '1', '-c:a', 'pcm_s16le', path.join(audioDir, 'sfx', 'click.wav')], 'sfx/click.wav');
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

    console.log('--- б1) sfx в плане звука (смещение по сцене, окно пробы, отрицательный старт) ---');
    const sfxDurations = { 'v1.mp3': 0.6, 'v2.wav': 1.0, 'music.m4a': 2.0, 'sfx/click.wav': 0.3 };
    const sfxProject = {
      ...structuredClone(mix),
      scenes: [
        { ...mix.scenes[0], sfx: [{ file: 'sfx/click.wav', at: 0.5, gain: 1 }] },
        { ...mix.scenes[1], sfx: [{ file: 'sfx/click.wav', at: 2.5 }] },
      ],
    } as any;
    const sfxPlan = buildAudioPlan(sfxProject);
    const sfxLaid = sfxPlan.items.filter((i) => i.kind === 'sfx').map((i) => `sfx:${f2(i.startSec)}`).join(' ');
    ok(sfxLaid === 'sfx:0.50 sfx:4.70', `план sfx: ${sfxLaid}, ожидалось sfx:0.50 sfx:4.70`);
    // окно 1..3: первый эффект за окном (отброшен), второй начинается на 4.7 за концом окна (отброшен)
    const sfxClip = buildAudioPlan(sfxProject, { startSec: 1, endSec: 3 });
    const sfxClipLaid = sfxClip.items.filter((i) => i.kind === 'sfx').map((i) => `sfx:${f2(i.startSec)}`).join(' ');
    ok(sfxClipLaid === 'sfx:-0.50', `окно 1..3: первый эффект с отрицательным стартом (оставляется), второй за концом (отброшен): ${sfxClipLaid}`);
    const sfxClipHeard = sfxClip.items.filter((i) => i.kind === 'sfx' && isAudioItemAudible({ ...i as any, filePath: path.join(audioDir, i.file), durationSec: sfxDurations[i.file as keyof typeof sfxDurations] }, sfxClip.totalSec)).map((i) => i.file).join(',');
    ok(sfxClipHeard === '', `окно 1..3: эффекты не слышны`);
    // окно 0..4: первый эффект на 0.5 (внутри), второй на 4.7 за концом (отброшен)
    const sfxClip2 = buildAudioPlan(sfxProject, { startSec: 0, endSec: 4 });
    const sfxClip2Laid = sfxClip2.items.filter((i) => i.kind === 'sfx').map((i) => `sfx:${f2(i.startSec)}`).join(' ');
    ok(sfxClip2Laid === 'sfx:0.50', `окно 0..4: эффект внутри окна, второй за концом: ${sfxClip2Laid}`);
    // фильтр со sfx вне sidechain: голос + sfx без музыки не содержат sidechaincompress
    const voiceSfxProject = { ...structuredClone(sfxProject), audio: undefined } as any;
    const voiceSfxPlan = buildAudioPlan(voiceSfxProject);
    const graphVoiceSfx = buildAudioFilter(voiceSfxPlan.items.map((i, idx) => ({ ...i, filePath: path.join(audioDir, i.file), durationSec: sfxDurations[i.file as keyof typeof sfxDurations] ?? 0.3, duck: i.kind === 'music' ? true : undefined, sfx: i.kind === 'sfx' })), voiceSfxPlan.totalSec, null);
    ok(!graphVoiceSfx.includes('sidechaincompress'), 'фильтр голос+sfx не содержит sidechaincompress (sfx не приглушает музыку)');
    ok(graphVoiceSfx.includes('sfx0') || graphVoiceSfx.includes('sfx1'), 'фильтр содержит ветки sfx');

    console.log('--- б2) сцена без озвучки, но с sfx ---');
    const noVoiceProject = {
      ...structuredClone(mix),
      scenes: [
        { ...mix.scenes[0], sfx: undefined },
        { ...mix.scenes[1], voice: undefined, sfx: [{ file: 'sfx/click.wav', at: 1.0, gain: 1 }] },
      ],
    } as any;
    const noVoicePlan = buildAudioPlan(noVoiceProject);
    const noVoiceLaid = noVoicePlan.items.map((i) => `${i.kind}:${f2(i.startSec)}`).join(' ');
    ok(noVoiceLaid === 'voice:0.00 sfx:3.20 music:0.00', `план без голоса во второй сцене: ${noVoiceLaid}, ожидалось voice:0.00 sfx:3.20 music:0.00`);

    // проект только с sfx, без голоса и без музыки
    const sfxOnlyProject = {
      version: 1, title: 'SFX только', fps: FPS, format: '16:9',
      scenes: [
        {
          id: 's1', name: 'А',
          scene: scene('А', 3),
          transition: { type: 'cut' },
          sfx: [{ file: 'sfx/click.wav', at: 0.5 }, { file: 'sfx/click.wav', at: 2.0 }],
        },
      ],
    } as any;
    const sfxOnlyPlan = buildAudioPlan(sfxOnlyProject);
    const sfxOnlyLaid = sfxOnlyPlan.items.map((i) => `${i.kind}:${f2(i.startSec)}`).join(' ');
    ok(sfxOnlyLaid === 'sfx:0.50 sfx:2.00', `план только sfx: ${sfxOnlyLaid}, ожидалось sfx:0.50 sfx:2.00`);
    ok(Math.abs(sfxOnlyPlan.totalSec - 3) < 1e-9, `только sfx: длительность дорожки ${f2(sfxOnlyPlan.totalSec)} с, ожидалось 3.00`);

    // окно пробы для только sfx: окно 1..2, эффект на 0.5 -> отрицательный старт (оставляется), на 2.0 -> за концом (отброшен)
    const sfxOnlyClip = buildAudioPlan(sfxOnlyProject, { startSec: 1, endSec: 2 });
    const sfxOnlyClipLaid = sfxOnlyClip.items.map((i) => `${i.kind}:${f2(i.startSec)}`).join(' ');
    ok(sfxOnlyClipLaid === 'sfx:-0.50', `окно 1..2 только sfx: ${sfxOnlyClipLaid}, ожидалось sfx:-0.50`);

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
    ok(graph.includes('alimiter=limit=0.84:level=disabled,aresample=48000'), 'мастер-шина: потолок пиков, затем aresample=48000');
    ok(!graph.includes('loudnorm'), 'в основном проходе loudnorm нет — громкость берётся из измерения прохода 1');
    const applied = /volume=(-?[\d.]+)dB/.exec(graph)?.[1];
    ok(applied !== undefined && Math.abs(Number(applied)) <= GAIN_LIMIT_DB, `усиление мастер-шины в пределе ±${GAIN_LIMIT_DB} дБ: volume=${applied ?? 'не найдено'}dB`);
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
    ok(JSON.stringify(buildFfmpegArgs({ ...baseArgs, audio: { items: [], totalSec: 0, gainDb: null } })) === JSON.stringify(REFERENCE_ARGS), 'audio с пустым списком: тот же массив, без -filter_complex и без -c:a');
    const musicItem: AudioInputItem = { kind: 'music', file: 'music.m4a', startSec: 0, gain: 0.5, filePath: path.join(audioDir, 'music.m4a'), durationSec: 2 };
    const withAudio = buildFfmpegArgs({ ...baseArgs, audio: { items: [musicItem], totalSec: 5.2, gainDb: 4.2 } });
    ok(withAudio.join(' ').includes('-c:a aac -b:a 192k -ar 48000'), 'со звуком к тем же аргументам добавлены -c:a aac -ar 48000');

    console.log('--- к) мастер-шина: усиление из измерения, предел, разбор JSON ---');
    ok(masterFilter(4.2, 6) === 'volume=4.2dB,alimiter=limit=0.84:level=disabled,aresample=48000,apad,atrim=0:6', 'усиление → потолок пиков → ровная длина дорожки');
    ok(masterFilter(null, 6) === 'aresample=48000,apad,atrim=0:6', 'пропуск нормализации: в мастер-шине остаётся только длина');
    ok(buildAudioFilter([musicItem], 6, 4.2).includes('volume=4.2dB'), 'граф основного прохода использует то же усиление');
    ok(!buildAudioFilter([musicItem], 6, 4.2).includes('loudnorm'), 'в основном проходе loudnorm нет');
    ok(buildMeasureFilter([musicItem], 6).includes('apad,atrim=0:6,loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[aout]'), 'проход 1: та же длина дорожки и loudnorm только на печать измерения');
    ok(gainDbFrom(-18.23) !== null && Math.abs(gainDbFrom(-18.23)! - 4.23) < 1e-9, 'усиление = цель − измеренная громкость (−18.23 → +4.23 дБ)');
    ok(gainDbFrom(-50) === GAIN_LIMIT_DB, `очень тихий вход ограничен +${GAIN_LIMIT_DB} дБ`);
    ok(gainDbFrom(10) === -GAIN_LIMIT_DB, `очень громкий вход ограничен −${GAIN_LIMIT_DB} дБ`);
    ok(gainDbFrom(-70) === null && gainDbFrom(null) === null, 'пустой вход: усиление не назначается');
    const report = parseLoudnormReport(['лог ffmpeg', '{"input_i" : "-99.99"}', '{', '"input_i" : "-18.23",', '"input_tp" : "-21.07",', '"input_lra" : "7.6"', '}'].join('\n'));
    ok(report.inputI === -18.23 && report.inputTp === -21.07, 'разбор берёт последний JSON с input_i, а не первый объект лога');
    ok(parseLoudnormReport('{"input_i" : "-inf",\n"input_tp" : "-inf"\n}').inputI === null, 'тишина: -inf читается как «нет измерения»');
    ok(parseLoudnormReport('stderr без единого json').inputI === null, 'пустое измерение не роняет экспорт');

    console.log('--- приёмка пустой дорожки ---');
    const silentMp4 = path.join(tmp, 'silent.mp4');
    ffmpegTo(['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', silentMp4], 'пустой mp4');
    const verifySilent = run('verify-export.ts', [silentMp4, '320', '240', String(FPS), '1', '--expect-audio']);
    ok(verifySilent.status === 0 && verifySilent.stdout.includes('громкость пропущена'), `полностью тихая дорожка проходит без проверки LUFS${verifySilent.stdout.includes('громкость пропущена') ? '' : `\n${verifySilent.stdout}`}`);

    console.log('--- л) нормализация по измерению на реальных роликах ---');
    // тон в −6 dBFS (громкость около −2.9 LUFS): тогда и gain 0.05, и gain 2 требуют усиления в пределах ±20 дБ
    ffmpegTo(['-f', 'lavfi', '-i', `sine=frequency=${VOICE_HZ}:duration=6:sample_rate=48000`, '-af', 'volume=12dB', '-ac', '1', '-c:a', 'pcm_s16le', path.join(audioDir, 'loud.wav')], 'loud.wav');
    ffmpegTo(['-f', 'lavfi', '-i', `sine=frequency=${VOICE_HZ}:duration=2.3:sample_rate=48000`, '-ac', '1', '-c:a', 'pcm_s16le', path.join(audioDir, 'rare.wav')], 'rare.wav');
    ffmpegTo(['-f', 'lavfi', '-i', `sine=frequency=${VOICE_HZ}:duration=6:sample_rate=48000`, '-ac', '1', '-c:a', 'pcm_s16le', path.join(audioDir, 'dense.wav')], 'dense.wav');
    ffmpegTo(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '6', '-c:a', 'pcm_s16le', path.join(audioDir, 'silence.wav')], 'silence.wav');
    const gainLine = (stdout: string) => /громкость: [^\n]*/.exec(stdout ?? '')?.[0] ?? '(строка про громкость не найдена)';
    const loudOf = (label: string, mp4: string) => {
      const l = loudnessOf(mp4);
      console.log(`${label}: ${l.i.toFixed(1)} LUFS, true peak ${l.tp.toFixed(1)} dBFS (ebur128=peak=true)`);
      return l;
    };

    // л1 — редкий звук: 2.3 с реплики в 6-секундной сцене, тот случай, где однопроходный loudnorm давал −8.2 LUFS
    const rareMp4 = path.join(tmp, 'rare.mp4');
    const rare = exportProject(toneProject('rare.wav', 6), audioDir, rareMp4);
    ok(rare.status === 0, `экспорт редкого звука завершился${rare.status === 0 ? '' : `: ${(rare.stdout ?? '').slice(-400)}`}`);
    console.log(`проход 1: ${gainLine(rare.stdout)}`);
    const rareL = loudOf('л1 редкий звук 2.3 с в 6 с', rareMp4);
    ok(Math.abs(rareL.i - LOUD_TARGET_DB) <= 1, `редкий звук в ${LOUD_TARGET_DB} ±1 LUFS (получено ${rareL.i.toFixed(1)})`);
    const verifyRare = run('verify-export.ts', [rareMp4, '480', '270', String(FPS), '6', '--expect-audio']);
    ok(verifyRare.status === 0, `verify-export --expect-audio PASS на редком звуке${verifyRare.status === 0 ? '' : `\n${verifyRare.stdout}`}`);

    // л2 — плотный звук: проверка не ухудшилась там, где прежний способ работал
    const denseMp4 = path.join(tmp, 'dense.mp4');
    const dense = exportProject(toneProject('dense.wav', 6), audioDir, denseMp4);
    ok(dense.status === 0, `экспорт плотного звука завершился${dense.status === 0 ? '' : `: ${(dense.stdout ?? '').slice(-400)}`}`);
    const denseL = loudOf('л2 плотный звук 6 с в 6 с', denseMp4);
    ok(Math.abs(denseL.i - LOUD_TARGET_DB) <= 1, `плотный звук в ${LOUD_TARGET_DB} ±1 LUFS (получено ${denseL.i.toFixed(1)})`);

    // л3 — очень тихий и очень громкий входы: усиление остаётся в ±20 дБ, пики — под ограничителем
    const quietMp4 = path.join(tmp, 'quiet.mp4');
    const quiet = exportProject(toneProject('loud.wav', 6, 0.05), audioDir, quietMp4);
    ok(quiet.status === 0, `экспорт тихого входа (gain 0.05) завершился${quiet.status === 0 ? '' : `: ${(quiet.stdout ?? '').slice(-400)}`}`);
    console.log(`проход 1: ${gainLine(quiet.stdout)}`);
    const quietL = loudOf('л3 gain 0.05', quietMp4);
    ok(Math.abs(quietL.i - LOUD_TARGET_DB) <= 1.5, `тихий вход в ${LOUD_TARGET_DB} ±1.5 LUFS (получено ${quietL.i.toFixed(1)})`);
    const loudMp4 = path.join(tmp, 'loud.mp4');
    const loudEntry = exportProject(toneProject('loud.wav', 6, 2), audioDir, loudMp4);
    ok(loudEntry.status === 0, `экспорт громкого входа (gain 2) завершился${loudEntry.status === 0 ? '' : `: ${(loudEntry.stdout ?? '').slice(-400)}`}`);
    console.log(`проход 1: ${gainLine(loudEntry.stdout)}`);
    const loudL = loudOf('л3 gain 2', loudMp4);
    ok(Math.abs(loudL.i - LOUD_TARGET_DB) <= 1.5, `громкий вход в ${LOUD_TARGET_DB} ±1.5 LUFS (получено ${loudL.i.toFixed(1)})`);
    ok(quietL.tp <= PEAK_CEILING_DB && loudL.tp <= PEAK_CEILING_DB, `true peak обоих роликов ≤ ${PEAK_CEILING_DB} dBFS (получено ${quietL.tp.toFixed(1)} и ${loudL.tp.toFixed(1)})`);

    // л4 — пустая дорожка: измерение не назначает усиление, экспорт не падает
    const muteMp4 = path.join(tmp, 'mute.mp4');
    const mute = exportProject(toneProject('silence.wav', 6), audioDir, muteMp4);
    ok(mute.status === 0, `экспорт с полностью тихим файлом завершился${mute.status === 0 ? '' : `: ${(mute.stdout ?? '').slice(-400)}`}`);
    ok(/звук пустой, нормализация пропущена/.test(mute.stdout ?? ''), `в логе есть строка про пропуск: ${gainLine(mute.stdout)}`);

    // л5 — кусок: окно тоже меряется своим планом, поэтому громкость держится и внутри ролика
    const rareClipMp4 = path.join(tmp, 'rare-clip.mp4');
    const rareClip = exportProject(toneProject('rare.wav', 6), audioDir, rareClipMp4, ['--range', '0:4']);
    ok(rareClip.status === 0, `экспорт куска 0:4 со звуком завершился${rareClip.status === 0 ? '' : `: ${(rareClip.stdout ?? '').slice(-400)}`}`);
    const clipDurations = ['v:0', 'a:0'].map((sel) => Number(ffprobeJson(rareClipMp4, 'stream=duration', sel).streams[0]?.duration));
    ok(clipDurations.every(Number.isFinite) && Math.abs(clipDurations[0] - clipDurations[1]) <= TOL_SEC, `кусок: видео ${clipDurations[0].toFixed(3)} с, аудио ${clipDurations[1].toFixed(3)} с, допуск ${TOL_SEC} с`);
    const clipL = loudOf('л5 кусок 0:4', rareClipMp4);
    ok(Math.abs(clipL.i - LOUD_TARGET_DB) <= 1.5, `кусок в ${LOUD_TARGET_DB} ±1.5 LUFS (получено ${clipL.i.toFixed(1)})`);
    const verifyRareClip = run('verify-export.ts', [rareClipMp4, '480', '270', String(FPS), '4', '--expect-audio']);
    ok(verifyRareClip.status === 0, `приёмка куска с нормализованным звуком PASS${verifyRareClip.status === 0 ? '' : `\n${verifyRareClip.stdout}`}`);

    // л6 — потолок пиков: щёлчки с гребнем 14 дБ без ограничителя дали бы около нуля dBTP.
    // Материал с гребнем больше 12.5 дБ (цель −14 LUFS минус потолок −1.5 dBTP) в цель не влезает по определению,
    // поэтому тут проверяется работа ограничителя, а громкость — только то, что он её не съел.
    ffmpegTo(['-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*1000*t)*lt(mod(t\\,0.25)\\,0.01):d=4:s=48000', '-ac', '2', '-c:a', 'pcm_s16le', path.join(audioDir, 'clicks.wav')], 'clicks.wav');
    const clicksMp4 = path.join(tmp, 'clicks.mp4');
    const clicks = exportProject(toneProject('clicks.wav', 4), audioDir, clicksMp4);
    ok(clicks.status === 0, `экспорт пиковой нагрузки завершился${clicks.status === 0 ? '' : `: ${(clicks.stdout ?? '').slice(-400)}`}`);
    console.log(`проход 1: ${gainLine(clicks.stdout)}`);
    const clickGain = Number(/усиление ([+-]?[\d.]+) дБ/.exec(clicks.stdout ?? '')?.[1] ?? NaN);
    const clickSource = loudnessOf(path.join(audioDir, 'clicks.wav'));
    const clickWouldBe = clickSource.tp + clickGain;
    console.log(`без ограничителя: пики входа ${clickSource.tp.toFixed(1)} dBTP + усиление ${clickGain.toFixed(1)} дБ = ${clickWouldBe.toFixed(1)} dBTP (гребень ${(clickSource.tp - clickSource.i).toFixed(1)} дБ)`);
    ok(clickWouldBe > PEAK_CEILING_DB, 'фикстура реально перегружает потолок пиков (иначе проверка ограничителя ничего не доказывает)');
    const clicksL = loudOf('л6 щёлчки с ограничителем', clicksMp4);
    ok(clicksL.tp <= PEAK_CEILING_DB, `alimiter держит true peak ≤ ${PEAK_CEILING_DB} dBFS (было бы ${clickWouldBe.toFixed(1)}, стало ${clicksL.tp.toFixed(1)})`);
    ok(clicksL.tp < clickWouldBe - 0.5, `ограничитель реально снизил пики на ${(clickWouldBe - clicksL.tp).toFixed(1)} дБ`);
    ok(clicksL.i >= LOUD_TARGET_DB - 2, `ограничитель не съел громкость: ${clicksL.i.toFixed(1)} LUFS не тише ${LOUD_TARGET_DB - 2}`);

    console.log(failures.length ? `check:audio FAIL (${failures.length})` : 'check:audio PASS');
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} catch (e) {
  console.error(`ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
