// Проверка озвучки в проектах от ИИ: estimateSpeechSec, подгонка duration под voice.text, удаление voice.file.
import { buildProjectPrompt, PROJECT_PROMPT_MAX_BYTES, validateProjectReply, type CatalogEntry } from '../engine/ai-project.ts';
import { estimateSpeechSec } from '../engine/tts-timing.ts';

const failures: string[] = [];
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`OK   ${label}`);
  else { failures.push(label); console.error(`FAIL ${label}`); }
};

const catalog: CatalogEntry[] = [
  { id: 'whale', name: 'Кит', tags: ['кит'], view: 'side', realSize: { heightM: 15 }, bounds: [-50, -50, 100, 100] },
];

function projectWithVoice(text: string, duration: number, file?: string) {
  return {
    version: 1,
    title: 'Озвучка',
    fps: 30,
    format: '16:9',
    scenes: [{
      id: 's1', name: 'Сцена',
      scene: { version: 1, title: 'Сцена', duration, palette: { sky: ['#123', '#456'] }, camera: { keys: [] }, assets: {}, layers: [] },
      transition: { type: 'cut' },
      voice: { text, ...(file ? { file } : {}) },
    }],
  } as unknown;
}

try {
  // 1) estimateSpeechSec монотонна по длине текста и детерминирована
  const a = estimateSpeechSec('привет мир');
  const b = estimateSpeechSec('привет мир ещё несколько слов для проверки монотонности');
  ok(a >= 0 && b >= a, `монотонна: ${a} <= ${b}`);
  ok(estimateSpeechSec('привет мир') === estimateSpeechSec('привет мир'), 'детерминирована (повторный вызов даёт то же)');
  ok(estimateSpeechSec('а. б! в?', 'ru') > estimateSpeechSec('а б в', 'ru'), 'паузы на конце предложения увеличивают время');
  ok(estimateSpeechSec('а, б', 'ru') > estimateSpeechSec('а б', 'ru'), 'запятая увеличивает время');

  // 2) проект от ИИ с длинным voice.text и короткой duration -> увеличен duration + замечание
  const longText = 'Это довольно длинный дикторский текст, который точно не влезет в короткую сцену и требует увеличения длительности.';
  const proj = projectWithVoice(longText, 1);
  const r1 = validateProjectReply(proj, { catalogIds: catalog.map((c) => c.id), audioFiles: [] });
  ok(!r1.ok || r1.warnings.some((w) => w.path === 'scenes[0].scene.duration'), `замечание про duration: ${JSON.stringify(r1.warnings)}`);
  const scene = (proj as any).scenes[0].scene;
  ok(scene.duration > 1, `duration увеличен с 1 до ${scene.duration}`);
  ok(scene.duration === Math.ceil((estimateSpeechSec(longText) + 0.4) * 10) / 10, `duration = ceil((speech+0.4)*10)/10 = ${scene.duration}`);

  // 3) корректный проект не меняется
  const okProj = projectWithVoice('короткий текст', 10);
  const before = JSON.stringify(okProj);
  const r2 = validateProjectReply(okProj, { catalogIds: catalog.map((c) => c.id), audioFiles: [] });
  ok(!r2.warnings.some((w) => w.path === 'scenes[0].scene.duration'), `корректный проект: без замечания про duration`);
  ok(JSON.stringify(okProj) === before, `корректный проект не изменён`);

  // 4) voice.file от ИИ удаляется с замечанием
  const fileProj = projectWithVoice('короткий текст', 10, 'nonexistent.wav');
  const beforeFile = JSON.stringify(fileProj);
  const r3 = validateProjectReply(fileProj, { catalogIds: catalog.map((c) => c.id), audioFiles: [] });
  ok(((fileProj as any).scenes[0].voice as any).file === undefined, `voice.file удалён`);
  ok(r3.warnings.some((w) => w.path === 'scenes[0].voice.file'), `замечание про voice.file: ${JSON.stringify(r3.warnings)}`);

  // 5) промт содержит блок про voice.text и не превышает лимит
  const prompt = buildProjectPrompt({ idea: 'Что если бы киты летали над городом', scenes: 3, catalogIndex: catalog });
  ok(prompt.includes('voice.text'), `промт содержит voice.text`);
  ok(prompt.includes('0.4'), `промт содержит требование про 0.4 с запаса`);
  const bytes = Buffer.byteLength(prompt, 'utf8');
  ok(bytes <= PROJECT_PROMPT_MAX_BYTES, `промт ${bytes} байт <= ${PROJECT_PROMPT_MAX_BYTES}`);

  if (failures.length) { console.error(`check:ai-voice FAIL (${failures.length}): ${failures.join(' | ')}`); process.exitCode = 1; }
  else console.log('check:ai-voice PASS');
} catch (e) {
  console.error(`check:ai-voice FAIL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
}
