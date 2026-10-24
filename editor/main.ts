import { renderFrame, createRenderCache, type SceneV1, type ProjectV1, type ProjectSceneV1, validateProject, projectFrameCount, validateScene, buildPrompt, extractJson, buildFixRequest, KIND_SPEC, type ValidationError } from '../engine/index.ts';
import demoScene from '../scenes/whale-demo.json';
import demoProject from '../projects/whale-demo.project.json';
import whaleCatalog from '../catalog/whale.json';
import type { CatalogAsset } from '../engine/schema.ts';
import { EditorHistory } from './history.ts';
import { applyTargetJson, targetJson, validateTargetJson, type JsonScope, type JsonTarget } from './json-patch.ts';

const cv = document.getElementById('cv') as HTMLCanvasElement | null;
const ctx = cv?.getContext('2d') as CanvasRenderingContext2D | null;
const errBox = document.getElementById('err') as HTMLElement | null;
const errList = document.getElementById('errList') as HTMLUListElement | null;
const timeText = document.getElementById('time') as HTMLElement | null;
const scrub = document.getElementById('scrub') as HTMLInputElement | null;
const playBtn = document.getElementById('play') as HTMLButtonElement | null;
const aspectH = document.getElementById('aspectH') as HTMLButtonElement | null;
const aspectV = document.getElementById('aspectV') as HTMLButtonElement | null;
const jsonArea = document.getElementById('json') as HTMLTextAreaElement | null;
const applyBtn = document.getElementById('apply') as HTMLButtonElement | null;
const resetBtn = document.getElementById('reset') as HTMLButtonElement | null;
const selftestPre = document.getElementById('selftest') as HTMLElement | null;
const jsonScopeSelect = document.getElementById('jsonScope') as HTMLSelectElement | null;
const objectRow = document.getElementById('objectRow') as HTMLElement | null;
const objectSelect = document.getElementById('objectSelect') as HTMLSelectElement | null;
const copyJsonBtn = document.getElementById('copyJson') as HTMLButtonElement | null;
const copyAiBtn = document.getElementById('copyAi') as HTMLButtonElement | null;
const aiTaskInput = document.getElementById('aiTask') as HTMLInputElement | null;
const aiResponse = document.getElementById('aiResponse') as HTMLTextAreaElement | null;
const aiCheckBtn = document.getElementById('aiCheck') as HTMLButtonElement | null;
const aiApplyBtn = document.getElementById('aiApply') as HTMLButtonElement | null;
const aiFixBtn = document.getElementById('aiFix') as HTMLButtonElement | null;
const aiStatus = document.getElementById('aiStatus') as HTMLElement | null;
const aiErrors = document.getElementById('aiErrors') as HTMLUListElement | null;
const aiWarnings = document.getElementById('aiWarnings') as HTMLUListElement | null;
const templates = document.getElementById('templates') as HTMLElement | null;

let project: ProjectV1 = structuredClone(demoProject) as unknown as ProjectV1;
let activeSceneIndex = 0;
let scene: SceneV1 = project.scenes[activeSceneIndex].scene;
let catalog: Record<string, CatalogAsset> = { whale: whaleCatalog as unknown as CatalogAsset };
let t = 0;
let duration = 12;
let playing = true;
let vertical = false;
let lastTs = 0;
let rafId: number | null = null;
let cache = createRenderCache();
const history = new EditorHistory(project);
const AUTOSAVE_KEY = 'animation-motion/autosave/v1';
let autosaveTimer: number | undefined;
let hasUnsavedChanges = false;
let jsonScope: JsonScope = 'scene';
let pendingApply: { candidate: unknown; target: JsonTarget; label: string } | null = null;
let fixCandidate: unknown;
let fixErrors: ValidationError[] = [];
const SCOPE_LABELS: Record<JsonScope, string> = { scene: 'сцена', project: 'весь проект', object: 'выбранный объект' };

