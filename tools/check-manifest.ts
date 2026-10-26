import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = 'assets-src/manifest.example.json';
if (!fs.existsSync(manifest)) { console.error('assets-src/manifest.example.json не найден'); process.exit(1); }
const manifestDir = path.resolve(path.dirname(manifest));
const records = JSON.parse(fs.readFileSync(manifest, 'utf8'));
const missing = records.filter((r: any) => !r.file || !fs.existsSync(path.resolve(manifestDir, r.file)));

let out: string;
try {
  out = execSync(`node tools/catalog-import-manifest.ts ${manifest} --dry`, { encoding: 'utf8', cwd: root, maxBuffer: 10 * 1024 * 1024 }).toString();
} catch (e) {
  const stdout = (e as any) && (e as any).stdout ? (e as any).stdout.toString() : '';
  console.error('Манифест-утилита упала:', (e as Error).message, '\nВЫВОД:\n' + stdout);
  process.exit(1);
}

let skipped = 0;
for (const line of out.split('\n')) {
  if (line.includes('пропущено: нет файла')) skipped++;
}

if (skipped !== missing.length) {
  console.error(`Ожидалось ${missing.length} пропусков (отсутствующие файлы), найдено ${skipped}`);
  process.exit(1);
}
console.log(`check:manifest OK (${skipped} записей с отсутствующим файлом пропущены, ошибка одной записи не останавливает манифест)`);
