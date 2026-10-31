import fs from 'node:fs';
import path from 'node:path';
import { validateBrief } from '../engine/ai-brief.ts';

const args = process.argv.slice(2);
const file = args.find((value) => !value.startsWith('--'));
if (!file) throw new Error('Использование: npm run ai:brief-check -- <файл с ответом ИИ> [--scenes 5]');
const index = args.indexOf('--scenes');
const scenes = index < 0 ? undefined : Number(args[index + 1]);
if (scenes !== undefined && (!Number.isInteger(scenes) || scenes < 2 || scenes > 12)) throw new Error('--scenes должен быть целым числом от 2 до 12');
const text = fs.readFileSync(path.resolve(file), 'utf8');
const result = validateBrief(text, { scenes });
if (result.errors.length) {
  console.error('ОШИБКИ:');
  for (const issue of result.errors) console.error(`- ${issue.path || '(ТЗ)'}: ${issue.message}`);
} else console.log('ОШИБОК НЕТ');
if (result.warnings.length) {
  console.warn('ПРЕДУПРЕЖДЕНИЯ:');
  for (const issue of result.warnings) console.warn(`- ${issue.path || '(ТЗ)'}: ${issue.message}`);
} else console.log('ПРЕДУПРЕЖДЕНИЙ НЕТ');
process.exit(result.ok ? 0 : 1);
