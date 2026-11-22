// Генератор звуковых эффектов: чистый Node, без новых зависимостей, без Math.random.
// Пишет WAV 16-bit 44100 Гц mono в audio/sfx/. Одинаковый запуск — побайтно одинаковые файлы.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_RATE = 44100;
const MAX_16BIT = 32767;
// Пик не выше −3 dBFS ≈ 0.707 линейно.
const PEAK_LIMIT = 0.707;
const FADE = 0.01; // короткое затухание на краях, чтобы не было щелчков

const SFX_SET: { name: string; duration: number }[] = [
  { name: 'click', duration: 0.1 },
  { name: 'pop', duration: 0.15 },
  { name: 'ding', duration: 0.6 },
  { name: 'hit', duration: 0.3 },
  { name: 'whoosh', duration: 0.8 },
  { name: 'rise', duration: 1.2 },
];

// Детерминированный генератор шума с seed (xorshift32).
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function writeWav(file: string, samples: Float32Array): number {
  const pcm = new Int16Array(samples.length);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    const s = Math.round(v * MAX_16BIT);
    pcm[i] = s;
    if (Math.abs(s) > peak) peak = Math.abs(s);
  }
  if (peak / MAX_16BIT > PEAK_LIMIT + 1e-6) throw new Error(`пик эффекта превышает −3 dBFS: ${(peak / MAX_16BIT).toFixed(3)}`);

  const byteRate = SAMPLE_RATE * 2;
  const dataSize = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buffer.writeInt16LE(pcm[i], 44 + i * 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return peak / MAX_16BIT;
}

function envelope(len: number): Float32Array {
  const out = new Float32Array(len);
  const fadeSamples = Math.round(FADE * SAMPLE_RATE);
  for (let i = 0; i < len; i++) {
    let e = 1;
    if (i < fadeSamples) e = i / fadeSamples;
    else if (i > len - fadeSamples) e = (len - i) / fadeSamples;
    out[i] = e;
  }
  return out;
}

function osc(type: string, freq: number, t: number, phase = 0): number {
  const x = (t * freq + phase) % 1;
  switch (type) {
    case 'sine': return Math.sin(2 * Math.PI * x);
    case 'square': return x < 0.5 ? 1 : -1;
    case 'saw': return 2 * x - 1;
    case 'triangle': return 2 * Math.abs(2 * (x + 0.25) % 1 - 1) - 1;
    default: return Math.sin(2 * Math.PI * x);
  }
}

function generate(name: string, durationSec: number, rng: () => number): Float32Array {
  const len = Math.round(durationSec * SAMPLE_RATE);
  const out = new Float32Array(len);
  const env = envelope(len);

  switch (name) {
    case 'click': {
      // короткий щелчок: широкий импульс шума + типичный щелчок
      for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const e = env[i];
        const body = (rng() * 2 - 1) * Math.exp(-t * 40);
        out[i] = body * e * 0.8;
      }
      break;
    }
    case 'pop': {
      // поп: быстрая 상승ная обертка + синус
      for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const e = env[i];
        const f = 150 + 900 * (1 - Math.exp(-t * 20));
        out[i] = Math.sin(2 * Math.PI * f * t) * e * 0.7;
      }
      break;
    }
    case 'ding': {
      // звонкий звук: два близких тона, затухающие
      const f1 = 880;
      const f2 = 1320;
      for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const e = env[i] * Math.exp(-t * 2.5);
        out[i] = (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)) * 0.35 * e;
      }
      break;
    }
    case 'hit': {
      // удар: низкий импульс + шум
      for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const e = env[i] * Math.exp(-t * 8);
        const tone = Math.sin(2 * Math.PI * 120 * t) * Math.exp(-t * 6);
        const noise = (rng() * 2 - 1) * Math.exp(-t * 30);
        out[i] = (tone * 0.6 + noise * 0.4) * e * 0.65;
      }
      break;
    }
    case 'whoosh': {
      // вихрь: фильтрованный шум с меняющейся частотой
      for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const e = env[i];
        const f = 300 + 2000 * Math.sin(t * 2);
        const phase = 2 * Math.PI * f * t;
        const noise = (rng() * 2 - 1);
        const band = Math.sin(phase) * Math.exp(-Math.abs(t - durationSec / 2) * 3);
        out[i] = noise * band * 0.5 * e;
      }
      break;
    }
    case 'rise': {
      // нарастание: частота растёт, амплитура растёт
      for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const e = env[i] * (t / durationSec);
        const f = 200 + 1200 * (t / durationSec);
        out[i] = Math.sin(2 * Math.PI * f * t) * e * 0.6;
      }
      break;
    }
    default: {
      for (let i = 0; i < len; i++) out[i] = 0;
    }
  }
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  let outDir = path.join(root, 'audio', 'sfx');
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      const f = argv[++i];
      if (f === undefined) throw new Error('--out нуждается в значении');
      outDir = path.resolve(f);
    } else if (a === '--force') force = true;
    else throw new Error(`неизвестный аргумент ${a}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const rng = makeRng(0xC0FFEE);
  let written = 0;
  for (const sfx of SFX_SET) {
    const file = path.join(outDir, `${sfx.name}.wav`);
    if (!force && fs.existsSync(file)) continue;
    const samples = generate(sfx.name, sfx.duration, rng);
    const peak = writeWav(file, samples);
    console.log(`${sfx.name}.wav: ${(sfx.duration).toFixed(2)} с, пик ${(peak * 100).toFixed(1)} % (−3 dBFS = 70.7 %)`);
    written++;
  }
  if (written === 0) console.log('все эффекты уже на месте (перезапись — --force)');
  else console.log(`сгенерировано эффектов: ${written}`);
}

try {
  main();
} catch (e) {
  console.error(`ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
