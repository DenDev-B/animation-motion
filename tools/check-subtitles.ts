// Приёмка субтитров: кью из слов, границы активности, SRT, валидатор, отрисовка и реальные экспорты.
// Всё синтетическое живёт во временной папке и удаляется в finally; в репозиторий скрипт ничего не пишет.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, Path2D } from '@napi-rs/canvas';
import {
  activeCueAt,
  buildAudioPlan,
  buildSubtitleCues,
  createRenderCache,
  drawSubtitle,
  formatSrt,
  renderFrame,
  validateProject,
  type ProjectV1,
  type SubtitleCue,
} from '../engine/index.ts';
import { SAFE_ZONES } from '../engine/spec.ts';
(globalThis as any).Path2D = Path2D;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;
const failures: string[] = [];
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`OK   ${label}`);
  else {
    failures.push(label);
    console.error(`FAIL ${label}`);
  }
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const run = (script: string, args: string[]) => spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { cwd: root, encoding: 'utf8' });
const ffmpeg = (args: string[]) => {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg: ${(result.stderr ?? '').slice(-400)}`);
};

const scene = (title: string, sky: [string, string]) => ({
  version: 1,
  title,
  duration: 3,
  palette: { sky },
  camera: { keys: [] },
  assets: {},
  layers: [{ id: 'l', name: 'Слой', depth: 1, visible: true, objects: [{ id: 'sky', name: 'Небо', kind: 'sky', params: {} }] }],
});

/** Две сцены по 3 с со crossfade 0.8: 156 кадров, старты [0, 66]; голос второй сцены сдвинут на 0.3 с. */
function makeProject(): ProjectV1 {
  return {
    version: 1,
    title: 'Субтитры',
    fps: FPS,
    format: '16:9',
    scenes: [
      {
        id: 's1', name: 'А', scene: scene('А', ['#102040', '#3060a0']), transition: { type: 'cut' },
        voice: {
          file: 'v1.wav',
          text: 'привет раз два три четыре пять шесть',
          words: [
            { w: 'привет.', t0: 0.1, t1: 0.5 },
            { w: 'раз', t0: 0.5, t1: 0.7 },
            { w: 'два', t0: 0.7, t1: 0.9 },
            { w: 'три', t0: 0.9, t1: 1.1 },
            { w: 'четыре', t0: 1.1, t1: 1.4 },
            { w: 'пять', t0: 1.4, t1: 1.7 },
            { w: 'шесть', t0: 1.7, t1: 2.0 },
          ],
        },
      },
      {
        id: 's2', name: 'Б', scene: scene('Б', ['#201008', '#a06030']), transition: { type: 'crossfade', duration: 0.8 },
        voice: {
          file: 'v2.wav',
          offset: 0.3,
          text: 'второй кадр',
          words: [
            { w: 'второй', t0: 0, t1: 0.4 },
            { w: 'кадр', t0: 2.5, t1: 2.9 },
          ],
        },
      },
    ],
  } as ProjectV1;
}

function texts(cues: readonly SubtitleCue[]): string[] {
  return cues.map((cue) => cue.text);
}

function parseSrtTime(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (!match) throw new Error(`не время SRT: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function parseSrt(text: string): Array<{ index: number; t0: number; t1: number; text: string }> {
  return text.split(/\n\n+/).filter(Boolean).map((block) => {
    const lines = block.split('\n');
    const [from, to] = lines[1].split(' --> ');
    return { index: Number(lines[0]), t0: parseSrtTime(from), t1: parseSrtTime(to), text: lines.slice(2).join('\n') };
  });
}

async function pixels(file: string): Promise<{ w: number; h: number; data: Buffer }> {
  const image = await loadImage(file);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { w: image.width, h: image.height, data: Buffer.from(ctx.getImageData(0, 0, image.width, image.height).data) };
}

function pixelDiff(a: Buffer, b: Buffer, w: number, h: number, bandTop: number): { inside: number; outside: number } {
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (y * w + x) * 4;
      if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2] || a[index + 3] !== b[index + 3]) {
        if (y < bandTop) outside++;
        else inside++;
      }
    }
  }
  return { inside, outside };
}

