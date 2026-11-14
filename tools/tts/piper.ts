// Адаптер Piper: вызываем внешний процесс, ничего не вшиваем и не скачиваем.
// Настройки (не секреты) берутся из .env.local или окружения: PIPER_CMD — команда запуска, PIPER_MODEL — путь к .onnx голоса.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSetting } from '../env-local.ts';
import { runProcess, tail } from './process.ts';
import type { TtsAdapter, TtsDetectResult, TtsOptions } from './types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Команда запуска: «piper» по умолчанию либо что угодно вида «python -m piper». */
export function piperCommand(): string[] {
  return (loadSetting(root, 'PIPER_CMD') || 'piper').split(/\s+/).filter(Boolean);
}

export function piperModel(): string {
  return loadSetting(root, 'PIPER_MODEL');
}

const INSTALL_HINT = 'установите piper-tts (pip install piper-tts) и укажите PIPER_MODEL в .env.local; подробности — docs/TTS.md';

/** Почему Piper годится или нет — отдельная чистая функция: проверкам не нужны настройки конкретной машины. */
export function piperStatus(cmd: string[], helpOk: boolean, helpTail: string, model: string, modelExists: boolean): TtsDetectResult {
  if (cmd.length === 0) return { ok: false, reason: `PIPER_CMD пустой; ${INSTALL_HINT}` };
  if (!helpOk) return { ok: false, reason: `команда «${cmd.join(' ')}» не запускается: ${helpTail || INSTALL_HINT}` };
  if (!model) return { ok: false, reason: `не задан PIPER_MODEL — путь к файлу голоса .onnx; ${INSTALL_HINT}` };
  if (!modelExists) return { ok: false, reason: `нет файла модели Piper: ${model}` };
  return { ok: true };
}

async function detect(): Promise<TtsDetectResult> {
  const cmd = piperCommand();
  const help = cmd.length === 0 ? { code: -1, stdout: '', stderr: '' } : await runProcess(cmd[0], [...cmd.slice(1), '--help']);
  const model = piperModel();
  return piperStatus(cmd, help.code === 0, tail(help.stderr), model, model !== '' && fs.existsSync(model));
}

// Текст уходит в stdin, а не в аргументы командной строки: пайп — единственный способ передать кириллицу без экранирования.
// PYTHONUTF8/PYTHONIOENCODING обязательны: на Windows sys.stdin по умолчанию читается локальной кодовой страницей, а не UTF-8.
async function synthesize(text: string, outWav: string, _opts: TtsOptions = {}): Promise<void> {
  const model = piperModel();
  if (!model) throw new Error(`Piper: не задан PIPER_MODEL; ${INSTALL_HINT}`);
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  const cmd = piperCommand();
  const result = await runProcess(cmd[0], [...cmd.slice(1), '--model', model, '--output-file', outWav], {
    stdin: `${text}\n`,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  if (result.code !== 0 || !fs.existsSync(outWav)) {
    throw new Error(`Piper не собрал звук (код ${result.code}): ${tail(result.stderr) || 'вывод команды пуст'}`);
  }
}

export const piperAdapter: TtsAdapter = {
  id: 'piper',
  label: 'Piper (локальная нейросеть, внешний процесс)',
  detect,
  voiceId: async () => (piperModel() ? path.basename(piperModel()) : ''),
  synthesize,
};
