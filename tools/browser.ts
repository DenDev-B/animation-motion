import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer-core';
import http from 'http';

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export interface ChromeHandle {
  browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  cleanup: () => Promise<void>;
}

/** Запускает Chrome со своим временным профилем, чтобы не задеть обычный Chrome владельца. */
export async function launchSafeChrome(extraArgs: string[] = []): Promise<ChromeHandle> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-motion-chrome-'));
  const args = [
    '--disable-gpu',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--allow-file-access-from-files',
    ...extraArgs,
  ];
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new' as any,
    userDataDir,
    args,
  });
  return {
    browser,
    cleanup: async () => {
      try { await browser.close(); } catch {}
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    },
  };
}

export interface PreviewHandle {
  proc: ReturnType<typeof spawn>;
  cleanup: () => void;
}

/** Запускает vite preview на порту. Если порт уже занят чьим-то сервером — ошибка, не убиваем чужое. */
export function spawnPreview(port: number): PreviewHandle {
  const proc = spawn('cmd', ['/c', 'npm.cmd', 'run', 'preview', '--', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    proc,
    cleanup: () => { try { proc.kill(); } catch {} },
  };
}

export async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/`, (res) => { res.resume(); reject(new Error(`порт ${port} занят чьим-то сервером (ответ ${res.statusCode})`)); });
    req.on('error', () => resolve()); // соединение refusé — порт свободен
    req.setTimeout(1000, () => { req.destroy(); resolve(); });
  });
}

export async function waitForServer(port: number, url: string, retries = 40): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => { res.resume(); if (res.statusCode === 200) resolve(res); else reject(new Error(String(res.statusCode))); });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return false;
}