function textBBox(w: number, h: number, cue: SubtitleCue, style: { position?: 'bottom' | 'center' | 'top' }, format: '16:9' | '9:16') {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  drawSubtitle(ctx, w, h, cue, style, format);
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (y * w + x) * 4;
      if (data[index] > 24 || data[index + 1] > 24 || data[index + 2] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function engineFrame(project: ProjectV1, t: number, w: number, h: number): Buffer {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderFrame(ctx, project.scenes[0].scene, t, { w, h }, {
    createCanvas: ((w2: number, h2: number) => createCanvas(w2, h2)) as unknown as (a: number, b: number) => HTMLCanvasElement,
    catalog: {},
    cache: createRenderCache(),
  });
  return Buffer.from(ctx.getImageData(0, 0, w, h).data);
}

function writeProject(file: string, project: ProjectV1): void {
  fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const project = makeProject();
  ok(validateProject(project).ok, 'тестовый проект валиден');

  // а) кью из слов
  const base = buildSubtitleCues(project);
  ok(base.missingWords.length === 0, 'у всех озвученных сцен есть тайминги слов');
  ok(base.cues.length === 4, `кью по умолчанию: ${base.cues.length}, ожидалось 4`);
  ok(texts(base.cues).join('|') === 'привет.|раз два три|четыре пять шесть|второй кадр', `группировка по 3 слова: ${texts(base.cues).join('|')}`);
  ok(near(base.cues[0].t0, 0.1) && near(base.cues[0].t1, 0.5), 'первая реплика: 0.1–0.5 с');
  const plan = buildAudioPlan(project);
  const secondStart = plan.items.find((item) => item.kind === 'voice' && item.sceneIndex === 1)!.startSec;
  ok(near(secondStart, 2.5), `голос второй сцены начинается на ${secondStart} с (старт сцены + offset)`);
  ok(near(base.cues[3].t0, secondStart), 'начало реплики второй сцены = startSec из buildAudioPlan');
  ok(near(base.cues[3].t1, 5.2), `хвост реплики обрезан концом ролика: ${base.cues[3].t1} с`);
  for (let i = 1; i < base.cues.length; i++) ok(base.cues[i - 1].t1 <= base.cues[i].t0 + 1e-9, `стык реплик ${i}: предыдущая не позже следующей`);

  const one = buildSubtitleCues({ ...project, subtitles: { maxWords: 1 } });
  ok(one.cues.length === 9, `maxWords=1: ${one.cues.length} кью, ожидалось 9`);

  const six = buildSubtitleCues({ ...project, subtitles: { maxWords: 6 } });
  ok(six.cues.length === 3, `maxWords=6: ${six.cues.length} кью, ожидалось 3`);
  ok(near(six.cues[0].t1, 0.5), 'точка рвёт фразу раньше лимита слов');
  ok(six.cues[1].text === 'раз два три четыре пять шесть' && near(six.cues[1].t1, 2.0), 'фраза без точки держит до 6 слов');

  const upper = buildSubtitleCues({ ...project, subtitles: { upper: true } });
  ok(upper.cues[0].text === 'ПРИВЕТ.', `upper на кириллице: ${upper.cues[0].text}`);

  const missing = structuredClone(project);
  missing.scenes[1].voice = { text: 'без таймингов' };
  ok(buildSubtitleCues(missing).missingWords.join(',') === '1', 'сцена с текстом без слов попадает в missingWords');

  // б) activeCueAt
  const pair: SubtitleCue[] = [{ t0: 0, t1: 1, text: 'a' }, { t0: 1, t1: 2, text: 'b' }];
  ok(activeCueAt(pair, 0)?.text === 'a', 't0 включительно');
  ok(activeCueAt(pair, 0.999)?.text === 'a', 'внутри реплики');
  ok(activeCueAt(pair, 1)?.text === 'b', 't1 не включительно: на стыке уже следующая');
  ok(activeCueAt(pair, 2) === null, 't1 исключительно: конец последней — null');
  ok(activeCueAt(pair, -1) === null && activeCueAt(pair, 3) === null, 'до первой и после последней — null');

  // в) SRT
  const srt = formatSrt([{ t0: 0, t1: 1.5, text: 'Привет' }, { t0: 3661.4, t1: 3661.5, text: 'Мир' }]);
  ok(srt === '1\n00:00:00,000 --> 00:00:01,500\nПривет\n\n2\n01:01:01,400 --> 01:01:01,500\nМир\n\n', 'формат SRT: нумерация, время, пустая строка, хвост');
  ok(srt.endsWith('\n'), 'SRT заканчивается переводом строки');
  const parsed = parseSrt(srt);
  ok(parsed.length === 2 && parsed[0].index === 1 && parsed[1].index === 2, 'SRT читается обратно: номера 1 и 2');
  ok(near(parsed[1].t0, 3661.4) && near(parsed[1].t1, 3661.5), 'SRT читается обратно: 3661.5 с = 01:01:01,500');
  ok(parsed[0].text === 'Привет' && parsed[1].text === 'Мир', 'SRT читается обратно: текст сохранён');

  // г) валидатор
  const badSubtitles: Array<[string, unknown]> = [
    ['maxWords 0', { maxWords: 0 }],
    ['maxWords 7', { maxWords: 7 }],
    ['maxWords 1.5', { maxWords: 1.5 }],
    ['size 0.02', { size: 0.02 }],
    ['size 0.13', { size: 0.13 }],
    ['size строкой', { size: '0.05' }],
    ['position вне списка', { position: 'middle' }],
    ['enabled не bool', { enabled: 'yes' }],
    ['upper не bool', { upper: 'yes' }],
    ['subtitles не объект', 'x'],
  ];
  for (const [label, value] of badSubtitles) {
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    raw.subtitles = value;
    ok(!validateProject(raw).ok, `валидатор отклоняет ${label}`);
  }
  const goodRaw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
  goodRaw.subtitles = { enabled: false, maxWords: 6, upper: true, position: 'top', size: 0.12 };
  ok(validateProject(goodRaw).ok, 'валидатор принимает все поля в границах');

  // д) отрисовка: изменение только в нижней полосе
  for (const [format, w, h] of [['16:9', 1280, 720], ['9:16', 720, 1280]] as const) {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    renderFrame(ctx, project.scenes[0].scene, 0.3, { w, h }, {
      createCanvas: ((w2: number, h2: number) => createCanvas(w2, h2)) as unknown as (a: number, b: number) => HTMLCanvasElement,
      catalog: {},
      cache: createRenderCache(),
    });
    const before = Buffer.from(ctx.getImageData(0, 0, w, h).data);
    drawSubtitle(ctx, w, h, { t0: 0.1, t1: 0.5, text: 'привет.' }, { position: 'bottom' }, format);
    const after = Buffer.from(ctx.getImageData(0, 0, w, h).data);
    const bandTop = Math.floor(h * 0.6);
    const diff = pixelDiff(before, after, w, h, bandTop);
    ok(diff.outside === 0, `${format}: вне нижней полосы пиксели не изменились (${diff.outside})`);
    ok(diff.inside > 0, `${format}: в нижней полосе субтитр нарисован (${diff.inside} пикселей)`);

    const bbox = textBBox(w, h, { t0: 0, t1: 1, text: 'Привет мир' }, { position: 'bottom' }, format);
    const zone = SAFE_ZONES[format];
    const k = h / 1000;
    ok(bbox !== null, `${format}: текст субтитра найден по пикселям`);
    if (bbox) {
      ok(bbox.x0 >= zone.left * k - 1 && bbox.x1 <= w - zone.right * k + 1, `${format}: по горизонтали текст внутри безопасной зоны (${bbox.x0}..${bbox.x1})`);
      ok(bbox.y0 >= zone.top * k - 1 && bbox.y1 <= h - zone.bottom * k + 1, `${format}: по вертикали текст внутри безопасной зоны (${bbox.y0}..${bbox.y1}, низ ${(h - zone.bottom * k).toFixed(1)})`);
    }
  }

  // е) очень длинная фраза ужимается и переносится в 90% ширины
  const longCue: SubtitleCue = { t0: 0, t1: 1, text: 'это очень длинная фраза без знаков препинания которая должна поместиться в две строки и не вылезти за край кадра' };
  const longBox = textBBox(1280, 720, longCue, { position: 'bottom' }, '16:9');
  ok(longBox !== null && longBox.x1 - longBox.x0 <= 1280 * 0.9 + 1, `длинная фраза в пределах 90% ширины (${longBox ? longBox.x1 - longBox.x0 : 'нет'} из ${1280 * 0.9})`);

  // ж) реальные экспорты
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-subtitles-'));
  try {
    const audioDir = path.join(dir, 'audio');
    fs.mkdirSync(audioDir);
    for (const name of ['v1.wav', 'v2.wav']) ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'pcm_s16le', path.join(audioDir, name)]);

    const withFile = path.join(dir, 'with.project.json');
    const plainFile = path.join(dir, 'plain.project.json');
    const subProject = structuredClone(project);
    subProject.subtitles = {};
    const plainProject = structuredClone(project);
    writeProject(withFile, subProject);
    writeProject(plainFile, plainProject);

    const subFrame = path.join(dir, 'sub.png');
    const plainFrame = path.join(dir, 'plain.png');
    const rf = run('export.ts', ['--project', withFile, '--frame', '0.3', '--out', subFrame, '--overwrite']);
    const rp = run('export.ts', ['--project', plainFile, '--frame', '0.3', '--out', plainFrame, '--overwrite']);
    ok(rf.status === 0 && fs.existsSync(subFrame), `экспорт кадра с субтитрами: успешно${rf.status === 0 ? '' : ` (${rf.stdout.slice(-300)})`}`);
    ok(rp.status === 0 && fs.existsSync(plainFrame), `экспорт кадра без subtitles: успешно${rp.status === 0 ? '' : ` (${rp.stdout.slice(-300)})`}`);
    if (fs.existsSync(subFrame) && fs.existsSync(plainFrame)) {
      const a = await pixels(subFrame);
      const b = await pixels(plainFrame);
      ok(a.w === 1920 && a.h === 1080, `PNG кадра 1920x1080 (${a.w}x${a.h})`);
      const diff = pixelDiff(a.data, b.data, a.w, a.h, Math.floor(a.h * 0.6));
      ok(diff.outside === 0 && diff.inside > 0, `экспорт: вне нижней полосы 0 отличий, в полосе ${diff.inside}`);
      const engine = engineFrame(plainProject, 0.3, 1920, 1080);
      ok(Buffer.compare(b.data, engine) === 0, 'проект без subtitles: PNG побайтно равен кадру движка');
    }

    const subFrameZero = path.join(dir, 'sub-zero.png');
    const plainFrameZero = path.join(dir, 'plain-zero.png');
    run('export.ts', ['--project', withFile, '--frame', '0', '--out', subFrameZero, '--overwrite']);
    run('export.ts', ['--project', plainFile, '--frame', '0', '--out', plainFrameZero, '--overwrite']);
    if (fs.existsSync(subFrameZero) && fs.existsSync(plainFrameZero)) {
      const a = await pixels(subFrameZero);
      const b = await pixels(plainFrameZero);
      ok(Buffer.compare(a.data, b.data) === 0, 'вне интервала реплики кадр с subtitles побайтно равен кадру без поля');
    }

    const clip = path.join(dir, 'clip.mp4');
    const rc = run('export.ts', ['--project', withFile, '--range', '0:3', '--scale', '0.25', '--audio-dir', audioDir, '--out', clip, '--overwrite']);
    ok(rc.status === 0 && fs.existsSync(clip), `экспорт куска 0:3 со звуком и субтитрами: успешно${rc.status === 0 ? '' : ` (${rc.stdout.slice(-500)})`}`);
    if (fs.existsSync(clip)) {
      const verify = run('verify-export.ts', [clip, '480', '270', '30', '3', '--expect-audio']);
      ok(verify.status === 0, `кусок проходит приёмку MP4 со звуком${verify.status === 0 ? '' : `: ${verify.stdout.slice(-400)}`}`);
      const srtFile = clip.replace(/\.mp4$/, '.srt');
      ok(fs.existsSync(srtFile), `рядом с MP4 создан SRT (${path.basename(srtFile)})`);
      ok(/субтитры: 4 кью, файл/.test(rc.stdout), 'экспорт пишет число кью и путь SRT');
      if (fs.existsSync(srtFile)) {
        const cues = parseSrt(fs.readFileSync(srtFile, 'utf8'));
        ok(cues.length === 4, `в SRT куска 4 реплики (${cues.length})`);
        ok(cues.length > 0 && near(cues[0].t0, 0.1) && near(cues[0].t1, 0.5), 'SRT куска: первая реплика 0.1–0.5');
        ok(cues.length > 0 && near(cues[cues.length - 1].t0, 2.5) && near(cues[cues.length - 1].t1, 3.0), 'SRT куска: хвост обрезан окном на 3.0 с');
      }
    }

    const clip2 = path.join(dir, 'clip2.mp4');
    const rc2 = run('export.ts', ['--project', withFile, '--range', '2:3', '--scale', '0.25', '--audio-dir', audioDir, '--out', clip2, '--overwrite']);
    ok(rc2.status === 0 && fs.existsSync(clip2), `экспорт куска 2:3: успешно${rc2.status === 0 ? '' : ` (${rc2.stdout.slice(-500)})`}`);
    if (fs.existsSync(clip2)) {
      const verify = run('verify-export.ts', [clip2, '480', '270', '30', '1', '--expect-audio']);
      ok(verify.status === 0, `кусок 2:3 проходит приёмку MP4 со звуком${verify.status === 0 ? '' : `: ${verify.stdout.slice(-400)}`}`);
      const srtFile = clip2.replace(/\.mp4$/, '.srt');
      if (fs.existsSync(srtFile)) {
        const cues = parseSrt(fs.readFileSync(srtFile, 'utf8'));
        ok(cues.length === 1 && near(cues[0].t0, 0.5) && near(cues[0].t1, 1.0), 'SRT куска 2:3 сдвинут окном: 0.5–1.0');
      } else {
        ok(false, 'у куска 2:3 нет SRT');
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(failures.length ? `check:subtitles FAIL (${failures.length})` : 'check:subtitles PASS');
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
