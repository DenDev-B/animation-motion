import { renderFrame, createRenderCache, type SceneV1, type ProjectV1, type ProjectSceneV1, validateProject, projectFrameCount, validateScene, buildPrompt, extractJson, buildFixRequest, KIND_SPEC, type ValidationError, buildProjectPrompt, validateProjectReply, formatSuggestions, locateFrame, composeFrame } from '../engine/index.ts';
import { buildModelPrompt } from '../engine/ai-model.ts';
import { buildBriefPrompt, extractBrief, validateBrief } from '../engine/ai-brief.ts';
import { STYLE_PRESETS } from '../engine/styles.ts';
import { filterCatalog, sizeTextM, allProjectIds, uniqueId, buildCatalogAssetObject, buildSvgModel, checkModelJsonText, buildPreviewScene, collectProjectCredits, formatCredits, type ImportResult } from './catalog.ts';
import demoScene from '../scenes/whale-demo.json';
import demoProject from '../projects/whale-demo.project.json';
import catalogIndexRaw from '../catalog/index.json';
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
const topTabs = document.getElementById('topTabs') as HTMLElement | null;
const panelProject = document.getElementById('panelProject') as HTMLElement | null;
const panelScenes = document.getElementById('panelScenes') as HTMLElement | null;
const panelSplice = document.getElementById('panelSplice') as HTMLElement | null;
const panelCatalog = document.getElementById('panelCatalog') as HTMLElement | null;
const layerList = document.getElementById('layerList') as HTMLElement | null;
const sceneOrder = document.getElementById('sceneOrder') as HTMLElement | null;
const projectPreviewEl = document.getElementById('projectPreview') as HTMLCanvasElement | null;
const projectScrub = document.getElementById('projectScrub') as HTMLInputElement | null;
const projectTime = document.getElementById('projectTime') as HTMLElement | null;
const projectPlay = document.getElementById('projectPlay') as HTMLButtonElement | null;

// Каталог: ссылки на элементы
const catalogTabBar = document.getElementById('catalogTabBar') as HTMLElement | null;
const catalogPanelList = document.getElementById('catalogPanelList') as HTMLElement | null;
const catalogPanelPreview = document.getElementById('catalogPanelPreview') as HTMLElement | null;
const catalogPanelNewJson = document.getElementById('catalogPanelNewJson') as HTMLElement | null;
const catalogPanelSvg = document.getElementById('catalogPanelSvg') as HTMLElement | null;
const catalogPanelModelPrompt = document.getElementById('catalogPanelModelPrompt') as HTMLElement | null;
const catalogPanelCredits = document.getElementById('catalogPanelCredits') as HTMLElement | null;
const catalogSearch = document.getElementById('catalogSearch') as HTMLInputElement | null;
const catalogViewEl = document.getElementById('catalogView') as HTMLSelectElement | null;
const catalogCount = document.getElementById('catalogCount') as HTMLElement | null;
const catalogList = document.getElementById('catalogList') as HTMLElement | null;
const catalogEmpty = document.getElementById('catalogEmpty') as HTMLElement | null;
const catalogPreviewModel = document.getElementById('catalogPreviewModel') as HTMLSelectElement | null;
const catalogPreset = document.getElementById('catalogPreset') as HTMLSelectElement | null;
const catalogPlay = document.getElementById('catalogPlay') as HTMLButtonElement | null;
const catalogPreviewEl = document.getElementById('catalogPreview') as HTMLCanvasElement | null;
const catalogTime = document.getElementById('catalogTime') as HTMLInputElement | null;
const catalogTimeText = document.getElementById('catalogTimeText') as HTMLElement | null;
const catalogNewJson = document.getElementById('catalogNewJson') as HTMLTextAreaElement | null;
const catalogCheckJson = document.getElementById('catalogCheckJson') as HTMLButtonElement | null;
const catalogCopyFixJson = document.getElementById('catalogCopyFixJson') as HTMLButtonElement | null;
const catalogSaveJson = document.getElementById('catalogSaveJson') as HTMLButtonElement | null;
const catalogNewJsonStatus = document.getElementById('catalogNewJsonStatus') as HTMLElement | null;
const catalogNewJsonErrors = document.getElementById('catalogNewJsonErrors') as HTMLUListElement | null;
const catalogNewJsonWarnings = document.getElementById('catalogNewJsonWarnings') as HTMLUListElement | null;
const catalogSvgFile = document.getElementById('catalogSvgFile') as HTMLInputElement | null;
const catalogSvgId = document.getElementById('catalogSvgId') as HTMLInputElement | null;
const catalogSvgName = document.getElementById('catalogSvgName') as HTMLInputElement | null;
const catalogSvgView = document.getElementById('catalogSvgView') as HTMLSelectElement | null;
const catalogSvgSizeM = document.getElementById('catalogSvgSizeM') as HTMLInputElement | null;
const catalogSvgAxis = document.getElementById('catalogSvgAxis') as HTMLSelectElement | null;
const catalogSvgTags = document.getElementById('catalogSvgTags') as HTMLInputElement | null;
const catalogSvgLicense = document.getElementById('catalogSvgLicense') as HTMLInputElement | null;
const catalogSvgAuthor = document.getElementById('catalogSvgAuthor') as HTMLInputElement | null;
const catalogSvgSource = document.getElementById('catalogSvgSource') as HTMLInputElement | null;
const catalogSvgUrl = document.getElementById('catalogSvgUrl') as HTMLInputElement | null;
const catalogSvgAttribution = document.getElementById('catalogSvgAttribution') as HTMLInputElement | null;
const catalogImportSvg = document.getElementById('catalogImportSvg') as HTMLButtonElement | null;
const catalogCopyFixSvg = document.getElementById('catalogCopyFixSvg') as HTMLButtonElement | null;
const catalogSvgStatus = document.getElementById('catalogSvgStatus') as HTMLElement | null;
const catalogSvgWarnings = document.getElementById('catalogSvgWarnings') as HTMLUListElement | null;
const catalogModelDesc = document.getElementById('catalogModelDesc') as HTMLTextAreaElement | null;
const catalogModelView = document.getElementById('catalogModelView') as HTMLSelectElement | null;
const catalogModelSizeM = document.getElementById('catalogModelSizeM') as HTMLInputElement | null;
const catalogCopyModelPrompt = document.getElementById('catalogCopyModelPrompt') as HTMLButtonElement | null;
const catalogModelPromptStatus = document.getElementById('catalogModelPromptStatus') as HTMLElement | null;
const catalogModelResponse = document.getElementById('catalogModelResponse') as HTMLTextAreaElement | null;
const catalogSaveModel = document.getElementById('catalogSaveModel') as HTMLButtonElement | null;
const catalogModelStatus = document.getElementById('catalogModelStatus') as HTMLElement | null;
const catalogModelErrors = document.getElementById('catalogModelErrors') as HTMLUListElement | null;
const catalogModelWarnings = document.getElementById('catalogModelWarnings') as HTMLUListElement | null;
const catalogShowCredits = document.getElementById('catalogShowCredits') as HTMLButtonElement | null;
const catalogCreditsOut = document.getElementById('catalogCreditsOut') as HTMLPreElement | null;

