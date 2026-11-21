// Тесты lintProject: clean ok, по одному кейсу на правило, audioFiles не передан -> voice-file-missing не срабатывает, детерминированность.
// Тест CLI: запуск lint-project через child_process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintProject } from '../engine/lint.ts';

function scene(duration = 8, objects: { kind: string }[] = []): any {
  const layers: any[] = [];
  if (objects.length) layers.push({ id: 'l1', name: 'Слой', depth: 1, visible: true, objects });
  else layers.push({ id: 'l1', name: 'Пустой', depth: 1, visible: true, objects: [] });
  return {
    id: 's1', name: 'Сцена',
    scene: {
      version: 1, title: 'Сцена', duration,
      palette: { sky: ['#123', '#456'] },
      camera: { keys: [{ t: 0, x: 0, y: 0, zoom: 1 }] },
      assets: {},
      layers,
    },
    transition: { type: 'cut' },
  };
}

function project(scenes: any[], format = '16:9'): any {
  return { version: 1, title: 'Проверка', fps: 30, format, scenes };
}

const code = (issues: { code: string }[], c: string) => issues.some((i) => i.code === c);

function voicesOf(issues: { code: string }[], c: string) { return issues.filter((i) => i.code === c); }

try {
  // чистый проект — ok, нет warn
  const clean = project([scene(8, [{ kind: 'sky' }, { kind: 'hills' }])]);
  assert.deepEqual(lintProject(clean), { ok: true, issues: [] }, 'чистый проект: ok безwarn');

  // voice-too-long (warn): текст длиннее duration
  const tooLong = project([{
    ...scene(1),
    voice: { text: 'Это довольно длинный дикторский текст, который не влезет в сцену.' },
  }]);
  const r1 = lintProject(tooLong);
  assert.ok(code(r1.issues, 'voice-too-long'), `voice-too-long: ${JSON.stringify(r1.issues)}`);
  assert.equal(r1.ok, false, 'voice-too-long: ok=false');

  // voice-too-long не срабатывает, если всё укладывается
  const fits = project([{
    ...scene(30),
    voice: { text: 'короткий текст' },
  }]);
  assert.ok(!code(lintProject(fits).issues, 'voice-too-long'), 'voice-too-long не срабатывает при укладывании');

  // voice-text-only (info): есть text, нет file
  const textOnly = project([{
    ...scene(10),
    voice: { text: 'текст без файла' },
  }]);
  const r2 = lintProject(textOnly);
  assert.ok(code(r2.issues, 'voice-text-only'), `voice-text-only: ${JSON.stringify(r2.issues)}`);

  // voice-file-missing (warn, только с audioFiles): voice.file не в списке
  const missing = project([{
    ...scene(10),
    voice: { file: 'nonexistent.wav' },
  }]);
  const r3a = lintProject(missing, { audioFiles: ['a.wav'] });
  assert.ok(code(r3a.issues, 'voice-file-missing'), `voice-file-missing с audioFiles: ${JSON.stringify(r3a.issues)}`);
  const r3b = lintProject(missing); // audioFiles не передан -> не срабатывает
  assert.ok(!code(r3b.issues, 'voice-file-missing'), 'voice-file-missing без audioFiles не срабатывает');

  // voice-file-missing для audio.music.file
  const musicMissing = project([scene(10)]);
  musicMissing.audio = { music: { file: 'no-music.mp3' } };
  const r4 = lintProject(musicMissing, { audioFiles: ['a.wav'] });
  assert.ok(code(r4.issues, 'voice-file-missing'), `voice-file-missing музыка: ${JSON.stringify(r4.issues)}`);

  // voice-no-words (info): есть file, нет words, субтитры включены
  const noWords = project([{
    ...scene(10),
    voice: { file: 'a.wav' },
  }]);
  const r5 = lintProject(noWords, { audioFiles: ['a.wav'] });
  assert.ok(code(r5.issues, 'voice-no-words'), `voice-no-words: ${JSON.stringify(r5.issues)}`);

  // voice-no-words не срабатывает если subtitles.enabled === false
  const noSubs = project([{ ...scene(10), voice: { file: 'a.wav' } }]);
  noSubs.subtitles = { enabled: false };
  const r5b = lintProject(noSubs, { audioFiles: ['a.wav'] });
  assert.ok(!code(r5b.issues, 'voice-no-words'), 'voice-no-words не срабатывает при subtitles.enabled=false');

  // scene-short (warn): duration < 1.5
  const short = project([scene(1.0)]);
  const r6 = lintProject(short);
  assert.ok(code(r6.issues, 'scene-short'), `scene-short: ${JSON.stringify(r6.issues)}`);
  assert.equal(r6.ok, false, 'scene-short: ok=false');

  // scene-long (info): duration > 30
  const longScene = project([scene(31, [{ kind: 'hills' }])]);
  const r7 = lintProject(longScene);
  assert.ok(code(r7.issues, 'scene-long'), `scene-long: ${JSON.stringify(r7.issues)}`);
  assert.equal(r7.ok, true, 'scene-long: ok=true (info не ломает ok)');

  // total-long-shorts (warn): 9:16 и суммарная > 60 с
  const longVert = project([scene(30), scene(31), scene(30)], '9:16');
  const r8 = lintProject(longVert);
  assert.ok(code(r8.issues, 'total-long-shorts'), `total-long-shorts: ${JSON.stringify(r8.issues)}`);
  assert.equal(r8.ok, false, 'total-long-shorts: ok=false');

  // total-long-shorts не срабатывает для 16:9
  const longHoriz = project([scene(30), scene(31), scene(30)], '16:9');
  assert.ok(!code(lintProject(longHoriz).issues, 'total-long-shorts'), 'total-long-shorts не срабатывает для 16:9');

  // scene-empty (warn): только небо или нет объектов
  const empty = project([scene(8, [{ kind: 'sky' }])]);
  const r9 = lintProject(empty);
  assert.ok(code(r9.issues, 'scene-empty'), `scene-empty: ${JSON.stringify(r9.issues)}`);
  assert.equal(r9.ok, false, 'scene-empty: ok=false');

  // scene-empty не срабатывает если есть не-небо объект
  const notEmpty = project([scene(8, [{ kind: 'sky' }, { kind: 'hills' }])]);
  assert.ok(!code(lintProject(notEmpty).issues, 'scene-empty'), 'scene-empty не срабатывает при наличии объекта');

  // scene-name-duplicate (info)
  const dup = project([{ ...scene(8), name: 'А' }, { ...scene(8, []), id: 's2', name: 'А' }]);
  const r10 = lintProject(dup);
  assert.ok(code(r10.issues, 'scene-name-duplicate'), `scene-name-duplicate: ${JSON.stringify(r10.issues)}`);

  // transition-long (warn): переход > половины более короткой сцены
  const transLong = project([
    { ...scene(2), id: 's1' },
    { ...scene(10), id: 's2', transition: { type: 'crossfade', duration: 2 } },
  ]);
  const r11 = lintProject(transLong);
  assert.ok(code(r11.issues, 'transition-long'), `transition-long: ${JSON.stringify(r11.issues)}`);
  assert.equal(r11.ok, false, 'transition-long: ok=false');

  // transition-long не срабатывает при допустимом duration
  const transOk = project([
    { ...scene(4), id: 's1' },
    { ...scene(4), id: 's2', transition: { type: 'crossfade', duration: 1 } },
  ]);
  assert.ok(!code(lintProject(transOk).issues, 'transition-long'), 'transition-long не срабатывает при норме');

  // детерминированность
  const det = project([{ ...scene(10), voice: { file: 'a.wav', text: 'текст' } }]);
  const a1 = JSON.stringify(lintProject(det, { audioFiles: ['a.wav'] }));
  const a2 = JSON.stringify(lintProject(det, { audioFiles: ['a.wav'] }));
  assert.equal(a1, a2, 'детерминированность: два вызова дают одинаковый результат');

  // --- CLI через child_process ---
  const rootCli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  function runCli(file: string): { code: number | null; stdout: string } {
    const res = spawnSync(process.execPath, [path.join(rootCli, 'tools', 'lint-project.ts'), file], { encoding: 'utf8' });
    return { code: res.status, stdout: res.stdout ?? '' };
  }

  const ncc = runCli('projects/night-city-car.project.json');
  assert.equal(ncc.code, 0, `night-city-car exit 0 (stdout: ${ncc.stdout.slice(0, 200)})`);
  assert.ok(ncc.stdout.includes('lint:'), `night-city-car есть итог lint: (${ncc.stdout})`);
  assert.ok(!ncc.stdout.includes('[error]'), `night-city-car нет [error] (${ncc.stdout})`);

  const wd = runCli('projects/whale-demo.project.json');
  assert.equal(wd.code, 0, `whale-demo exit 0 (stdout: ${wd.stdout.slice(0, 200)})`);

  const tmp = path.join(os.tmpdir(), `lint-bad-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, scenes: [] }));
  const bad = runCli(tmp);
  fs.rmSync(tmp, { force: true });
  assert.equal(bad.code, 1, `невалидный exit 1`);
  assert.ok(bad.stdout.includes('не прошёл проверку схемы'), `невалидный: итог схемы (${bad.stdout})`);

  console.log('check:lint PASS');
} catch (e) {
  console.error(`check:lint FAIL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
}
