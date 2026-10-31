// UI-smoke: сборка → http.server → headless Chrome. Вкладки, подвкладки сцен, каталог, экспорт.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.UI_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}/`;
const PROJECT_FILE = path.resolve('docs/examples/project-reply-example.json');

let errors = 0;
const fail = (msg) => { console.error('FAIL:', msg); errors++; };
const ok = (msg) => console.log('OK:', msg);

if (!fs.existsSync(path.resolve('dist/index.html'))) {
  console.error('FAIL: нет dist/index.html — сначала npm run build');
  process.exit(1);
}
if (!fs.existsSync(CHROME_PATH)) {
  console.error(`FAIL: Chrome не найден: ${CHROME_PATH} (задайте CHROME_PATH)`);
  process.exit(1);
}

const waitForServer = () => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const req = http.get(BASE, (res) => { res.resume(); resolve(); });
    req.on('error', () => {
      if (Date.now() - started > 15000) reject(new Error('http.server не поднялся'));
      else setTimeout(tick, 150);
    });
    req.setTimeout(1000, () => req.destroy());
  };
  tick();
});

const python = process.platform === 'win32' ? 'python' : 'python3';
const server = spawn(python, ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', 'dist'], { stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (chunk) => {
  const text = String(chunk);
  if (/Traceback|Address already in use/i.test(text)) console.error('http.server:', text.trim());
});

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-motion-smoke-'));
let browser;
const cleanup = async () => {
  try { await browser?.close(); } catch {}
  try { server.kill(); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
};

try {
  await waitForServer();
  ok(`http.server на ${BASE}`);

  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check', '--no-proxy-server'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location()?.url ?? '';
    const text = msg.text();
    if (/favicon\.ico/i.test(url) || /favicon\.ico/i.test(text)) return;
    consoleErrors.push(url ? `${text} (${url})` : text);
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#topTabs button', { timeout: 15000 });
  ok('страница открыта');

  const tabLabels = await page.$$eval('#topTabs button', (buttons) => buttons.map((b) => b.textContent));
  if (tabLabels.join('|') !== 'Проект|Сцены|Склейка|Каталог') fail(`вкладки: ${tabLabels.join('|')}`);

  // 1. Пример 3-сценного проекта
  const fileInput = await page.$('#openProject');
  if (!fileInput) fail('нет #openProject');
  else await fileInput.uploadFile(PROJECT_FILE);
  await page.waitForFunction(() => document.querySelectorAll('#sceneTabs .scene-tab').length === 3, { timeout: 10000 });
  const title = await page.$eval('#projectTitle', (el) => el.value);
  if (!title) fail('название проекта не загрузилось');
  else ok(`проект загружен: «${title}», сцен: 3`);

  // 2. Проект
  await page.click('#topTabs button[data-tab="project"]');
  if (!(await page.$eval('#panelProject', (el) => !el.hidden))) fail('вкладка «Проект» не открылась');
  for (const id of ['ideaText', 'ideaCopyPrompt', 'ideaResponse', 'ideaCreate', 'openProjectButton', 'saveProject', 'ideaSuggestions']) {
    if (!(await page.$(`#${id}`))) fail(`на вкладке «Проект» нет #${id}`);
  }
  ok('вкладка «Проект»: идея, импорт/экспорт, подсказки на месте');

  // 3. Сцены и все подвкладки
  await page.click('#topTabs button[data-tab="scenes"]');
  if (!(await page.$eval('#panelScenes', (el) => !el.hidden))) fail('вкладка «Сцены» не открылась');
  const sceneCount = await page.$$eval('#sceneTabs .scene-tab > button:first-child', (buttons) => buttons.length);
  if (sceneCount !== 3) fail(`подвкладок сцен: ${sceneCount}, ожидалось 3`);
  for (let index = 0; index < sceneCount; index++) {
    const buttons = await page.$$('#sceneTabs .scene-tab > button:first-child');
    await buttons[index].click();
    const active = await page.$$eval('#sceneTabs .scene-tab > button.on', (buttons) => buttons.map((b) => b.textContent));
    if (active.length !== 1) fail(`сцена ${index}: активных подвкладок ${active.length}`);
    const layers = await page.$$eval('#layerList .layer', (els) => els.length);
    if (layers === 0) fail(`сцена ${index}: список слоёв пуст`);
  }
  ok(`вкладка «Сцены»: пройдены ${sceneCount} подвкладки, слои отрисованы`);

  const objectButtons = await page.$$('#layerList .layer-object');
  if (objectButtons.length === 0) fail('в списке слоёв нет объектов');
  else {
    await objectButtons[0].click();
    const scope = await page.$eval('#jsonScope', (el) => el.value);
    const json = await page.$eval('#json', (el) => el.value.trim());
    if (scope !== 'object') fail(`после выбора объекта область JSON = ${scope}`);
    if (!json) fail('после выбора объекта JSON пуст');
    else ok('выбор объекта в списке слоёв открывает его параметры в JSON');
  }

  // 4. Склейка
  await page.click('#topTabs button[data-tab="splice"]');
  await page.waitForFunction(() => document.querySelectorAll('#sceneOrder .order-row').length === 3, { timeout: 10000 });
  const transitionSelects = await page.$$eval('#sceneOrder select', (els) => els.length);
  const durationInputs = await page.$$eval('#sceneOrder input[type="number"]', (els) => els.length);
  if (transitionSelects !== 2 || durationInputs !== 2) fail(`переходы: select ${transitionSelects}, duration ${durationInputs}, ожидалось 2/2`);
  const previewSize = await page.$eval('#projectPreview', (el) => ({ w: el.width, h: el.height }));
  if (!previewSize.w || !previewSize.h) fail('предпросмотр проекта не отрисован');
  const exportState = await page.$eval('#exportMp4', (el) => ({ disabled: el.disabled, text: el.textContent }));
  const exportHint = await page.$eval('#exportHint', (el) => el.textContent);
  if (!/MP4/.test(exportState.text ?? '')) fail('нет кнопки экспорта MP4');
  if (!exportState.disabled) fail('кнопка экспорта MP4 включена, хотя браузерный экспорт не реализован');
  if (!/npm run export/.test(exportHint ?? '')) fail('нет подсказки про npm run export');
  ok(`вкладка «Склейка»: ${transitionSelects} перехода, предпросмотр ${previewSize.w}×${previewSize.h}, экспорт — заглушка с командой`);

  // 5. Каталог: список, миниатюры, подвкладки
  await page.click('#topTabs button[data-tab="catalog"]');
  await page.waitForFunction(() => document.querySelectorAll('#catalogList img').length > 0, { timeout: 10000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#catalogList img')).every((img) => img.complete && img.naturalWidth > 0), { timeout: 10000 });

  const thumbs = await page.$$eval('#catalogList img', (imgs) => imgs.slice(0, 8).map((img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { avg: sum / (data.length / 4), spread: max - min };
  }));
  if (thumbs.length === 0) fail('в каталоге нет миниатюр');
  for (const [index, t] of thumbs.entries()) {
    if (!(t.avg > 60)) fail(`миниатюра ${index}: средняя яркость ${t.avg.toFixed(1)} <= 60 (чёрная?)`);
    if (!(t.spread > 20)) fail(`миниатюра ${index}: разброс цветов ${t.spread.toFixed(1)} <= 20`);
  }
  ok(`миниатюры: ${thumbs.length} шт., средняя яркость ${thumbs.map((t) => t.avg.toFixed(0)).join('/')}, разброс ${thumbs.map((t) => t.spread.toFixed(0)).join('/')}`);

  const listRight = await page.$eval('#catalogList', (el) => el.getBoundingClientRect().right);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (listRight > viewportWidth + 1) fail(`список каталога шире экрана: ${listRight} > ${viewportWidth}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`горизонтальная прокрутка страницы: +${overflow}px`);
  ok('список каталога не шире экрана');

  const catalogTabs = await page.$$('#catalogTabBar button');
  for (let index = 0; index < catalogTabs.length; index++) {
    const buttons = await page.$$('#catalogTabBar button');
    await buttons[index].click();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  ok(`подвкладки каталога: пройдено ${catalogTabs.length}`);

  // 6. Узкое окно: вкладки прокручиваются, раскладка не ломается
  await page.click('#topTabs button[data-tab="catalog"]');
  await page.setViewport({ width: 280, height: 700 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const narrow = await page.evaluate(() => {
    const tabs = document.getElementById('topTabs');
    const offenders = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > window.innerWidth + 1)
      .slice(0, 5)
      .map(({ el, rect }) => `${el.tagName.toLowerCase()}#${el.id || ''}.${el.className || ''} right=${Math.round(rect.right)}`);
    return {
      scroll: tabs ? tabs.scrollWidth > tabs.clientWidth : false,
      overflowX: tabs ? getComputedStyle(tabs).overflowX : '',
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      offenders,
    };
  });
  if (!narrow.scroll) fail('на узком окне вкладки не прокручиваются (scrollWidth <= clientWidth)');
  if (narrow.overflowX !== 'auto') fail(`у вкладок overflow-x = ${narrow.overflowX}`);
  if (narrow.pageOverflow > 1) fail(`на узком окне страница шире экрана: +${narrow.pageOverflow}px; ${narrow.offenders.join(' | ')}`);
  ok('узкое окно 280px: вкладки прокручиваются, страница без горизонтального overflow');

  // 7. sessionStorage: вкладка переживает перезагрузку
  await page.setViewport({ width: 1280, height: 900 });
  await page.click('#topTabs button[data-tab="splice"]');
  const stored = await page.evaluate(() => ({
    tab: sessionStorage.getItem('animation-motion/tab/v1'),
    scene: sessionStorage.getItem('animation-motion/scene-tab/v1'),
  }));
  if (stored.tab !== 'splice') fail(`в sessionStorage вкладка = ${stored.tab}`);
  if (stored.scene === null) fail('в sessionStorage нет подвкладки сцены');
  await page.evaluate(() => localStorage.removeItem('animation-motion/autosave/v1'));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#topTabs button.on', { timeout: 15000 });
  const restored = await page.$$eval('#topTabs button.on', (buttons) => buttons.map((b) => b.textContent));
  if (restored.length !== 1 || restored[0] !== 'Склейка') fail(`после перезагрузки вкладка: ${restored.join(',')}`);
  else ok('sessionStorage: вкладка «Склейка» восстановлена после перезагрузки');

  if (consoleErrors.length) fail(`ошибки консоли: ${consoleErrors.join(' || ')}`);
  else ok('ошибок консоли нет');
} catch (error) {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await cleanup();
}

console.log(errors === 0 ? 'check:ui OK' : `check:ui FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
