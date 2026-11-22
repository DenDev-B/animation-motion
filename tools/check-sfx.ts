// Проверка генератора звуковых эффектов (npm run sfx:gen): детерминированность, валидные WAV, пик <= -3 dBFS, длины в диапазоне.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateProject, type ProjectV1 } from '../engine/index.ts';
import { lintProject } from '../engine/lint.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SFX_NAMES = ['click', 'whoosh', 'hit', 'ding', 'pop', 'rise'] as const;
const MIN_LEN = 0.08;
const MAX_LEN = 1.3;
const SAMPLE_RATE = 44100;

const failures: string[] = [];
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`OK   ${label}`);
  else { failures.push(label); console.error(`FAIL ${label}`); }
};

function sha1(file: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function readWavHeader(file: string): { sampleRate: number; channels: number; bits: number; dataSize: number; durationSec: number } {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${file}: не RIFF`);
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: не WAVE`);
  const sampleRate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const bits = buf.readUInt16LE(34);
  const dataSize = buf.readUInt32LE(40);
  return { sampleRate, channels, bits, dataSize, durationSec: dataSize / (sampleRate * channels * bits / 8) };
}

function peakDb(file: string): number {
  const buf = fs.readFileSync(file);
  const dataStart = 44;
  const dataSize = buf.readUInt32LE(40);
  let peak = 0;
  for (let i = dataStart; i < dataStart + dataSize; i += 2) {
    const s = buf.readInt16LE(i);
    if (Math.abs(s) > peak) peak = Math.abs(s);
  }
  return 20 * Math.log10(peak / 32768);
}

function runSfxGen(args: string[]): { status: number | null; stderr: string } {
  return spawnSync(process.execPath, [path.join(root, 'tools', 'sfx-gen.ts'), ...args], { encoding: 'utf8' });
}

