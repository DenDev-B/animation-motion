// Защита от поломок, которые сборка пропускает: редактор без скрипта и ручной список моделей каталога.
import fs from 'node:fs';
import path from 'node:path';

let errors = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); errors++; };
const html = fs.readFileSync('index.html', 'utf8');
if (!/<script[^>]*type="module"[^>]*src="\/editor\/main\.ts"/.test(html)) fail('в index.html нет <script type="module" src="/editor/main.ts">: редактор не запустится');
const main = fs.readFileSync('editor/main.ts', 'utf8');
if (!main.includes("import.meta.glob('../catalog/*.json'")) fail('каталог редактора должен собираться через import.meta.glob(\'../catalog/*.json\')');
if (/catalog\s*=\s*\{\s*whale/.test(main)) fail('в editor/main.ts вернулся ручной список моделей каталога');
const tabIds = ['topTabs', 'panelProject', 'panelScenes', 'panelSplice', 'panelCatalog', 'sceneTabs', 'layerList', 'sceneOrder', 'voicePanel', 'projectPreview', 'exportMp4', 'exportMode', 'exportFrom', 'exportTo', 'exportFrameAt', 'exportScale', 'sceneLookPanel', 'lookStyle', 'lookMood', 'lookShot', 'lookShotT0', 'lookShotDur', 'lookShotStrength', 'lookApplyStyle', 'lookApplyStyleAll', 'lookApplyShot', 'lookRemoveShot', 'ideaAutoExport', 'ideaSaveAll', 'ideaSaveAllStatus', 'ideaSaveAllErrors'];
const missingTabs = tabIds.filter((id) => !html.includes(`id="${id}"`));
if (missingTabs.length) fail(`в index.html нет контейнеров вкладок: ${missingTabs.join(', ')}`);
const strings = fs.readFileSync('editor/strings.ts', 'utf8');
for (const label of ['Проект', 'Сцены', 'Склейка', 'Каталог']) {
  if (!strings.includes(`'${label}'`)) fail(`в editor/strings.ts нет подписи вкладки «${label}»`);
}
if (!main.includes('EDITOR_STRINGS.topTabs')) fail('подписи вкладок должны приходить из editor/strings.ts (EDITOR_STRINGS.topTabs)');
if (/const TOP_TABS[^=]*=\s*\[\s*\['project'/.test(main)) fail('в editor/main.ts вернулся ручной список подписей вкладок: он живёт в editor/strings.ts');
if (!main.includes('EDITOR_STRINGS.export.hint')) fail('подсказка под панелью экспорта должна приходить из editor/strings.ts (EDITOR_STRINGS.export.hint)');
if (!main.includes('EDITOR_STRINGS.voice')) fail('подписи панели озвучки должны приходить из editor/strings.ts (EDITOR_STRINGS.voice)');
for (const label of ['Озвучка', 'Озвучить', 'Убрать звук', 'Музыка проекта', 'Приглушать под голосом', 'Сдвиг, с', 'Громкость']) {
  if (!strings.includes(`'${label}'`)) fail(`в editor/strings.ts нет подписи панели озвучки «${label}»`);
}
if (!html.includes('id="voicePanel"')) fail('в index.html нет контейнера #voicePanel: панель музыки некуда рисовать');
if (!main.includes('EDITOR_STRINGS.subtitles')) fail('подписи панели субтитров должны приходить из editor/strings.ts (EDITOR_STRINGS.subtitles)');
for (const label of ['Субтитры', 'Показывать субтитры', 'Слов в реплике', 'Заглавными', 'сцены без таймингов']) {
  if (!strings.includes(label)) fail(`в editor/strings.ts нет подписи панели субтитров «${label}»`);
}
/** Кириллицу в литералах editor/*.ts проверяет отдельный check:strings — здесь второго счётчика нет. */
console.log('кириллицу в редакторе проверяет check:strings');
const ids = [...main.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
if (missing.length) fail(`в index.html нет элементов, которые ищет editor/main.ts: ${missing.join(', ')}`);
const assets = path.resolve('dist/assets');
if (fs.existsSync(assets) && !fs.readdirSync(assets).some((f) => f.endsWith('.js'))) fail('в dist/assets нет JavaScript: сборка редактора пустая');
console.log(errors === 0 ? 'check:editor-html OK' : `check:editor-html FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
