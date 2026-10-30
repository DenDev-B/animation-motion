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
const ids = [...main.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
if (missing.length) fail(`в index.html нет элементов, которые ищет editor/main.ts: ${missing.join(', ')}`);
const assets = path.resolve('dist/assets');
if (fs.existsSync(assets) && !fs.readdirSync(assets).some((f) => f.endsWith('.js'))) fail('в dist/assets нет JavaScript: сборка редактора пустая');
console.log(errors === 0 ? 'check:editor-html OK' : `check:editor-html FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
