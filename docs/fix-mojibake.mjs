// Чинит типичную порчу кириллицы: UTF-8 текст, прочитанный как windows-1251 и сохранённый снова как UTF-8.
// Запуск из корня репозитория:
//   node tools/fix-mojibake.mjs            (только отчёт, файлы не меняет)
//   node tools/fix-mojibake.mjs --write    (исправляет файлы, перед этим закоммить текущее состояние!)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const EXT = /\.(ts|tsx|js|mjs|json|md|html|css|bat|txt)$/i;

// байт windows-1251 -> символ, и обратно
const dec = new TextDecoder('windows-1251');
const rev = new Map();
for (let b = 0; b < 256; b++) {
  const ch = dec.decode(Uint8Array.of(b));
  if (!rev.has(ch)) rev.set(ch, b);
}
const utf8 = new TextDecoder('utf-8', { fatal: true });
const BAD = /(?:[РС][^\s\p{L}]|[РС][Ѐ-ӿ]){3,}|(?:Р[ -¿‘-›Ѐ-Џђ-џ]|С[ -¿‘-›Ѐ-Џђ-џ]){3,}/u;
const CYR = /[А-яЁё]/;

function looksBroken(s) {
  return BAD.test(s) || s.includes('�');
}

// пробуем обратное преобразование для одной строки
function fixLine(line) {
  let cur = line;
  for (let pass = 0; pass < 2; pass++) {
    if (!BAD.test(cur)) break;
    const bytes = [];
    let ok = true;
    for (const ch of cur) {
      const b = rev.get(ch);
      if (b === undefined) {
        // символ не из windows-1251 (например, обычная латиница тоже в таблице, а эмодзи нет)
        const code = ch.codePointAt(0);
        if (code < 0x80) bytes.push(code);
        else { ok = false; break; }
      } else bytes.push(b);
    }
    if (!ok) return { line: cur, fixed: pass > 0, partial: true };
    try {
      const next = utf8.decode(Uint8Array.from(bytes));
      if (!CYR.test(next) && !/^[\x00-\x7F]*$/.test(next)) return { line: cur, fixed: pass > 0, partial: true };
      cur = next;
    } catch {
      return { line: cur, fixed: pass > 0, partial: true };
    }
  }
  return { line: cur, fixed: cur !== line, partial: BAD.test(cur) };
}

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(f => f && EXT.test(f));

let totalFixed = 0, totalLeft = 0;
const report = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (!looksBroken(text)) continue;
  const lines = text.split('\n');
  let fixed = 0, left = 0;
  const out = lines.map((ln, i) => {
    if (!looksBroken(ln)) return ln;
    const r = fixLine(ln.replace(/\r$/, ''));
    const eol = ln.endsWith('\r') ? '\r' : '';
    if (r.fixed && !r.partial) { fixed++; return r.line + eol; }
    left++;
    report.push(`  не удалось: ${f}:${i + 1}: ${ln.slice(0, 90)}`);
    return ln;
  });
  totalFixed += fixed; totalLeft += left;
  console.log(`${f}: исправимо ${fixed}, вручную ${left}`);
  if (WRITE && fixed) writeFileSync(f, out.join('\n'), 'utf8');
}
console.log(report.join('\n'));
console.log(`\nИтого: исправлено ${WRITE ? '' : '(можно) '}${totalFixed} строк, вручную осталось ${totalLeft}.${WRITE ? '' : ' Файлы не менялись (запусти с --write).'}`);
