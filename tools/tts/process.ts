// Запуск внешних команд для адаптеров TTS: общий сбор stderr, чтобы ошибки были полными и на русском.
import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Текст для stdin в UTF-8. */
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}

/** Ненулевой код возврата не считается ошибкой — решает вызывающий. Команда, которую не удалось запустить, даёт code=-1. */
export function runProcess(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: opts.env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: `${stderr}${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin?.on('error', () => { /* команда могла не читать stdin — дождёмся close */ });
    child.stdin?.end(opts.stdin ?? '');
  });
}

/** Хвост вывода команды в сообщение: весь лог пачкает отчёт, последняя строка обычно и есть причина. */
export function tail(text: string, max = 400): string {
  const clean = text.trim();
  return clean.length > max ? `…${clean.slice(-max)}` : clean;
}
