// Адаптер Windows SAPI: System.Speech через Windows PowerShell. Работает только на Windows, голоса — системные.
// Ни текст, ни имя голоса не попадают в командную строку: текст пишется в UTF-8 во временный файл, скрипт читает его сам.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess, tail } from './process.ts';
import type { TtsAdapter, TtsDetectResult, TtsOptions } from './types.ts';

const LANG_ADJECTIVE: Record<string, string> = { ru: 'русского', uk: 'украинского', en: 'английского' };
const SETTINGS_HINT = 'Параметры → Время и язык → Речь';

const adjective = (lang: string) => LANG_ADJECTIVE[lang] ?? `языка «${lang}»`;

export interface SapiVoice {
  culture: string;
  name: string;
}

const DEFAULT_LANG = 'ru';
const langOf = (opts: TtsOptions) => (opts.lang ?? DEFAULT_LANG).trim() || DEFAULT_LANG;

// Скрипты powershell пишутся во временный файл и удаляются: так в аргументы не попадает пользовательский текст.
async function runScript(body: string, args: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-tts-sapi-'));
  const script = path.join(dir, 'run.ps1');
  try {
    fs.writeFileSync(script, `${body}\n`, 'utf8');
    return await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function listVoices(): Promise<SapiVoice[]> {
  const result = await runScript([
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'foreach ($v in $s.GetInstalledVoices()) { if ($v.Enabled) { Write-Output ($v.VoiceInfo.Culture.Name + "|" + $v.VoiceInfo.Name) } }',
    '$s.Dispose()',
  ].join('\n'), []);
  if (result.code !== 0) throw new Error(`powershell не перечислил голоса (код ${result.code}): ${tail(result.stderr)}`);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
    .map((line) => ({ culture: line.slice(0, line.indexOf('|')), name: line.slice(line.indexOf('|') + 1) }));
}

// Культура голоса сравнивается по префиксу: 'ru' подходит к 'ru-RU'.
function pickVoice(voices: SapiVoice[], lang: string): SapiVoice | undefined {
  return voices.find((voice) => voice.culture.toLowerCase().startsWith(lang.toLowerCase()));
}

const NOT_WINDOWS = 'SAPI — голос Windows, на этой системе недоступен';

/** Почему SAPI годится или нет — чистая функция: проверке не нужен реальный вызов powershell. */
export function sapiStatus(voices: SapiVoice[], platform: string, lang: string): TtsDetectResult {
  if (platform !== 'win32') return { ok: false, reason: NOT_WINDOWS };
  if (voices.length === 0) return { ok: false, reason: `в Windows не найдено ни одного голоса: ${SETTINGS_HINT}` };
  if (!pickVoice(voices, lang)) return { ok: false, reason: `в Windows нет ${adjective(lang)} голоса: ${SETTINGS_HINT}` };
  return { ok: true };
}

async function detect(): Promise<TtsDetectResult> {
  if (process.platform !== 'win32') return { ok: false, reason: NOT_WINDOWS };
  try {
    return sapiStatus(await listVoices(), process.platform, DEFAULT_LANG);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function resolveVoice(opts: TtsOptions): Promise<SapiVoice> {
  const voice = pickVoice(await listVoices(), langOf(opts));
  if (!voice) throw new Error(`в Windows нет ${adjective(langOf(opts))} голоса: ${SETTINGS_HINT}`);
  return voice;
}

async function synthesize(text: string, outWav: string, opts: TtsOptions = {}): Promise<void> {
  // голос выбираем на нашей стороне: причина «нет русского голоса» тогда одна и та же и в detect, и в синтезе
  const voice = (await resolveVoice(opts)).name;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-tts-sapi-'));
  const inFile = path.join(dir, 'text.txt');
  try {
    fs.writeFileSync(inFile, text, 'utf8');
    fs.mkdirSync(path.dirname(outWav), { recursive: true });
    const result = await runScript([
      'param([string]$InPath, [string]$OutPath, [string]$VoiceName)',
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Speech',
      '$text = [System.IO.File]::ReadAllText($InPath, [System.Text.Encoding]::UTF8)',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$s.SelectVoice($VoiceName)',
      '$s.SetOutputToWaveFile($OutPath)',
      '$s.Speak($text)',
      '$s.Dispose()',
    ].join('\n'), [inFile, outWav, voice]);
    if (result.code !== 0 || !fs.existsSync(outWav)) {
      throw new Error(`Windows SAPI не собрал звук (код ${result.code}): ${tail(result.stderr) || 'вывод powershell пуст'}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const sapiAdapter: TtsAdapter = {
  id: 'sapi',
  label: 'Голос Windows (SAPI)',
  detect,
  voiceId: async (opts = {}) => {
    try {
      return (await resolveVoice(opts)).name;
    } catch {
      return '';
    }
  },
  synthesize,
};