function updateSavedLabel() {
  const el = document.getElementById('saveState');
  if (el) el.textContent = hasUnsavedChanges ? 'Есть несохранённые изменения' : 'Сохранено';
}
function saveAutosave() {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), project })); } catch {}
}
function applyChange(label: string, mutator: () => void) {
  mutator();
  history.push(label, project);
  hasUnsavedChanges = true;
  updateSavedLabel();
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(saveAutosave, 1000);
  renderTabs(); frame();
}
function restoreProject(value: ProjectV1) {
  project = structuredClone(value); activeSceneIndex = 0; scene = project.scenes[0].scene; duration = scene.duration;
  renderTabs(); frame();
}
function currentTarget(): JsonTarget {
  const [layerIndex, objectIndex] = (objectSelect?.value ?? '').split(':').map(Number);
  return {
    scope: jsonScope,
    sceneIndex: jsonScope === 'project' ? 0 : activeSceneIndex,
    layerIndex: jsonScope === 'object' && Number.isInteger(layerIndex) ? layerIndex : 0,
    objectIndex: jsonScope === 'object' && Number.isInteger(objectIndex) ? objectIndex : 0,
  };
}
function syncScopeRow() {
  if (objectRow) objectRow.hidden = jsonScope !== 'object';
}
function syncObjectOptions() {
  if (!objectSelect) return;
  const previous = objectSelect.value;
  objectSelect.innerHTML = '';
  const layers = project.scenes[activeSceneIndex]?.scene.layers ?? [];
  layers.forEach((layer, layerIndex) => layer.objects.forEach((object, objectIndex) => {
    const option = document.createElement('option');
    option.value = `${layerIndex}:${objectIndex}`;
    option.textContent = `${layer.name} / ${object.name} (${object.kind})`;
    objectSelect.appendChild(option);
  }));
  if (previous && Array.from(objectSelect.options).some((option) => option.value === previous)) objectSelect.value = previous;
  else if (objectSelect.options.length) objectSelect.selectedIndex = 0;
}
function refreshJson() {
  if (!jsonArea) return;
  try {
    const value = targetJson(project, currentTarget());
    jsonArea.value = value === undefined ? '' : JSON.stringify(value, null, 2);
  } catch {
    jsonArea.value = '';
  }
}
function showList(element: HTMLUListElement | null, issues: readonly ValidationError[]) {
  if (!element) return;
  element.innerHTML = '';
  for (const issue of issues) {
    const item = document.createElement('li');
    item.textContent = `${issue.path || '(корень)'}: ${issue.message}`;
    element.appendChild(item);
  }
}
function setStatus(message: string, isError: boolean) {
  if (!aiStatus) return;
  aiStatus.textContent = message;
  aiStatus.classList.toggle('err', isError);
}
function resetAiResult() {
  pendingApply = null;
  fixCandidate = undefined;
  fixErrors = [];
  if (aiApplyBtn) aiApplyBtn.disabled = true;
  if (aiFixBtn) aiFixBtn.hidden = true;
  showList(aiErrors, []);
  showList(aiWarnings, []);
  if (aiStatus) { aiStatus.textContent = ''; aiStatus.classList.remove('err'); }
}
function reportErrors(errors: readonly ValidationError[], candidate?: unknown) {
  pendingApply = null;
  if (aiApplyBtn) aiApplyBtn.disabled = true;
  fixCandidate = candidate;
  fixErrors = [...errors];
  showList(aiErrors, errors);
  showList(aiWarnings, []);
  if (aiFixBtn) aiFixBtn.hidden = candidate === undefined || errors.length === 0;
}
function applyCandidate(candidate: unknown, target: JsonTarget, label: string) {
  applyChange(label, () => {
    project = applyTargetJson(project, target, candidate);
    activeSceneIndex = Math.min(target.sceneIndex, project.scenes.length - 1);
    scene = project.scenes[activeSceneIndex].scene;
    duration = scene.duration;
    t = Math.min(t, duration);
  });
  pendingApply = null;
  if (aiApplyBtn) aiApplyBtn.disabled = true;
}
function kindExample(kind: string): Record<string, unknown> {
  const spec = KIND_SPEC[kind as keyof typeof KIND_SPEC];
  const params: Record<string, unknown> = {};
  for (const field of spec.params) if (field.default !== undefined) params[field.name] = structuredClone(field.default);
  if (kind === 'text') params.text = 'Текст';
  if (kind === 'shape') params.model = { bounds: [-50, -50, 100, 100], parts: [{ id: 'body', type: 'path', d: 'M -50 -50 L 50 -50 L 50 50 L -50 50 Z', fill: '#ffffff' }] };
  const object: Record<string, unknown> = { id: `obj-${kind}`, name: kind, kind, x: 0, y: 0, s: 1, rot: 0, alpha: 1 };
  if (kind === 'asset') object.asset = 'whale';
  object.params = params;
  return object;
}
function renderTemplates() {
  if (!templates) return;
  templates.innerHTML = '';
  for (const kind of Object.keys(KIND_SPEC)) {
    const row = document.createElement('div');
    row.className = 'tpl';
    const name = document.createElement('code');
    name.textContent = kind;
    const button = document.createElement('button');
    button.textContent = 'Копировать пример';
    button.onclick = () => copyText(JSON.stringify(kindExample(kind), null, 2), `Шаблон ${kind}`);
    row.append(name, button);
    templates.appendChild(row);
  }
}
async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`${label}: скопировано в буфер.`, false);
  } catch {
    setStatus(`${label}: браузер не дал доступ к буферу обмена.`, true);
  }
}
function applyJsonText() {
  if (!jsonArea) return;
  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonArea.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportErrors([{ path: '', message: `Не удалось разобрать JSON: ${message}` }]);
    setStatus('Не удалось разобрать JSON.', true);
    return;
  }
  const target = currentTarget();
  const result = validateTargetJson(project, target, candidate, Object.keys(catalog));
  if (!result.ok) {
    reportErrors(result.errors, candidate);
    setStatus(`Ошибок: ${result.errors.length}. Исправьте JSON или скопируйте запрос на исправление.`, true);
    return;
  }
  try {
    applyCandidate(candidate, target, 'apply-json');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    return;
  }
  showList(aiWarnings, result.warnings);
  setStatus('Применено. Отмена — Ctrl+Z.', false);
}
function checkAiResponse() {
  if (!aiResponse) return;
  const text = aiResponse.value.trim();
  if (!text) {
    reportErrors([{ path: '', message: 'Вставьте ответ ИИ в поле выше.' }]);
    setStatus('Ответ ИИ пуст.', true);
    return;
  }
  let candidate: unknown;
  try {
    candidate = extractJson(text);
  } catch (error) {
    reportErrors([{ path: '', message: error instanceof Error ? error.message : String(error) }]);
    setStatus('Не удалось разобрать ответ ИИ.', true);
    return;
  }
  const target = currentTarget();
  const result = validateTargetJson(project, target, candidate, Object.keys(catalog));
  if (!result.ok) {
    reportErrors(result.errors, candidate);
    setStatus(`Ошибок: ${result.errors.length}. Можно скопировать запрос на исправление.`, true);
    return;
  }
  showList(aiErrors, []);
  showList(aiWarnings, result.warnings);
  fixCandidate = undefined;
  fixErrors = [];
  if (aiFixBtn) aiFixBtn.hidden = true;
  pendingApply = { candidate, target, label: 'apply-ai-json' };
  if (aiApplyBtn) aiApplyBtn.disabled = false;
  setStatus(result.warnings.length ? `ошибок нет; предупреждений: ${result.warnings.length}; можно применить.` : 'ошибок нет; можно применить.', false);
}
function makeEmptyScene(name: string): ProjectSceneV1 {
  const template = demoScene as unknown as SceneV1;
  return {
    id: `s-${Date.now()}`,
    name,
    transition: { type: 'cut' },
    scene: {
      version: 1,
      title: name,
      duration: 5,
      palette: structuredClone(template.palette),
      style: {},
      camera: { verticalFit: template.camera.verticalFit, keys: [{ t: 0, x: 0, y: 0, zoom: 1 }] },
      assets: {},
      layers: [],
    },
  };
}
function undoChange() { const value = history.undo(); if (value) { restoreProject(value); hasUnsavedChanges = true; updateSavedLabel(); saveAutosave(); } }
function redoChange() { const value = history.redo(); if (value) { restoreProject(value); hasUnsavedChanges = true; updateSavedLabel(); saveAutosave(); } }

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
  if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoChange() : undoChange(); }
  else if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redoChange(); }
});
window.addEventListener('beforeunload', (event) => { if (hasUnsavedChanges) { event.preventDefault(); event.returnValue = ''; } });

