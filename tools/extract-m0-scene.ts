import fs from 'fs';
import vm from 'vm';
import type { SceneV1, CatalogAsset, AssetPart } from '../engine/schema.ts';

const HTML_PATH = 'reference/m0/scene-sandbox.html';

function getScript(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('<script> не найден в scene-sandbox.html');
  return m[1];
}

// Найти закрывающую скобку для блока, начинающегося с '{' на позиции start-1.
// Учитывает строки, шаблонные литералы, комментарии.
function matchBrace(s: string, openIndex: number): number {
  let depth = 0;
  let str: string | null = null;
  let tmpl = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (tmpl) { if (c === '\\') { i++; continue; } if (c === '`' && n !== '{') tmpl = false; else if (c === '$' && n === '{') { depth++; i++; continue; } continue; }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"') { str = c; continue; }
    if (c === '`') { tmpl = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('не найдена закрывающая скобка');
}

function extractBlock(script: string, startMarker: string): string {
  const idx = script.indexOf(startMarker);
  if (idx === -1) throw new Error(`блок не найден: ${startMarker}`);
  const braceIdx = script.indexOf('{', idx);
  const endIdx = matchBrace(script, braceIdx);
  return script.slice(idx, endIdx + 1);
}

export function extractDemoScene(): { scene: SceneV1; whale: CatalogAsset } {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const script = getScript(html);

  const blocks = [
    extractBlock(script, 'const PRESETS = {'),
    extractBlock(script, 'const BUILTIN = {'),
    'let uidN = 0; const uid = p => p + (++uidN).toString(36) + Math.random().toString(36).slice(2,5);',
    extractBlock(script, 'function demo(){'),
  ];
  const combined = blocks.join('\n');

  let counter = 0;
  const random = () => (((counter += 1) * 2654435761) >>> 0) / 4294967296;

  const sandbox: Record<string, unknown> = {
    Object, Array, JSON, Math, parseInt, isNaN, Number, String, Boolean,
    RegExp, Date, Map, Set, TypeError, Error
  };
  sandbox.Math = { ...Math, random };

  vm.createContext(sandbox);
  const wrapper = `(function() { ${combined} return { demo, BUILTIN }; })();`;
  const result = vm.runInContext(wrapper, sandbox) as { demo: () => SceneV1; BUILTIN: Record<string, unknown> };
  const scene = result.demo();

  let layerIdx = 0;
  let objIdx = 0;
  for (const layer of scene.layers) {
    layer.id = `layer-${++layerIdx}`;
    for (const obj of layer.objects) {
      obj.id = `obj-${++objIdx}`;
    }
  }

  const builtinWhale = (result.BUILTIN as Record<string, unknown>)['whale'] as Record<string, unknown>;
  const whale: CatalogAsset = { version: 1, id: 'whale', name: builtinWhale.name as string, bounds: builtinWhale.bounds as [number, number, number, number], parts: builtinWhale.parts as AssetPart[] };

  return { scene, whale };
}

if (import.meta.main) {
  const { scene, whale } = extractDemoScene();
  fs.writeFileSync('scenes/whale-demo.json', JSON.stringify(scene, null, 2) + '\n');
  fs.writeFileSync('catalog/whale.json', JSON.stringify(whale, null, 2) + '\n');
  console.log('scenes/whale-demo.json и catalog/whale.json записаны');
}
