// Защита ключей: .env.local не отслеживается и игнорируется git, а в отслеживаемых файлах нет похожих на ключи Gemini и Groq строк.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures: string[] = [];
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let tracked: string[];
try {
  tracked = git('ls-files', '-z').split('\0').filter(Boolean);
} catch {
  console.log('check:secrets SKIP (нет git-репозитория)');
  process.exit(0);
}

const envTracked = tracked.filter((file) => /(^|\/)\.env/.test(file) && !/(^|\/)\.env\.example$/.test(file));
if (envTracked.length) failures.push(`в git отслеживаются файлы с ключами: ${envTracked.join(', ')}`);

for (const name of ['.env.local', '.env', '.env.production', '.env.local.bak']) {
  try {
    git('check-ignore', '-q', name);
  } catch {
    failures.push(`${name} не игнорируется git (проверьте .gitignore)`);
  }
}

// Gemini: AIza + 35 символов; Groq: gsk_ + 20+ символов. В образце ключи пустые.
const PATTERNS: Array<[string, RegExp]> = [['ключ Gemini', /AIza[0-9A-Za-z_-]{35}/], ['ключ Groq', /gsk_[0-9A-Za-z]{20,}/]];
for (const file of tracked) {
  const full = path.join(root, file);
  let text: string;
  try {
    if (fs.statSync(full).size > 2 * 1024 * 1024) continue;
    text = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  for (const [label, re] of PATTERNS) if (re.test(text)) failures.push(`${file}: похоже на ${label}`);
}
const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
if (/^(GEMINI|GROQ)_API_KEY=\S/m.test(example)) failures.push('.env.example содержит значение ключа');

if (failures.length) { console.error(`check:secrets FAIL\n${failures.map((f) => ' - ' + f).join('\n')}`); process.exit(1); }
console.log(`check:secrets PASS (${tracked.length} файлов, .env.local игнорируется и не отслеживается)`);