try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sfx-'));
  try {
    // а) генерация в temp-папку дважды — хеши равны (детерминированность)
    const dir1 = path.join(tmp, 'sfx1');
    const dir2 = path.join(tmp, 'sfx2');
    const run1 = runSfxGen(['--out', dir1]);
    ok(run1.status === 0, `первый запуск sfx:gen${run1.status === 0 ? '' : `: ${run1.stderr.slice(-300)}`}`);
    const run2 = runSfxGen(['--out', dir2]);
    ok(run2.status === 0, `второй запуск sfx:gen${run2.status === 0 ? '' : `: ${run2.stderr.slice(-300)}`}`);
    for (const name of SFX_NAMES) {
      const f1 = path.join(dir1, `${name}.wav`);
      const f2 = path.join(dir2, `${name}.wav`);
      ok(fs.existsSync(f1), `${name}.wav создан`);
      ok(fs.existsSync(f2), `${name}.wav создан во втором запуске`);
      ok(sha1(f1) === sha1(f2), `${name}.wav: детерминированно (хеши равны)`);
    }

    // б) валидные WAV, пик <= -3 dBFS, длины в диапазоне, моно 44100
    for (const name of SFX_NAMES) {
      const file = path.join(dir1, `${name}.wav`);
      const h = readWavHeader(file);
      ok(h.sampleRate === SAMPLE_RATE, `${name}.wav: sampleRate 44100 (${h.sampleRate})`);
      ok(h.channels === 1, `${name}.wav: mono (${h.channels})`);
      ok(h.bits === 16, `${name}.wav: 16-bit (${h.bits})`);
      ok(h.durationSec >= MIN_LEN && h.durationSec <= MAX_LEN, `${name}.wav: длина ${h.durationSec.toFixed(2)} с в [0.08, 1.3]`);
      const peak = peakDb(file);
      ok(peak <= -3, `${name}.wav: пик ${peak.toFixed(1)} dBFS <= -3`);
    }

    // в) --force перезаписывает существующие файлы
    const beforeMtime = fs.statSync(path.join(dir1, 'click.wav')).mtimeMs;
    const runForce = runSfxGen(['--out', dir1, '--force']);
    ok(runForce.status === 0, `--force запускается${runForce.status === 0 ? '' : `: ${runForce.stderr.slice(-300)}`}`);
    const afterMtime = fs.statSync(path.join(dir1, 'click.wav')).mtimeMs;
    ok(afterMtime > beforeMtime, `--force перезаписывает файлы`);

    // г) схема: валидный проект с sfx проходит validateProject
    const goodProject: ProjectV1 = {
      version: 1, title: 'SFX', fps: 30, format: '16:9',
      scenes: [{
        id: 's1', name: 'А',
        scene: { version: 1, title: 'А', duration: 3, palette: { sky: ['#123', '#456'] }, camera: { keys: [] }, assets: {}, layers: [{ id: 'l', name: 'Слой', depth: 1, visible: true, objects: [] }] },
        transition: { type: 'cut' },
        sfx: [{ file: 'sfx/click.wav', at: 0.5, gain: 1 }, { file: 'sfx/ding.wav', at: 1.5 }],
      }],
    };
    ok(validateProject(goodProject).ok, 'валидный проект с sfx проходит validateProject');

    // д) схема: плохие at/gain/file не проходят
    const badAt = structuredClone(goodProject) as any;
    badAt.scenes[0].sfx![0].at = -0.1;
    ok(!validateProject(badAt).ok && validateProject(badAt).errors.some((e) => e.path === 'scenes[0].sfx[0].at'), 'at < 0 отвергается');

    const badGain = structuredClone(goodProject) as any;
    badGain.scenes[0].sfx![0].gain = 3;
    ok(!validateProject(badGain).ok && validateProject(badGain).errors.some((e) => e.path === 'scenes[0].sfx[0].gain'), 'gain > 2 отвергается');

    const badFile = structuredClone(goodProject) as any;
    badFile.scenes[0].sfx![0].file = 'nonexistent.txt';
    ok(!validateProject(badFile).ok && validateProject(badFile).errors.some((e) => e.path === 'scenes[0].sfx[0].file'), 'неправильное расширение file отвергается');

    const manySfx = structuredClone(goodProject) as any;
    manySfx.scenes[0].sfx = Array.from({ length: 65 }, (_, i) => ({ file: 'sfx/click.wav', at: i * 0.01 }));
    ok(!validateProject(manySfx).ok && validateProject(manySfx).errors.some((e) => e.path === 'scenes[0].sfx'), 'больше 64 эффектов отвергается');

    // е) lint: sfx-after-scene (at > duration) — warn
    const lateSfx = structuredClone(goodProject) as any;
    lateSfx.scenes[0].sfx = [{ file: 'sfx/click.wav', at: 5.0 }];
    const lintLate = lintProject(lateSfx, { audioFiles: ['sfx/click.wav'] });
    ok(lintLate.issues.some((i) => i.code === 'sfx-after-scene'), `lint sfx-after-scene: ${JSON.stringify(lintLate.issues)}`);

    // ё) lint: sfx-file-missing — warn, только если audioFiles передан
    const missingSfx = structuredClone(goodProject) as any;
    missingSfx.scenes[0].sfx = [{ file: 'sfx/missing.wav', at: 0.5 }];
    const lintMissing = lintProject(missingSfx, { audioFiles: ['sfx/click.wav'] });
    ok(lintMissing.issues.some((i) => i.code === 'sfx-file-missing'), `lint sfx-file-missing: ${JSON.stringify(lintMissing.issues)}`);
    const lintMissingNoCtx = lintProject(missingSfx);
    ok(!lintMissingNoCtx.issues.some((i) => i.code === 'sfx-file-missing'), 'sfx-file-missing не срабатывает без audioFiles');

    // ж) lint: sfx-many — info, больше 20 эффектов
    const manySfx2 = structuredClone(goodProject) as any;
    manySfx2.scenes[0].sfx = Array.from({ length: 21 }, (_, i) => ({ file: 'sfx/click.wav', at: i * 0.05 }));
    const lintMany = lintProject(manySfx2, { audioFiles: ['sfx/click.wav'] });
    ok(lintMany.issues.some((i) => i.code === 'sfx-many'), `lint sfx-many: ${JSON.stringify(lintMany.issues)}`);

    // з) старый проект без sfx не получает новых предупреждений
    const oldProject: ProjectV1 = {
      version: 1, title: 'Old', fps: 30, format: '16:9',
      scenes: [{
        id: 's1', name: 'А',
        scene: { version: 1, title: 'А', duration: 3, palette: { sky: ['#123', '#456'] }, camera: { keys: [] }, assets: {}, layers: [{ id: 'l', name: 'Слой', depth: 1, visible: true, objects: [] }] },
        transition: { type: 'cut' },
      }],
    };
    const lintOld = lintProject(oldProject, { audioFiles: [] });
    ok(!lintOld.issues.some((i) => i.code.startsWith('sfx')), `старый проект без sfx: нет sfx-предупреждений, получено ${lintOld.issues.length}`);

    if (failures.length) { console.error(`check:sfx FAIL (${failures.length}): ${failures.join(' | ')}`); process.exitCode = 1; }
    else console.log('check:sfx PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} catch (e) {
  console.error(`check:sfx FAIL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
}
