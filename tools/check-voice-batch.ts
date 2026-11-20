// Пакетная озвучка: чистая логика voiceBatchPlan / runVoiceBatch без DOM и без fetch.
import { voiceBatchPlan, runVoiceBatch } from '../engine/voice-batch.ts';
import type { ProjectV1, ProjectSceneV1 } from '../engine/project.ts';

const failures: string[] = [];
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`OK   ${label}`);
  else { failures.push(label); console.error(`FAIL ${label}`); }
};

function scene(id: string, name: string, voice?: { text?: string; file?: string }): ProjectSceneV1 {
  return {
    id, name,
    scene: { duration: 5, palette: { sky: ['#123'] }, camera: { keys: [] }, assets: {}, layers: [] },
    transition: { type: 'cut' },
    voice,
  } as unknown as ProjectSceneV1;
}

function makeProject(scenes: ProjectSceneV1[]): ProjectV1 {
  return { version: 1, title: 'T', fps: 30, format: '16:9', scenes } as unknown as ProjectV1;
}

let synthCalls: { sceneId: string; text: string }[] = [];
let synthShouldThrow: string | null = null;

const synth = async (sceneId: string, text: string) => {
  synthCalls.push({ sceneId, text });
  if (synthShouldThrow === sceneId) throw new Error('босик');
  return { file: `tts/${sceneId}.wav`, words: [{ w: 'а', t0: 0, t1: 1 }], durationSec: 1 };
};

try {
  // а) все сцены с текстом озвучены, по порядку
  synthCalls = [];
  const p1 = makeProject([scene('s1', 'А', { text: 'привет' }), scene('s2', 'Б', { text: 'мир' })]);
  const plan1 = voiceBatchPlan(p1);
  ok(plan1.todo.length === 2, `план: 2 в работе, получено ${plan1.todo.length}`);
  ok(plan1.skipped === 0, `план: 0 пропущено`);
  const r1 = await runVoiceBatch(plan1, synth);
  ok(r1.ok === 2, `результат: ok=2, получено ${r1.ok}`);
  ok(r1.errors === 0, `результат: errors=0`);
  ok(synthCalls.length === 2, `синтез вызван 2 раза`);
  ok(synthCalls[0].sceneId === 's1' && synthCalls[1].sceneId === 's2', 'порядок сцен сохранён');

  // б) сцена без voice.text — в skipped
  const p2 = makeProject([scene('s1', 'А', { text: 'привет' }), scene('s2', 'Б')]);
  const plan2 = voiceBatchPlan(p2);
  ok(plan2.todo.length === 1, `план без текста: 1 в работе`);
  ok(plan2.skipped === 1, `план без текста: 1 пропущено`);

  // в) сцена с voice.file — в skipped
  const p3 = makeProject([scene('s1', 'А', { text: 'привет', file: 'v1.wav' }), scene('s2', 'Б', { text: 'мир' })]);
  const plan3 = voiceBatchPlan(p3);
  ok(plan3.todo.length === 1, `план с файлом: 1 в работе`);
  ok(plan3.skipped === 1, `план с файлом: 1 пропущено`);

  // г) ошибка одной сцены не мешает остальным
  synthCalls = [];
  synthShouldThrow = 's1';
  const p4 = makeProject([scene('s1', 'А', { text: 'а' }), scene('s2', 'Б', { text: 'б' }), scene('s3', 'В', { text: 'в' })]);
  const plan4 = voiceBatchPlan(p4);
  const r4 = await runVoiceBatch(plan4, synth);
  ok(r4.ok === 2, `ошибка сцены: ok=2, получено ${r4.ok}`);
  ok(r4.errors === 1, `ошибка сцены: errors=1`);
  ok(synthCalls.length === 3, `синтез вызван для всех 3 сцен Despite ошибку`);
  synthShouldThrow = null;

  // д) shouldAbort прерывает пачку
  synthCalls = [];
  const p5 = makeProject([scene('s1', 'А', { text: 'а' }), scene('s2', 'Б', { text: 'б' }), scene('s3', 'В', { text: 'в' })]);
  const plan5 = voiceBatchPlan(p5);
  const r5 = await runVoiceBatch(plan5, synth, { shouldAbort: () => true });
  ok(r5.ok === 0, `shouldAbort: ok=0, получено ${r5.ok}`);
  ok(synthCalls.length === 0, `shouldAbort: синтез не вызван`);

  // е) повторный запуск пропускает готовые (уже есть voice.file)
  const p6 = makeProject([scene('s1', 'А', { text: 'привет', file: 'tts/already.wav' })]);
  const plan6 = voiceBatchPlan(p6);
  ok(plan6.todo.length === 0, `повтор: 0 в работе`);
  ok(plan6.skipped === 1, `повтор: 1 пропущено`);

  if (failures.length) { console.error(`check:voice-batch FAIL (${failures.length}): ${failures.join(' | ')}`); process.exitCode = 1; }
  else console.log('check:voice-batch PASS');
} catch (e) {
  console.error(`check:voice-batch FAIL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
}
