import { spawn } from 'child_process';
import http from 'http';
import { spawnPreview, waitForServer, launchSafeChrome, assertPortFree } from './browser.ts';

const PORT = 4173;
const URL = `http://localhost:${PORT}/?selftest`;

function log(m: string) { process.stdout.write(m + '\n'); }

async function main() {
  const { execSync } = await import('child_process');
  log('build');
  execSync('npm.cmd run build', { stdio: 'inherit' });
  log('build done');

  await assertPortFree(PORT);
  const preview = spawnPreview(PORT);
  log('preview spawned');
  if (!(await waitForServer(PORT, URL))) {
    log('preview NOT up');
    preview.cleanup();
    process.exit(1);
  }
  log('server up');

  const chromeHandle = await launchSafeChrome(['--dump-dom', URL]);
  let chromeOut = '';
  chromeHandle.browser.pages().then((pages) => {
    // страница уже открыта через аргумент --dump-dom; ждём вывода через stdout ниже
  });
  // puppeteer с --dump-dom выводит DOM в stdout браузера — перехватываем через страницу проще:
  const page = await chromeHandle.browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const content = await page.content();
  await chromeHandle.cleanup();

  if (content.includes('SELFTEST: PASS')) {
    log('SELFTEST: PASS');
    process.exit(0);
  } else {
    log('SELFTEST: FAIL');
    log(content.slice(0, 2000));
    process.exit(1);
  }
}

main().catch((e) => { log('ERROR ' + String(e)); process.exit(1); });
