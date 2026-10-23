import { execSync, spawn } from 'child_process';
import http from 'http';

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4173;
const URL = `http://localhost:${PORT}/?selftest`;

function log(m: string) { process.stdout.write(m + '\n'); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(URL, (res) => { res.resume(); if (res.statusCode === 200) resolve(res); else reject(new Error(String(res.statusCode))); });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch { await sleep(250); }
  }
  return false;
}

async function main() {
  log('build');
  execSync('npm.cmd run build', { stdio: 'inherit' });
  log('build done');
  const preview = spawn('cmd', ['/c', 'npm.cmd', 'run', 'preview', '--', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  log('preview spawned');
  if (!(await waitForServer())) {
    log('preview NOT up');
    preview.kill();
    process.exit(1);
  }
  log('server up');
  const chromeOut = await new Promise<string>((resolve) => {
    const chrome = spawn(CHROME_PATH, ['--headless=new', '--disable-gpu', '--dump-dom', URL], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    chrome.stdout.on('data', (d) => { out += d; });
    chrome.stderr.on('data', (d) => { out += d; });
    chrome.on('close', () => resolve(out));
    setTimeout(() => { try { chrome.kill(); } catch {} resolve(out); }, 20000);
  });
  log('chrome done');
  if (chromeOut.includes('SELFTEST: PASS')) {
    log('SELFTEST: PASS');
    process.exit(0);
  } else {
    log('SELFTEST: FAIL');
    log(chromeOut.slice(0, 2000));
    process.exit(1);
  }
}

main().catch((e) => { log('ERROR ' + String(e)); process.exit(1); });