const size = { w: 1280, h: 720 };

function setAspect(a: 'h' | 'v') {
  vertical = a === 'v';
  size.w = vertical ? 720 : 1280;
  size.h = vertical ? 1280 : 720;
  if (cv) { cv.width = size.w; cv.height = size.h; cv.className = vertical ? 'v' : 'h'; }
  if (aspectH) aspectH.classList.toggle('on', !vertical);
  if (aspectV) aspectV.classList.toggle('on', vertical);
  frame();
}

function showErrors(errors: { path: string; message: string }[] | null) {
  if (errBox) errBox.hidden = !errors;
  if (errList) {
    errList.innerHTML = '';
    if (errors) for (const e of errors) {
      const li = document.createElement('li');
      li.textContent = `${e.path}: ${e.message}`;
      errList.appendChild(li);
    }
  }
}

function frame() {
  scene = project.scenes[activeSceneIndex].scene;
  duration = scene.duration;
  if (!ctx) return;
  const errors = validateScene(scene, { catalogIds: Object.keys(catalog) });
  showErrors(errors.ok ? null : errors.errors);
  if (!errors.ok) return;
  renderFrame(ctx, scene, t, size, { createCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, catalog, cache });
  if (scrub) scrub.value = (t / duration).toFixed(2);
  if (timeText) timeText.textContent = `${t.toFixed(1)} / ${duration.toFixed(1)} с`;
}