// Новый проект из идеи
const ideaText = document.getElementById('ideaText') as HTMLTextAreaElement | null;
const ideaScenes = document.getElementById('ideaScenes') as HTMLInputElement | null;
const ideaSeconds = document.getElementById('ideaSeconds') as HTMLInputElement | null;
const ideaFormat = document.getElementById('ideaFormat') as HTMLSelectElement | null;
const ideaStyle = document.getElementById('ideaStyle') as HTMLSelectElement | null;
const ideaCopyBrief = document.getElementById('ideaCopyBrief') as HTMLButtonElement | null;
const ideaBrief = document.getElementById('ideaBrief') as HTMLTextAreaElement | null;
const ideaBriefStatus = document.getElementById('ideaBriefStatus') as HTMLElement | null;
const briefErrEl = document.getElementById('briefErrors') as HTMLUListElement | null;
const briefWarnEl = document.getElementById('briefWarnings') as HTMLUListElement | null;
const ideaCopyPrompt = document.getElementById('ideaCopyPrompt') as HTMLButtonElement | null;
const ideaPromptFallback = document.getElementById('ideaPromptFallback') as HTMLElement | null;
const ideaPromptOut = document.getElementById('ideaPromptOut') as HTMLTextAreaElement | null;
const ideaPromptSelectAll = document.getElementById('ideaPromptSelectAll') as HTMLButtonElement | null;
const ideaCopyStatus = document.getElementById('ideaCopyStatus') as HTMLElement | null;
const ideaResponse = document.getElementById('ideaResponse') as HTMLTextAreaElement | null;
const ideaCreate = document.getElementById('ideaCreate') as HTMLButtonElement | null;
const ideaFix = document.getElementById('ideaFix') as HTMLButtonElement | null;
const ideaStatus = document.getElementById('ideaStatus') as HTMLElement | null;
const ideaErrEl = document.getElementById('ideaErrors') as HTMLUListElement | null;
const ideaWarnEl = document.getElementById('ideaWarnings') as HTMLUListElement | null;

if (ideaStyle) {
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'без стиля';
  ideaStyle.appendChild(none);
  for (const preset of STYLE_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    ideaStyle.appendChild(option);
  }
}

let project: ProjectV1 = structuredClone(demoProject) as unknown as ProjectV1;
let activeSceneIndex = 0;
let scene: SceneV1 = project.scenes[activeSceneIndex].scene;
const catalogModules = import.meta.glob('../catalog/*.json', { eager: true, import: 'default' }) as Record<string, CatalogAsset>;
const catalog: Record<string, CatalogAsset> = {};
for (const [path, mod] of Object.entries(catalogModules)) {
  const file = path.split('/').pop() ?? path;
  if (file === 'index.json') continue;
  if (mod && typeof mod === 'object' && 'id' in mod) {
    catalog[(mod as CatalogAsset).id] = mod as CatalogAsset;
  }
}
const catalogIndex = (catalogIndexRaw as any[]).map((e: any) => {
  const model = catalog[e.id];
  return {
    id: e.id,
    name: e.name,
    tags: e.tags,
    view: e.view,
    realSize: e.realSize,
    bounds: model?.bounds,
    license: e.license?.name,
  };
});
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
let ideaCandidate: unknown;
let ideaErrList: ValidationError[] = [];
const SCOPE_LABELS: Record<JsonScope, string> = { scene: 'сцена', project: 'весь проект', object: 'выбранный объект' };

// Состояние каталога
let catalogQuery = '';
let catalogViewValue = 'все';
let catalogSelectedId: string | null = null;
const thumbCache = new Map<string, string>();
let previewTs = 0;
let previewPlaying = false;
let previewDuration = 8;
let lastPreviewTs = 0;
let previewRaf: number | null = null;
let newJsonCandidate: CatalogAsset | undefined;
let newJsonErrors: ValidationError[] = [];
let svgCandidate: ImportResult | null = null;
let modelCandidate: unknown;
let ideaSuggestions: Array<{ id: string; description: string; view?: string; sizeM?: number }> = [];

type TopTab = 'project' | 'scenes' | 'splice' | 'catalog';
const TOP_TABS: ReadonlyArray<readonly [TopTab, string]> = [['project', 'Проект'], ['scenes', 'Сцены'], ['splice', 'Склейка'], ['catalog', 'Каталог']];
const TAB_KEY = 'animation-motion/tab/v1';
const SCENE_TAB_KEY = 'animation-motion/scene-tab/v1';
const TRANSITION_OPTIONS = ['cut', 'fade', 'crossfade', 'slide', 'wipe', 'dip'] as const;
let activeTopTab: TopTab = 'project';
let spliceT = 0;
let splicePlaying = true;

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
function resetIdeaResult() {
  ideaCandidate = undefined;
  ideaErrList = [];
  if (ideaCreate) ideaCreate.disabled = true;
  if (ideaFix) ideaFix.hidden = true;
  showList(ideaErrEl, []);
  showList(ideaWarnEl, []);
  if (ideaStatus) { ideaStatus.textContent = ''; ideaStatus.classList.remove('err'); }
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
function reportIdeaErrors(errors: readonly ValidationError[], candidate?: unknown) {
  ideaCandidate = candidate;
  ideaErrList = [...errors];
  if (ideaCreate) ideaCreate.disabled = true;
  if (ideaFix) ideaFix.hidden = candidate === undefined || errors.length === 0;
  showList(ideaErrEl, errors);
  showList(ideaWarnEl, []);
  if (ideaStatus) { ideaStatus.textContent = errors.length ? `Ошибок: ${errors.length}. Исправьте ответ ИИ.` : ''; ideaStatus.classList.toggle('err', errors.length > 0); }
}
function setIdeaCopyStatus(message: string, isError: boolean) {
  if (!ideaCopyStatus) return;
  ideaCopyStatus.textContent = message;
  ideaCopyStatus.classList.toggle('err', isError);
}
function setIdeaStatus(message: string, isError: boolean) {
  if (!ideaStatus) return;
  ideaStatus.textContent = message;
  ideaStatus.classList.toggle('err', isError);
}
function setIdeaBriefStatus(message: string, isError: boolean) {
  if (!ideaBriefStatus) return;
  ideaBriefStatus.textContent = message;
  ideaBriefStatus.classList.toggle('err', isError);
}
function selectedStyleId(): string | undefined {
  return ideaStyle?.value || undefined;
}
function checkBriefField(): boolean {
  const text = ideaBrief?.value.trim() ?? '';
  if (!text) {
    showList(briefErrEl, []);
    showList(briefWarnEl, []);
    if (ideaCopyPrompt) ideaCopyPrompt.disabled = false;
    setIdeaBriefStatus('', false);
    return true;
  }
  const scenes = ideaScenes ? Number(ideaScenes.value) : 5;
  const result = validateBrief(text, { scenes });
  showList(briefErrEl, result.errors);
  showList(briefWarnEl, result.warnings);
  if (ideaCopyPrompt) ideaCopyPrompt.disabled = !result.ok;
  setIdeaBriefStatus(result.ok
    ? (result.warnings.length ? `ТЗ принято; предупреждений: ${result.warnings.length}. Можно копировать промт проекта.` : 'ТЗ принято. Можно копировать промт проекта.')
    : `Ошибок ТЗ: ${result.errors.length}. Исправьте ТЗ или очистите поле.`, !result.ok);
  return result.ok;
}

function setCatalogStatus(element: HTMLElement | null, message: string, isError: boolean) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('err', isError);
}

function storageGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch {}
}

const PANELS: Record<TopTab, HTMLElement | null> = { project: panelProject, scenes: panelScenes, splice: panelSplice, catalog: panelCatalog };

function renderTopTabs() {
  if (!topTabs) return;
  topTabs.innerHTML = '';
  for (const [id, label] of TOP_TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.tab = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(id === activeTopTab));
    button.classList.toggle('on', id === activeTopTab);
    button.onclick = () => setTopTab(id);
    topTabs.appendChild(button);
  }
}

function setTopTab(tab: TopTab, persist = true) {
  activeTopTab = tab;
  for (const [id, panel] of Object.entries(PANELS)) if (panel) panel.hidden = id !== tab;
  renderTopTabs();
  if (persist) storageSet(TAB_KEY, tab);
  if (tab === 'splice') { renderSceneOrder(); renderProjectPreview(); }
  else if (tab === 'catalog') renderCatalogList();
}

function renderLayerList() {
  if (!layerList) return;
  layerList.innerHTML = '';
  const layers = project.scenes[activeSceneIndex]?.scene.layers ?? [];
  if (layers.length === 0) { layerList.textContent = 'Слоёв нет.'; return; }
  layers.forEach((layer, layerIndex) => {
    const block = document.createElement('div');
    block.className = 'layer';
    const title = document.createElement('div');
    title.className = 'layer-name';
    title.textContent = `${layer.name} · depth ${layer.depth}${layer.visible === false ? ' · скрыт' : ''}`;
    block.appendChild(title);
    layer.objects.forEach((object, objectIndex) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'layer-object';
      button.textContent = `${object.name} (${object.kind})`;
      button.classList.toggle('on', jsonScope === 'object' && objectSelect?.value === `${layerIndex}:${objectIndex}`);
      button.onclick = () => selectObject(layerIndex, objectIndex);
      block.appendChild(button);
    });
    layerList.appendChild(block);
  });
}

function selectObject(layerIndex: number, objectIndex: number) {
  jsonScope = 'object';
  if (jsonScopeSelect) jsonScopeSelect.value = 'object';
  syncScopeRow();
  syncObjectOptions();
  if (objectSelect) objectSelect.value = `${layerIndex}:${objectIndex}`;
  refreshJson();
  resetAiResult();
  renderLayerList();
}

function transitionLimit(index: number): number {
  const previous = project.scenes[index - 1]?.scene.duration ?? 0;
  const current = project.scenes[index]?.scene.duration ?? 0;
  return Math.max(0, Math.min(previous, current) / 2);
}

function applyTransition(index: number, type: string, duration: number) {
  applyChange('transition', () => {
    const entry = project.scenes[index];
    if (!entry) return;
    if (index === 0 || type === 'cut') { entry.transition = { type: 'cut' }; return; }
    const limit = transitionLimit(index);
    const value = Math.min(limit, Math.max(0, Number.isFinite(duration) ? duration : 0));
    entry.transition = { type: type as ProjectV1['scenes'][number]['transition']['type'], duration: value };
  });
}

function renderSceneOrder() {
  if (!sceneOrder) return;
  sceneOrder.innerHTML = '';
  project.scenes.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'order-row';
    const head = document.createElement('div');
    head.className = 'order-head';
    const name = document.createElement('div');
    name.className = 'order-name';
    name.textContent = `${index + 1}. ${entry.name}`;
    const buttons = document.createElement('div');
    buttons.className = 'order-buttons';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.title = 'Выше';
    up.disabled = index === 0;
    up.onclick = () => moveScene(index, -1);
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.title = 'Ниже';
    down.disabled = index === project.scenes.length - 1;
    down.onclick = () => moveScene(index, 1);
    buttons.append(up, down);
    head.append(name, buttons);
    row.appendChild(head);
    const transition = document.createElement('div');
    transition.className = 'order-transition';
    if (index === 0) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'Первый кадр, переход не нужен';
      transition.appendChild(hint);
    } else {
      const type = entry.transition?.type ?? 'cut';
      const limit = transitionLimit(index);
      const typeLabel = document.createElement('label');
      typeLabel.className = 'f';
      typeLabel.textContent = 'Переход';
      const select = document.createElement('select');
      for (const value of TRANSITION_OPTIONS) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
      select.value = type;
      const durationLabel = document.createElement('label');
      durationLabel.className = 'f';
      durationLabel.textContent = 'Длительность, с';
      const duration = document.createElement('input');
      duration.type = 'number';
      duration.min = '0';
      duration.step = '0.1';
      duration.max = String(limit);
      duration.style.width = '80px';
      duration.value = String(entry.transition?.duration ?? 0.8);
      duration.disabled = type === 'cut';
      select.onchange = () => applyTransition(index, select.value, Number(duration.value) || 0);
      duration.onchange = () => applyTransition(index, select.value, Number(duration.value) || 0);
      typeLabel.appendChild(select);
      durationLabel.appendChild(duration);
      transition.append(typeLabel, durationLabel);
    }
    row.appendChild(transition);
    sceneOrder.appendChild(row);
  });
}

