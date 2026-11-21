// ЛИНТ проекта: validateProject + lintProject. Только сообщает, не правит.
// node tools/lint-project.ts <файл.json> [--json] [--strict]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProject, type ProjectV1 } from '../engine/project.ts';
import { lintProject } from '../engine/lint.ts';
import { listAudioFiles } from './audio-files.ts';
import { readCatalogIds } from './catalog-ids.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioDir = path.join(root, 'audio');

function printIssue(issue: { level: string; code: string; path: string; message: string }): void {
  console.log(`[${issue.level}] ${issue.code} ${issue.path}: ${issue.message}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const strict = args.includes('--strict');
  const fileArg = args.find((a) => !a.startsWith('--'));
  if (!fileArg) {
    console.error('использование: node tools/lint-project.ts <файл.json> [--json] [--strict]');
    process.exitCode = 1;
    return;
  }
  const file = path.resolve(root, fileArg);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`не удалось прочитать проект: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  const catalogIds = readCatalogIds(path.join(root, 'catalog'));
  const validation = validateProject(raw, { catalogIds });
  if (!validation.ok) {
    if (jsonFlag) {
      console.log(JSON.stringify({ ok: false, issues: validation.errors.map((e) => ({ level: 'error' as const, code: 'schema', path: e.path, message: e.message })) }, null, 2));
    } else {
      for (const e of validation.errors) console.log(`[error] schema ${e.path}: ${e.message}`);
      console.log(`lint: проект не прошёл проверку схемы: ${validation.errors.length} ошибок`);
    }
    process.exitCode = 1;
    return;
  }

  const project = raw as ProjectV1;
  const audioFiles = listAudioFiles(audioDir);
  const lint = lintProject(project, { audioFiles });
  const issues = lint.issues;

  if (jsonFlag) {
    console.log(JSON.stringify({ ok: lint.ok, issues }, null, 2));
  } else {
    for (const issue of issues) printIssue(issue);
    const warnCount = issues.filter((i) => i.level === 'warn').length;
    const infoCount = issues.filter((i) => i.level === 'info').length;
    console.log(`lint: ${warnCount} warn, ${infoCount} info`);
  }

  if (!lint.ok && strict) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`lint:project FAIL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
});