function loop(ts: number) {
  if (!playing) { lastTs = ts; rafId = requestAnimationFrame(loop); return; }
  t = (t + (ts - lastTs) / 1000) % duration;
  lastTs = ts;
  frame();
  rafId = requestAnimationFrame(loop);
}

function setPlaying(p: boolean) {
  playing = p;
  if (playBtn) playBtn.textContent = p ? 'Пауза' : 'Играть';
  if (playing && rafId === null) { lastTs = performance.now(); rafId = requestAnimationFrame(loop); }
}

function setT(tt: number) {
  setPlaying(false);
  t = Math.max(0, Math.min(tt, duration));
  frame();
}

(window as any).__editor = { setT, setAspect: (a: 'h' | 'v') => setAspect(a) };

if (scrub) scrub.oninput = (e) => {
  const target = e.target as HTMLInputElement | null;
  setPlaying(false);
  t = Number(target?.value ?? 0) * duration;
  frame();
};
if (playBtn) playBtn.onclick = () => setPlaying(!playing);
if (aspectH) aspectH.onclick = () => setAspect('h');
if (aspectV) aspectV.onclick = () => setAspect('v');

const tabs = document.getElementById('sceneTabs');
const openInput = document.getElementById('openProject') as HTMLInputElement | null;
const projectTitle = document.getElementById('projectTitle') as HTMLInputElement | null;
const projectFormat = document.getElementById('projectFormat') as HTMLSelectElement | null;
const projectFps = document.getElementById('projectFps') as HTMLSelectElement | null;
const projectDuration = document.getElementById('projectDuration');
function renderTabs() {
  if (!tabs) return;
  tabs.innerHTML = '';
  project.scenes.forEach((entry, index) => {
    const tab = document.createElement('span');
    tab.className = 'scene-tab';
    const select = document.createElement('button'); select.textContent = entry.name; select.classList.toggle('on', index === activeSceneIndex); select.onclick = () => { activeSceneIndex = index; scene = entry.scene; duration = scene.duration; frame(); renderTabs(); };
    const left = document.createElement('button'); left.textContent = '←'; left.title = 'Переместить влево'; left.disabled = index === 0; left.onclick = () => moveScene(index, -1);
    const right = document.createElement('button'); right.textContent = '→'; right.title = 'Переместить вправо'; right.disabled = index === project.scenes.length - 1; right.onclick = () => moveScene(index, 1);
    select.ondblclick = () => { const name = prompt('Название сцены', entry.name); if (name?.trim()) applyChange('rename-scene', () => { entry.name = name.trim(); }); };
    tab.append(select, left, right); tabs.appendChild(tab);
  });
  if (projectTitle) projectTitle.value = project.title;
  if (projectFormat) projectFormat.value = project.format;
  if (projectFps) projectFps.value = String(project.fps);
  if (projectDuration) projectDuration.textContent = `Проект: ${(projectFrameCount(project) / project.fps).toFixed(1)} с · Сцена: ${scene.duration.toFixed(1)} с`;
  syncObjectOptions();
  refreshJson();
  resetAiResult();
}
function moveScene(index: number, delta: number) { const target = index + delta; applyChange('move-scene', () => { [project.scenes[index], project.scenes[target]] = [project.scenes[target], project.scenes[index]]; activeSceneIndex = target; }); }
function updateProjectControls() { applyChange('project-settings', () => { if (projectTitle) project.title = projectTitle.value; if (projectFormat) project.format = projectFormat.value as ProjectV1['format']; if (projectFps) project.fps = Number(projectFps.value); }); }
document.getElementById('addScene')?.addEventListener('click', () => applyChange('add-scene', () => { project.scenes.push(makeEmptyScene('Новая сцена')); activeSceneIndex = project.scenes.length - 1; }));
document.getElementById('duplicateScene')?.addEventListener('click', () => applyChange('duplicate-scene', () => { const entry = structuredClone(project.scenes[activeSceneIndex]); entry.id = `s-${Date.now()}`; entry.name += ' — копия'; project.scenes.splice(activeSceneIndex + 1, 0, entry); activeSceneIndex++; }));
document.getElementById('deleteScene')?.addEventListener('click', () => { if (project.scenes.length <= 1) return; applyChange('delete-scene', () => { project.scenes.splice(activeSceneIndex, 1); activeSceneIndex = Math.min(activeSceneIndex, project.scenes.length - 1); }); });
projectTitle?.addEventListener('change', updateProjectControls); projectFormat?.addEventListener('change', updateProjectControls); projectFps?.addEventListener('change', updateProjectControls);
document.getElementById('newProject')?.addEventListener('click', () => applyChange('new-project', () => { project = { version: 1, title: 'Новый проект', fps: 30, format: '16:9', scenes: [makeEmptyScene('Сцена 1')] }; activeSceneIndex = 0; }));
document.getElementById('saveProject')?.addEventListener('click', () => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${project.title.replace(/[\\/:*?"<>|]/g, '_')}.json`; link.click(); URL.revokeObjectURL(link.href); hasUnsavedChanges = false; updateSavedLabel(); });
document.getElementById('openProjectButton')?.addEventListener('click', () => openInput?.click());
openInput?.addEventListener('change', async () => { const file = openInput.files?.[0]; if (!file) return; try { const parsed: unknown = JSON.parse(await file.text()); const result = validateProject(parsed, { catalogIds: Object.keys(catalog) }); if (!result.ok) { showErrors(result.errors); return; } applyChange('open-project', () => restoreProject(parsed as ProjectV1)); hasUnsavedChanges = false; updateSavedLabel(); showErrors(null); } catch (error) { showErrors([{ path: '', message: `Не удалось открыть проект: ${String(error)}` }]); } finally { openInput.value = ''; } });

if (applyBtn) applyBtn.onclick = applyJsonText;
if (copyJsonBtn) copyJsonBtn.onclick = () => {
  const value = targetJson(project, currentTarget());
  if (value === undefined) { setStatus('Объект не выбран.', true); return; }
  void copyText(JSON.stringify(value, null, 2), 'JSON');
};
if (copyAiBtn) copyAiBtn.onclick = () => {
  const value = targetJson(project, currentTarget());
  if (value === undefined) { setStatus('Объект не выбран.', true); return; }
  const task = aiTaskInput?.value.trim() ?? '';
  void copyText(buildPrompt(value, { task, scope: SCOPE_LABELS[jsonScope] }), 'Запрос для ИИ');
};
if (aiCheckBtn) aiCheckBtn.onclick = checkAiResponse;
if (aiApplyBtn) aiApplyBtn.onclick = () => {
  if (!pendingApply) return;
  const { candidate, target, label } = pendingApply;
  try {
    applyCandidate(candidate, target, label);
    setStatus('Применено. Отмена — Ctrl+Z.', false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
};
if (aiFixBtn) aiFixBtn.onclick = () => {
  if (fixCandidate === undefined || fixErrors.length === 0) return;
  void copyText(buildFixRequest(fixCandidate, fixErrors), 'Запрос на исправление');
};
jsonScopeSelect?.addEventListener('change', () => {
  jsonScope = (jsonScopeSelect.value as JsonScope) || 'scene';
  syncScopeRow();
  syncObjectOptions();
  refreshJson();
  resetAiResult();
});
objectSelect?.addEventListener('change', () => { refreshJson(); resetAiResult(); });
if (resetBtn) resetBtn.onclick = () => {
  applyChange('reset-scene', () => {
    scene = demoScene as unknown as SceneV1;
    project.scenes[activeSceneIndex].scene = scene;
    duration = scene.duration;
    t = Math.min(t, duration);
    showErrors(null);
  });
};

document.getElementById('undo')?.addEventListener('click', undoChange);
document.getElementById('redo')?.addEventListener('click', redoChange);

syncScopeRow();
renderTemplates();
renderTabs();
updateSavedLabel();
try {
  const stored = localStorage.getItem(AUTOSAVE_KEY);
  if (stored) {
    const saved = JSON.parse(stored) as { savedAt?: number; project?: unknown };
    const valid = validateProject(saved.project, { catalogIds: Object.keys(catalog) });
    if (saved.savedAt && valid.ok && confirm('Восстановить прошлую сессию?')) restoreProject(saved.project as ProjectV1);
  }
} catch {}

// boot
setAspect('h');
frame();
rafId = requestAnimationFrame(loop);

// Selftest
if (location.search.includes('selftest') && ctx) {
  const pre = selftestPre || (() => { const el = document.createElement('pre'); el.id = 'selftest'; document.body.appendChild(el); return el; })();
  function renderToCanvas(w: number, h: number, sc: SceneV1, tt: number): ImageData {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    renderFrame(g, sc, tt, { w, h }, { createCanvas: (w2, h2) => { const c2 = document.createElement('canvas'); c2.width = w2; c2.height = h2; return c2; }, catalog, cache });
    return g.getImageData(0, 0, w, h);
  }
  function equal(a: ImageData, b: ImageData): boolean {
    if (a.data.length !== b.data.length) return false;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
    return true;
  }
  let fail = '';
  for (const item of [['16:9', 1280, 720], ['9:16', 720, 1280]] as [string, number, number][]) {
    const [label, w, h] = item;
    const a1 = renderToCanvas(w, h, scene, 0);
    const a2 = renderToCanvas(w, h, scene, 0);
    if (!equal(a1, a2)) { fail = `${label} t=0 невоспроизводим`; break; }
    const t6 = renderToCanvas(w, h, scene, 6);
    const t6b = renderToCanvas(w, h, scene, 6);
    if (!equal(t6, t6b)) { fail = `${label} t=6 невоспроизводим`; break; }
    const a0again = renderToCanvas(w, h, scene, 0);
    if (!equal(a0again, a1)) { fail = `${label} состояние между кадрами`; break; }
  }
  pre.hidden = false;
  pre.textContent = fail ? `SELFTEST: FAIL: ${fail}` : 'SELFTEST: PASS';
}