function renderProjectPreview() {
  const ctx = projectPreviewEl?.getContext('2d');
  if (!projectPreviewEl || !ctx || project.scenes.length === 0) return;
  const size = project.format === '9:16' ? { w: 180, h: 320 } : { w: 320, h: 180 };
  if (projectPreviewEl.width !== size.w || projectPreviewEl.height !== size.h) {
    projectPreviewEl.width = size.w;
    projectPreviewEl.height = size.h;
  }
  const total = Math.max(1, projectFrameCount(project));
  const seconds = total / project.fps;
  spliceT = Math.min(Math.max(0, spliceT), Math.max(0, seconds - 1 / project.fps));
  const globalIndex = Math.min(total - 1, Math.max(0, Math.round(spliceT * project.fps)));
  const env = { createCanvas: (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, catalog, cache };
  const make = () => { const c = document.createElement('canvas'); c.width = size.w; c.height = size.h; return c; };
  let location;
  try { location = locateFrame(project, globalIndex); } catch { return; }
  const first = project.scenes[location.frames[0].sceneIndex];
  const a = make();
  const actx = a.getContext('2d')!;
  renderFrame(actx, first.scene, location.frames[0].t, size, env);
  if (location.transition && location.frames[1]) {
    const second = project.scenes[location.frames[1].sceneIndex];
    const b = make();
    const bctx = b.getContext('2d')!;
    renderFrame(bctx, second.scene, location.frames[1].t, size, env);
    composeFrame(ctx, actx, bctx, location.transition.type, location.transition.progress, size, { dir: second.transition.dir, color: second.transition.color });
  } else {
    ctx.drawImage(a, 0, 0);
  }
  if (projectScrub) projectScrub.value = seconds > 0 ? (spliceT / seconds).toFixed(2) : '0';
  if (projectTime) projectTime.textContent = `${spliceT.toFixed(1)} / ${seconds.toFixed(1)} с`;
}

function renderCatalogTabs(active: string) {
  if (!catalogTabBar) return;
  catalogTabBar.innerHTML = '';
  const tabs: Array<[string, string]> = [['list', 'Список'], ['preview', 'Превью'], ['newjson', 'Новая модель из JSON'], ['svg', 'Импорт SVG'], ['modelprompt', 'Промт через ИИ'], ['credits', 'Титры проекта']];
  for (const [id, label] of tabs) {
    const button = document.createElement('button');
    button.textContent = label;
    button.classList.toggle('on', id === active);
    button.onclick = () => switchCatalogPanel(id);
    catalogTabBar.appendChild(button);
  }
}

function switchCatalogPanel(id: string) {
  const panels: Record<string, HTMLElement | null> = {
    list: catalogPanelList,
    preview: catalogPanelPreview,
    newjson: catalogPanelNewJson,
    svg: catalogPanelSvg,
    modelprompt: catalogPanelModelPrompt,
    credits: catalogPanelCredits,
  };
  for (const [key, panel] of Object.entries(panels)) if (panel) panel.hidden = key !== id;
  renderCatalogTabs(id);
  if (id === 'list') renderCatalogList();
  else if (id === 'preview') { renderPreviewModelSelect(); setPreviewPlaying(false); renderPreviewFrame(); }
  else if (id === 'credits') renderCatalogCredits();
}

function hexLuminance(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Средняя яркость заливок модели; null, если читаемых hex-fill нет (например, SVG с градиентами). */
function averageFillLuminance(asset: CatalogAsset): number | null {
  const values: number[] = [];
  for (const part of asset.parts ?? []) {
    const luminance = hexLuminance(part.fill);
    if (luminance !== null) values.push(luminance);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function thumbnailUrl(asset: CatalogAsset): string {
  const cached = thumbCache.get(asset.id);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 160;
  const g = c.getContext('2d')!;
  const bounds = Array.isArray(asset.bounds) && asset.bounds.length === 4 ? asset.bounds : [0, 0, 1, 1];
  const bw = Math.max(1e-6, Math.abs(Number(bounds[2])) || 1);
  const bh = Math.max(1e-6, Math.abs(Number(bounds[3])) || 1);
  // Большая сторона bounds занимает ~80% кадра 160×160; unitsPerMeter фиксирован, поэтому realSize не влияет.
  const k = 800 / Math.max(bw, bh);
  const unitsPerMeter = 1000;
  const scene = buildPreviewScene(asset, 'none', 1);
  const fillLuminance = averageFillLuminance(asset);
  scene.palette = { sky: fillLuminance !== null && fillLuminance > 0.7 ? ['#17141f', '#2c2735'] : ['#f4f1ea', '#dcd6ca'] };
  scene.world = { unitsPerMeter };
  scene.layers.unshift({ id: 'thumb-bg', name: 'Фон', depth: 0, visible: true, objects: [{ id: 'thumb-bg', name: 'Фон', kind: 'sky', x: 0, y: 0, s: 1 }] });
  const object = scene.layers[1]?.objects[0];
  if (object) {
    object.x = -(Number(bounds[0]) + bw / 2) * k;
    object.y = -(Number(bounds[1]) + bh / 2) * k;
    object.params = { ...(object.params ?? {}), sizeM: bh * k / unitsPerMeter };
  }
  try {
    renderFrame(g, scene, 0, { w: 160, h: 160 }, { createCanvas: (w: number, h: number) => { const cc = document.createElement('canvas'); cc.width = w; cc.height = h; return cc; }, catalog, cache });
  } catch {}
  const url = c.toDataURL('image/png');
  thumbCache.set(asset.id, url);
  return url;
}

function renderCatalogList() {
  if (!catalogList || !catalogCount || !catalogEmpty) return;
  catalogList.innerHTML = '';
  const rows = filterCatalog(catalog, catalogIndex, catalogQuery, catalogViewValue);
  catalogCount.textContent = `Моделей: ${rows.length}`;
  catalogEmpty.hidden = rows.length > 0;
  for (const entry of rows) {
    const asset = catalog[entry.id];
    const row = document.createElement('div');
    row.className = 'catalog-row';
    const img = document.createElement('img');
    img.className = 'catalog-thumb';
    img.width = 64;
    img.height = 64;
    img.alt = '';
    img.src = asset ? thumbnailUrl(asset) : '';
    const info = document.createElement('div');
    info.className = 'catalog-info';
    const name = document.createElement('div');
    name.className = 'catalog-name';
    name.textContent = entry.name ?? entry.id;
    const meta = document.createElement('div');
    meta.className = 'catalog-meta';
    meta.textContent = `${entry.id} · ${(entry.tags ?? []).join(', ')} · ${sizeTextM(entry)} · ${entry.license ?? '—'}`;
    info.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'catalog-actions';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Добавить в сцену';
    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.textContent = 'Копировать JSON модели';
    const copyPromptBtn = document.createElement('button');
    copyPromptBtn.textContent = 'Копировать промт: изменить модель';
    actions.append(addBtn, copyJsonBtn, copyPromptBtn);
    row.append(img, info, actions);
    catalogList.appendChild(row);
    addBtn.onclick = () => addCatalogAssetToScene(entry);
    copyJsonBtn.onclick = () => void copyText(asset ? JSON.stringify(asset, null, 2) : `{}`, `Модель ${entry.name ?? entry.id}`);
    copyPromptBtn.onclick = () => {
      if (!asset) return;
      const prompt = buildPrompt(asset, { task: 'Внесите изменения в эту модель и верните JSON модели целиком: один объект, без Markdown и пояснений.', scope: 'модель каталога' });
      void copyText(prompt, `Промт модели ${asset.name}`);
    };
  }
}

function addCatalogAssetToScene(entry: { id: string; name: string; view?: string; realSize?: { heightM?: number; widthM?: number } }) {
  const asset = catalog[entry.id];
  if (!asset) return;
  const scene = project.scenes[activeSceneIndex].scene;
  const taken = allProjectIds(project);
  const object = buildCatalogAssetObject(asset, scene, taken);
  const targetLayer = scene.layers.find((layer) => layer.depth === 1) ?? scene.layers[0];
  if (!targetLayer) return;
  applyChange(`Добавить в сцену: ${asset.name}`, () => { targetLayer.objects.push(object); });
}

function checkCatalogNewJson() {
  if (!catalogNewJson) return;
  const text = catalogNewJson.value.trim();
  const result = checkModelJsonText(text);
  newJsonCandidate = result.ok ? result.asset : undefined;
  newJsonErrors = result.errors;
  showList(catalogNewJsonErrors, result.errors);
  showList(catalogNewJsonWarnings, result.warnings);
  if (catalogSaveJson) catalogSaveJson.disabled = !result.ok;
  if (catalogCopyFixJson) catalogCopyFixJson.hidden = result.ok || result.errors.length === 0;
  setCatalogStatus(catalogNewJsonStatus, result.ok ? 'Ошибок нет. Можно сохранить в каталог.' : `Ошибок: ${result.errors.length}. Исправьте JSON модели.`, !result.ok);
}

function saveCatalogModel(asset: CatalogAsset) {
  const taken = new Set(Object.keys(catalog));
  let id = asset.id;
  if (taken.has(id)) {
    const overwrite = confirm(`Модель с id "${id}" уже есть в каталоге.\nНажмите ОК, чтобы перезаписать id, или Отмена — добавить с суффиксом _2.`);
    if (!overwrite) id = uniqueId(id, taken);
  }
  const out = { ...asset, id };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  catalog[id] = out;
  catalogIndex.push({ id, name: out.name, tags: out.meta?.tags ?? [], view: out.meta?.view, realSize: out.realSize, bounds: out.bounds, license: out.meta?.license?.name });
  thumbCache.clear();
  renderCatalogList();
  setCatalogStatus(catalogNewJsonStatus, `Сохранено в каталог как ${id} — файл ${id}.json скачан.`, false);
}

function readSvgFields() {
  return {
    id: (catalogSvgId?.value ?? '').trim(),
    name: (catalogSvgName?.value ?? '').trim(),
    view: (catalogSvgView?.value ?? 'side') as 'side' | 'bottom' | 'front' | 'top' | 'three-quarter',
    sizeM: Number(catalogSvgSizeM?.value) || 0,
    sizeAxis: (catalogSvgAxis?.value ?? 'height') as 'height' | 'width',
    tags: (catalogSvgTags?.value ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    license: {
      name: (catalogSvgLicense?.value ?? 'own').trim(),
      author: (catalogSvgAuthor?.value ?? '').trim(),
      source: (catalogSvgSource?.value ?? '').trim(),
      url: (catalogSvgUrl?.value ?? '').trim() || undefined,
      attribution: catalogSvgAttribution?.checked ?? false,
    },
  };
}

function fillSvgFields(asset: CatalogAsset) {
  if (!catalogSvgId || !catalogSvgName) return;
  if (!catalogSvgId.value) catalogSvgId.value = asset.id;
  if (!catalogSvgName.value) catalogSvgName.value = asset.name;
  if (asset.meta?.view) catalogSvgView!.value = asset.meta.view;
  if (asset.realSize) {
    catalogSvgSizeM!.value = String(asset.realSize.heightM ?? asset.realSize.widthM ?? '');
    catalogSvgAxis!.value = asset.realSize.heightM !== undefined ? 'height' : 'width';
  }
  if (asset.meta?.tags?.length) catalogSvgTags!.value = (asset.meta.tags as string[]).join(', ');
  if (asset.meta?.license?.name) catalogSvgLicense!.value = asset.meta.license.name;
  if (asset.meta?.license?.author) catalogSvgAuthor!.value = asset.meta.license.author;
  if (asset.meta?.license?.source) catalogSvgSource!.value = asset.meta.license.source;
  if (asset.meta?.license?.url) catalogSvgUrl!.value = asset.meta.license.url;
  if (asset.meta?.license?.attribution) catalogSvgAttribution!.checked = true;
}

function checkCatalogSvg() {
  const file = catalogSvgFile?.files?.[0];
  if (!file) return;
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const slug = baseName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
  if (catalogSvgId && !catalogSvgId.value.trim()) catalogSvgId.value = slug;
  if (catalogSvgName && !catalogSvgName.value.trim()) catalogSvgName.value = baseName;
  void file.text().then((text) => {
    const fields = readSvgFields();
    const result = buildSvgModel(text, fields);
    svgCandidate = result.ok ? result : null;
    const warningsEl = catalogSvgWarnings;
    if (warningsEl) { warningsEl.innerHTML = ''; for (const w of result.warnings) { const li = document.createElement('li'); li.textContent = w; warningsEl.appendChild(li); } }
    if (result.errors.length) setCatalogStatus(catalogSvgStatus, `Ошибки импорта: ${result.errors.map((e) => `${e.path || ''}: ${e.message}`).join('; ')}`, true);
    else if (result.ok) setCatalogStatus(catalogSvgStatus, `Геометрия готова: ${result.asset!.parts.length} частей. Предупреждений: ${result.warnings.length}. Нажмите «Импортировать».`, false);
    else setCatalogStatus(catalogSvgStatus, 'Импорт не удался.', true);
    if (catalogImportSvg) catalogImportSvg.disabled = !result.ok;
    if (catalogCopyFixSvg) catalogCopyFixSvg.hidden = !result.ok || result.errors.length === 0;
    if (result.ok) fillSvgFields(result.asset!);
  });
}

function importSvgToCatalog() {
  if (!svgCandidate || !svgCandidate.asset) return;
  const importedId = svgCandidate.asset.id;
  saveCatalogModel(svgCandidate.asset);
  svgCandidate = null;
  if (catalogSvgFile) catalogSvgFile.value = '';
  if (catalogImportSvg) catalogImportSvg.disabled = true;
  setCatalogStatus(catalogSvgStatus, `Импортировано как ${importedId}: модель в списке «Список», файл скачан. Положите его в папку catalog/ и выполните npm run catalog:add, чтобы она осталась навсегда.`, false);
}

function updateCatalogModelPrompt() {
  if (!catalogCopyModelPrompt) return;
  const desc = (catalogModelDesc?.value ?? '').trim();
  try {
    buildModelPrompt({ description: desc, view: (catalogModelView?.value ?? 'side') as 'side' | 'bottom' | 'front' | 'top' | 'three-quarter', sizeM: catalogModelSizeM?.valueAsNumber });
    catalogCopyModelPrompt.disabled = !desc;
  } catch {
    catalogCopyModelPrompt.disabled = true;
  }
}

function copyCatalogModelPrompt() {
  const desc = (catalogModelDesc?.value ?? '').trim();
  if (!desc) return;
  const prompt = buildModelPrompt({ description: desc, view: (catalogModelView?.value ?? 'side') as 'side' | 'bottom' | 'front' | 'top' | 'three-quarter', sizeM: catalogModelSizeM?.valueAsNumber });
  void copyText(prompt, 'Промт модели');
  if (catalogModelPromptStatus) {
    const bytes = new TextEncoder().encode(prompt).length;
    catalogModelPromptStatus.textContent = `Скопировано (${(bytes / 1024).toFixed(1)} КБ)`;
    catalogModelPromptStatus.classList.remove('err');
  }
}

function checkCatalogModelResponse() {
  if (!catalogModelResponse) return;
  const text = catalogModelResponse.value.trim();
  showList(catalogModelErrors, []);
  showList(catalogModelWarnings, []);
  if (catalogSaveModel) catalogSaveModel.disabled = true;
  modelCandidate = undefined;
  if (!text) { setCatalogStatus(catalogModelStatus, '', false); return; }
  if (!text.includes('{')) { setCatalogStatus(catalogModelStatus, 'Это не JSON модели. Скопируйте промт, вставьте ответ ИИ и попробуйте снова.', true); return; }
  let candidate: unknown;
  try { candidate = extractJson(text); } catch { setCatalogStatus(catalogModelStatus, 'Не удалось разобрать ответ ИИ.', true); return; }
  const result = checkModelJsonText(text);
  modelCandidate = result.ok ? candidate : undefined;
  showList(catalogModelErrors, result.errors);
  showList(catalogModelWarnings, result.warnings);
  if (catalogSaveModel) catalogSaveModel.disabled = !result.ok;
  setCatalogStatus(catalogModelStatus, result.ok ? 'Ответ ИИ прошёл проверку. Можно сохранить в каталог.' : `Ошибок: ${result.errors.length}. Исправьте ответ ИИ.`, !result.ok);
}

function copyCatalogModelPromptForSuggestion(description: string, view: string | undefined, sizeM: number | undefined, statusEl: HTMLElement) {
  const prompt = buildModelPrompt({ description, view: view as 'side' | 'bottom' | 'front' | 'top' | 'three-quarter' | undefined, sizeM });
  void copyText(prompt, `Промт модели ${description}`);
  statusEl.textContent = `Скопировано (${(new TextEncoder().encode(prompt).length / 1024).toFixed(1)} КБ)`;
  statusEl.classList.remove('err');
}

function renderCatalogCredits() {
  if (!catalogCreditsOut) return;
  catalogCreditsOut.textContent = formatCredits(collectProjectCredits(project, catalog));
}

function renderPreviewModelSelect() {
  if (!catalogPreviewModel) return;
  const previous = catalogPreviewModel.value;
  catalogPreviewModel.innerHTML = '';
  for (const id of Object.keys(catalog)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = catalog[id].name ?? id;
    catalogPreviewModel.appendChild(option);
  }
  if (previous && Array.from(catalogPreviewModel.options).some((option) => option.value === previous)) catalogPreviewModel.value = previous;
}

function renderPreviewFrame() {
  const ctx = catalogPreviewEl?.getContext('2d');
  if (!ctx) return;
  const asset = catalog[catalogPreviewModel?.value ?? ''];
  if (!asset) return;
  const preset = (catalogPreset?.value ?? 'none') as 'none' | 'walk' | 'run' | 'fly' | 'swim' | 'hop' | 'sway';
  const scene = buildPreviewScene(asset, preset, previewDuration);
  const time = Number(catalogTime?.value ?? 0);
  renderFrame(ctx, scene, time, { w: 280, h: 280 }, { createCanvas: (w: number, h: number) => { const cc = document.createElement('canvas'); cc.width = w; cc.height = h; return cc; }, catalog, cache });
  if (catalogTimeText) catalogTimeText.textContent = `${time.toFixed(1)} / ${previewDuration.toFixed(1)} с`;
}

function setPreviewPlaying(playing: boolean) {
  previewPlaying = playing;
  if (catalogPlay) catalogPlay.textContent = playing ? 'Пауза' : 'Играть';
  if (playing && previewRaf === null) { lastPreviewTs = performance.now(); previewRaf = requestAnimationFrame(previewTick); }
}

function previewTick(ts: number) {
  if (!previewPlaying) { lastPreviewTs = ts; previewRaf = requestAnimationFrame(previewTick); return; }
  previewTs = (previewTs + (ts - lastPreviewTs) / 1000) % previewDuration;
  lastPreviewTs = ts;
  if (catalogTime) catalogTime.value = previewTs.toFixed(2);
  renderPreviewFrame();
  previewRaf = requestAnimationFrame(previewTick);
}

function renderIdeaSuggestions() {
  const list = document.getElementById('ideaSuggestionsList') as HTMLElement | null;
  const panel = document.getElementById('ideaSuggestions') as HTMLElement | null;
  if (!list || !panel) return;
  if (ideaSuggestions.length === 0) { panel.hidden = true; list.innerHTML = ''; return; }
  panel.hidden = false;
  list.innerHTML = '';
  for (const s of ideaSuggestions) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;border:1px solid #ddd5ca;border-radius:6px;padding:6px';
    const text = document.createElement('span');
    text.textContent = `${s.id}: ${s.description}${s.view ? ` (вид: ${s.view})` : ''}${s.sizeM ? `, ~${s.sizeM} м` : ''}`;
    text.style.flex = '1';
    text.style.minWidth = '0';
    const button = document.createElement('button');
    button.textContent = 'Копировать промт для этой модели';
    const status = document.createElement('span');
    status.className = 'hint';
    status.style.marginLeft = '8px';
    button.onclick = () => copyCatalogModelPromptForSuggestion(s.description, s.view, s.sizeM, status);
    row.append(text, button, status);
    list.appendChild(row);
  }
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
function applyIdeaProject(candidate: unknown) {
  if (!confirm('Заменить текущий проект новым? Несохранённые изменения будут потеряны.')) return;
  applyChange('new-project-from-idea', () => {
    const next = structuredClone(candidate as ProjectV1);
    const briefText = ideaBrief?.value.trim() ?? '';
    const styleId = selectedStyleId();
    const briefOk = briefText ? validateBrief(briefText, { scenes: ideaScenes ? Number(ideaScenes.value) : 5 }).ok : false;
    if (briefOk || styleId) {
      next.meta = {
        ...(next.meta ?? {}),
        ...(briefOk ? { brief: extractBrief(briefText) } : {}),
        ...(styleId ? { styleId } : {}),
      };
    }
    project = next;
    activeSceneIndex = 0;
    scene = project.scenes[0].scene;
    duration = scene.duration;
    t = Math.min(t, duration);
  });
  ideaCandidate = undefined;
  ideaErrList = [];
  if (ideaCreate) ideaCreate.disabled = true;
  if (ideaFix) ideaFix.hidden = true;
  setStatus('Проект создан из идеи. Отмена — Ctrl+Z.', false);
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
function checkIdeaResponse(): boolean {
  if (!ideaResponse) return false;
  const text = ideaResponse.value.trim();
  if (!text) {
    reportIdeaErrors([{ path: '', message: 'Вставьте ответ ИИ в поле выше.' }]);
    setIdeaStatus('Ответ ИИ пуст.', true);
    if (ideaCreate) ideaCreate.disabled = true;
    return false;
  }
  if (!text.includes('{')) {
    reportIdeaErrors([{ path: '', message: 'Это не JSON проекта. Сначала скопируйте промт, вставьте его в чат ИИ и вставьте сюда ответ ИИ' }]);
    setIdeaStatus('Это не JSON проекта. Сначала скопируйте промт, вставьте его в чат ИИ и вставьте сюда ответ ИИ', true);
    if (ideaCreate) ideaCreate.disabled = true;
    return false;
  }
  let candidate: unknown;
  try {
    candidate = extractJson(text);
  } catch (error) {
    reportIdeaErrors([{ path: '', message: error instanceof Error ? error.message : String(error) }]);
    setIdeaStatus('Не удалось разобрать ответ ИИ.', true);
    if (ideaCreate) ideaCreate.disabled = true;
    return false;
  }
  const reply = validateProjectReply(candidate, { catalogIds: Object.keys(catalog) });
  ideaCandidate = candidate;
  ideaErrList = [...reply.errors];
  showList(ideaErrEl, reply.errors);
  showList(ideaWarnEl, []);
  if (reply.errors.length === 0) {
    if (ideaCreate) ideaCreate.disabled = false;
    if (ideaFix) ideaFix.hidden = true;
    setIdeaStatus(reply.warnings.length ? `ошибок нет; предупреждений: ${reply.warnings.length}; можно создать проект.` : 'ошибок нет; можно создать проект.', false);
    if (reply.suggestions.length) console.log(formatSuggestions(reply.suggestions));
    return true;
  }
  if (ideaCreate) ideaCreate.disabled = true;
  if (ideaFix) ideaFix.hidden = false;
  setIdeaStatus(`Ошибок: ${reply.errors.length}. Скопируйте запрос на исправление.`, true);
  return false;
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
  if (lastTs === 0) lastTs = ts;
  const dt = Math.max(0, (ts - lastTs) / 1000);
  if (playing) { t = (t + dt) % duration; frame(); }
  if (activeTopTab === 'splice' && splicePlaying) {
    const seconds = Math.max(0.001, projectFrameCount(project) / project.fps);
    spliceT = (spliceT + dt) % seconds;
    renderProjectPreview();
  }
  lastTs = ts;
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
if (projectPlay) projectPlay.onclick = () => {
  splicePlaying = !splicePlaying;
  projectPlay.textContent = splicePlaying ? 'Пауза' : 'Играть';
  if (splicePlaying) renderProjectPreview();
};
if (projectScrub) projectScrub.oninput = (e) => {
  splicePlaying = false;
  if (projectPlay) projectPlay.textContent = 'Играть';
  const seconds = Math.max(0, projectFrameCount(project) / project.fps);
  spliceT = Number((e.target as HTMLInputElement).value) * seconds;
  renderProjectPreview();
};
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
  resetIdeaResult();
  renderLayerList();
  renderSceneOrder();
  storageSet(SCENE_TAB_KEY, String(activeSceneIndex));
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
if (ideaCopyBrief) ideaCopyBrief.onclick = async () => {
  const idea = ideaText?.value.trim() ?? '';
  if (!idea) { setIdeaBriefStatus('Введите идею.', true); return; }
  try {
    const scenes = ideaScenes ? Number(ideaScenes.value) : 5;
    const seconds = ideaSeconds ? Number(ideaSeconds.value) : 8;
    const format = (ideaFormat?.value ?? '16:9') as '16:9' | '9:16';
    const prompt = buildBriefPrompt({ idea, scenes, sceneSeconds: seconds, format, styleId: selectedStyleId(), catalogIndex });
    await navigator.clipboard.writeText(prompt);
    const kb = (new TextEncoder().encode(prompt).length / 1024).toFixed(1);
    setIdeaBriefStatus(`Запрос на ТЗ скопирован (${kb} КБ). Вставьте его в чат ИИ.`, false);
  } catch (error) {
    setIdeaBriefStatus(error instanceof Error ? error.message : String(error), true);
  }
};
if (ideaBrief) ideaBrief.addEventListener('input', () => { checkBriefField(); });
if (ideaScenes) ideaScenes.addEventListener('change', () => { if (ideaBrief?.value.trim()) checkBriefField(); });
if (ideaCopyPrompt) ideaCopyPrompt.onclick = async () => {
  const idea = ideaText?.value.trim() ?? '';
  if (!idea) { setIdeaCopyStatus('Введите идею.', true); setIdeaStatus('', false); return; }
  if (!checkBriefField()) { setIdeaCopyStatus('В ТЗ есть ошибки: исправьте их или очистите поле.', true); return; }
  try {
    const scenes = ideaScenes ? Number(ideaScenes.value) : 5;
    const seconds = ideaSeconds ? Number(ideaSeconds.value) : 8;
    const format = (ideaFormat?.value ?? '16:9') as '16:9' | '9:16';
    const briefText = ideaBrief?.value.trim();
    const prompt = buildProjectPrompt({
      idea, scenes, sceneSeconds: seconds, format, catalogIndex,
      ...(briefText ? { brief: extractBrief(briefText) } : {}),
      ...(selectedStyleId() ? { styleId: selectedStyleId() } : {}),
    });
    try {
      await navigator.clipboard.writeText(prompt);
      if (ideaPromptFallback) ideaPromptFallback.hidden = true;
      const bytes = new TextEncoder().encode(prompt).length;
      const kb = (bytes / 1024).toFixed(1);
      setIdeaCopyStatus(`Скопировано (${kb} КБ). Вставьте в чат ИИ`, false);
      setIdeaStatus('', false);
    } catch {
      if (ideaPromptOut) ideaPromptOut.value = prompt;
      if (ideaPromptFallback) ideaPromptFallback.hidden = false;
      setIdeaCopyStatus('Буфер недоступен. Покажите промт в поле ниже.', true);
      setIdeaStatus('', false);
    }
  } catch (error) {
    setIdeaCopyStatus(error instanceof Error ? error.message : String(error), true);
  }
};
if (ideaPromptSelectAll) ideaPromptSelectAll.onclick = () => {
  if (!ideaPromptOut) return;
  ideaPromptOut.focus();
  ideaPromptOut.select();
};
if (ideaResponse) {
  ideaResponse.addEventListener('input', () => {
    if (!ideaResponse) return;
    const text = ideaResponse.value.trim();
    if (ideaStatus) { ideaStatus.textContent = ''; ideaStatus.classList.remove('err'); }
    if (ideaCreate) ideaCreate.disabled = true;
    showList(ideaErrEl, []);
    showList(ideaWarnEl, []);
    if (ideaFix) ideaFix.hidden = true;
    ideaCandidate = undefined;
    ideaErrList = [];
    if (!text) {
      return;
    }
    if (!text.includes('{')) {
      reportIdeaErrors([{ path: '', message: 'Это не JSON проекта. Сначала скопируйте промт, вставьте его в чат ИИ и вставьте сюда ответ ИИ' }]);
      setIdeaStatus('Это не JSON проекта. Сначала скопируйте промт, вставьте его в чат ИИ и вставьте сюда ответ ИИ', true);
      if (ideaCreate) ideaCreate.disabled = true;
      return;
    }
    void checkIdeaResponse();
  });
}
if (ideaCreate) ideaCreate.onclick = () => {
  if (!ideaResponse) return;
  const text = ideaResponse.value.trim();
  if (!text) {
    if (ideaCreate) ideaCreate.disabled = true;
    return;
  }
  if (!text.includes('{')) {
    return;
  }
  if (!checkIdeaResponse()) return;
  if (!confirm('Заменить текущий проект новым? Несохранённые изменения будут потеряны.')) return;
  applyIdeaProject(ideaCandidate!);
  const ideaReply = validateProjectReply(ideaCandidate as ProjectV1, { catalogIds: Object.keys(catalog) });
  ideaSuggestions = ideaReply.suggestions;
  renderIdeaSuggestions();
};
if (ideaFix) ideaFix.onclick = () => {
  if (ideaCandidate === undefined || ideaErrList.length === 0) return;
  void copyText(buildFixRequest(ideaCandidate, ideaErrList), 'Запрос на исправление');
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
const storedScene = Number(storageGet(SCENE_TAB_KEY));
if (Number.isInteger(storedScene) && storedScene >= 0 && storedScene < project.scenes.length) {
  activeSceneIndex = storedScene;
  scene = project.scenes[storedScene].scene;
  duration = scene.duration;
}
renderTabs();
updateSavedLabel();

// Каталог: первичный рендер и обработчики
renderCatalogTabs('list');
switchCatalogPanel('list');
if (catalogSearch) catalogSearch.addEventListener('input', (e) => { catalogQuery = (e.target as HTMLInputElement).value; renderCatalogList(); });
if (catalogViewEl) catalogViewEl.addEventListener('change', (e) => { catalogViewValue = (e.target as HTMLSelectElement).value; renderCatalogList(); });
if (catalogCheckJson) catalogCheckJson.onclick = checkCatalogNewJson;
if (catalogNewJson) catalogNewJson.addEventListener('input', checkCatalogNewJson);
if (catalogCopyFixJson) catalogCopyFixJson.onclick = () => { if (newJsonCandidate === undefined || newJsonErrors.length === 0) return; void copyText(buildFixRequest(newJsonCandidate, newJsonErrors), 'Запрос на исправление'); };
if (catalogSaveJson) catalogSaveJson.onclick = () => { const candidate = newJsonCandidate; if (!candidate) return; saveCatalogModel(candidate); };
if (catalogSvgFile) catalogSvgFile.addEventListener('change', checkCatalogSvg);
for (const el of document.querySelectorAll('#catalogPanelSvg input, #catalogPanelSvg select')) { if (el !== catalogSvgFile) el.addEventListener('input', checkCatalogSvg); }
if (catalogImportSvg) catalogImportSvg.onclick = importSvgToCatalog;
if (catalogCopyFixSvg) catalogCopyFixSvg.onclick = () => { if (!svgCandidate || !svgCandidate.asset) return; void copyText(buildFixRequest(svgCandidate.asset, svgCandidate.errors), 'Запрос на исправление'); };
if (catalogModelDesc) catalogModelDesc.addEventListener('input', updateCatalogModelPrompt);
if (catalogModelView) catalogModelView.addEventListener('change', updateCatalogModelPrompt);
if (catalogModelSizeM) catalogModelSizeM.addEventListener('input', updateCatalogModelPrompt);
if (catalogCopyModelPrompt) catalogCopyModelPrompt.onclick = copyCatalogModelPrompt;
if (catalogModelResponse) catalogModelResponse.addEventListener('input', checkCatalogModelResponse);
if (catalogSaveModel) catalogSaveModel.onclick = () => { const candidate = modelCandidate; if (!candidate) return; saveCatalogModel(candidate as CatalogAsset); };
if (catalogShowCredits) catalogShowCredits.onclick = () => { renderCatalogCredits(); if (catalogCreditsOut) { catalogCreditsOut.hidden = false; void copyText(catalogCreditsOut.textContent ?? '', 'Титры проекта'); } };
if (catalogPlay) catalogPlay.onclick = () => setPreviewPlaying(!previewPlaying);
if (catalogTime) catalogTime.addEventListener('input', (e) => { setPreviewPlaying(false); previewTs = Number((e.target as HTMLInputElement).value); renderPreviewFrame(); });
if (catalogPreviewModel) catalogPreviewModel.addEventListener('change', () => { setPreviewPlaying(false); renderPreviewFrame(); });
if (catalogPreset) catalogPreset.addEventListener('change', () => { setPreviewPlaying(false); renderPreviewFrame(); });

try {
  const stored = localStorage.getItem(AUTOSAVE_KEY);
  if (stored) {
    const saved = JSON.parse(stored) as { savedAt?: number; project?: unknown };
    const valid = validateProject(saved.project, { catalogIds: Object.keys(catalog) });
    if (saved.savedAt && valid.ok && confirm('Восстановить прошлую сессию?')) restoreProject(saved.project as ProjectV1);
  }
} catch {}

// boot
const storedTab = storageGet(TAB_KEY);
setTopTab(TOP_TABS.some(([id]) => id === storedTab) ? storedTab as TopTab : 'project', false);
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
