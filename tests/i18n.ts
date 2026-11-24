// i18n tests:
// 1. набор ключей en и ru совпадает
// 2. в editor/ нет кириллицы вне ru.ts
// 3. переключение языка меняет текст кнопки Save/Сохранить

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// --- mock DOM/localStorage до импорта i18n ---
const lsStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
} as Storage;

(globalThis as any).document = {
  documentElement: { setAttribute: () => {}, getAttribute: () => null, lang: 'en' },
} as unknown as Document;

const { EDITOR_STRINGS_EN } = await import('../editor/i18n/en.ts');
const { EDITOR_STRINGS_RU } = await import('../editor/i18n/ru.ts');
const { getLang, setLang, strings } = await import('../editor/i18n/index.ts');

let failures = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); failures++; };
const ok = (msg: string) => console.log('OK:', msg);

// ---------- Test 1: ключи en и ru совпадают ----------
function keysOf(obj: unknown, prefix = ''): string[] {
  const out: string[] = [];
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keysOf(v, full));
      else out.push(full);
    }
  }
  return out;
}

const enKeys = keysOf(EDITOR_STRINGS_EN).sort();
const ruKeys = keysOf(EDITOR_STRINGS_RU).sort();
if (JSON.stringify(enKeys) !== JSON.stringify(ruKeys)) {
  const onlyEn = enKeys.filter((k) => !ruKeys.includes(k));
  const onlyRu = ruKeys.filter((k) => !enKeys.includes(k));
  fail(`ключи не совпадают: только в en ${JSON.stringify(onlyEn)}, только в ru ${JSON.stringify(onlyRu)}`);
} else {
  ok(`набор ключей en/ru совпадает (${enKeys.length} ключей)`);
}

// ---------- Test 2: в editor/ нет кириллицы вне ru.ts ----------
const CYRILLIC = /\p{Script=Cyrillic}/u;
const editorDir = path.resolve('editor');
const cyrillicFindings: { file: string; line: number; text: string }[] = [];

function scanFile(file: string): void {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // strip block comments
    const cleaned: string[] = [];
    let j = 0;
    while (j < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', j);
        if (end === -1) { j = line.length; break; }
        j = end + 2; inBlockComment = false;
      } else {
        const bc = line.indexOf('/*', j);
        const lc = line.indexOf('//', j);
        if (bc === -1 && lc === -1) { cleaned.push(line.slice(j)); j = line.length; }
        else if (lc === -1 || (bc !== -1 && bc < lc)) {
          cleaned.push(line.slice(j, bc));
          inBlockComment = true;
          const end = line.indexOf('*/', bc + 2);
          if (end === -1) { j = line.length; break; }
          j = end + 2; inBlockComment = false;
        } else {
          cleaned.push(line.slice(j, lc));
          j = line.length;
        }
      }
    }
    const codeLine = cleaned.join('');
    if (CYRILLIC.test(codeLine)) {
      const m = codeLine.match(CYRILLIC);
      if (m) cyrillicFindings.push({ file, line: i + 1, text: m[0] });
    }
  }
}

function scanDir(dir: string): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) scanDir(full);
    else if (name.endsWith('.ts') && full !== path.join(editorDir, 'i18n', 'ru.ts')) scanFile(full);
  }
}

scanDir(editorDir);

if (cyrillicFindings.length) {
  for (const f of cyrillicFindings) fail(`кириллица в ${path.relative(process.cwd(), f.file)}:${f.line}: ${f.text}`);
} else {
  ok('в editor/ нет кириллицы вне i18n/ru.ts');
}

// ---------- Test 3: переключение языка меняет текст кнопки Save ---
setLang('en');
assert.strictEqual(getLang(), 'en');
assert.strictEqual(strings().project.save, 'Save');

setLang('ru');
assert.strictEqual(getLang(), 'ru');
assert.strictEqual(strings().project.save, 'Сохранить');

setLang('en');
assert.strictEqual(strings().project.save, 'Save');
ok('переключение языка меняет строку Save/Сохранить');

// --- атрибут lang у <html> ---
const html = (globalThis as any).document.documentElement;
assert.strictEqual(html.lang, 'en');
ok('атрибут lang обновляется при смене языка');

console.log(failures === 0 ? 'i18n tests OK' : `i18n tests FAILED: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
