// Мини-сцена 1 с выводится в MP4 в обоих форматах и проходит приёмку verify-export.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'out', 'verify-export');
const FPS = 30;
const DURATION = 1;

const scene = {
  version: 1,
  title: 'Проверка экспорта',
  duration: DURATION,
  palette: { sky: ['#101820', '#283848'], sun: '#ffd27a' },
  camera: { keys: [] },
  assets: {},
  layers: [{
    id: 'check', name: 'Проверка', depth: 1, visible: true,
    objects: [
      { id: 'sky', name: 'Небо', kind: 'sky', params: {} },
      { id: 'label', name: 'Титр', kind: 'text', params: { text: 'Экспорт 1 с', size: 72, color: '#ffffff' } },
    ],
  }],
};

function run(script: string, args: string[]): boolean {
  return spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { cwd: root, stdio: 'inherit' }).status === 0;
}

fs.mkdirSync(dir, { recursive: true });
const sceneFile = path.join(dir, 'mini.scene.json');
fs.writeFileSync(sceneFile, JSON.stringify(scene, null, 2), 'utf8');

let failures = 0;
for (const [format, width, height] of [['h', 1920, 1080], ['v', 1080, 1920]] as const) {
  const file = path.join(dir, `mini-${format}.mp4`);
  console.log(`--- мини-сцена ${DURATION} с, формат ${format} (${width}x${height}) ---`);
  if (!run('export.ts', [sceneFile, '--format', format, '--fps', String(FPS), '--out', file, '--overwrite'])) { failures++; continue; }
  if (!run('verify-export.ts', [file, String(width), String(height), String(FPS), String(DURATION)])) failures++;
}

console.log(failures ? `check:export FAIL (${failures})` : 'check:export PASS');
process.exit(failures ? 1 : 0);