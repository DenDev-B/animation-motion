import { renderFrame, createRenderCache, applySceneStyle, setSceneShot, CAMERA_SHOT_NAMES, type SceneV1, type ProjectV1, type ProjectSceneV1, type ProjectSubtitlesV1, type VoiceWord, validateProject, projectFrameCount, validateScene, buildPrompt, extractJson, buildFixRequest, KIND_SPEC, type ValidationError, buildProjectPrompt, validateProjectReply, formatSuggestions, splitReply, type SplitReply, locateFrame, composeFrame, buildSubtitleCues, activeCueAt, drawSubtitle, defaultSubtitleSize, voiceBatchPlan, runVoiceBatch, applyVoiceResult, type VoiceBatchScene } from '../engine/index.ts';
import { buildModelPrompt } from '../engine/ai-model.ts';
import { col } from '../engine/color.ts';
import { buildBriefPrompt, extractBrief, validateBrief } from '../engine/ai-brief.ts';
import { STYLE_MOODS, STYLE_PRESETS, type StyleMood } from '../engine/styles.ts';
import { SAFE_ZONES } from '../engine/spec.ts';
import { EDITOR_STRINGS } from './strings.ts';
import { filterCatalog, sizeTextM, allProjectIds, uniqueId, buildCatalogAssetObject, buildSvgModel, checkModelJsonText, buildPreviewScene, formatModelJson, previewAssetFor, catalogWithDraft, type CheckModelJsonResult, collectProjectCredits, formatCredits, type ImportResult } from './catalog.ts';
import demoScene from '../scenes/whale-demo.json';
import demoProject from '../projects/whale-demo.project.json';
import catalogIndexRaw from '../catalog/index.json';
import type { CameraShot, CameraShotName, CatalogAsset, Palette } from '../engine/schema.ts';
import { EditorHistory, shouldHandleUndoKey } from './history.ts';
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
const safeZonesToggle = document.getElementById('safeZones') as HTMLInputElement | null;
const safeZonesText = document.getElementById('safeZonesText') as HTMLElement | null;
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
const appEl = document.getElementById('app') as HTMLElement | null;
const stageCol = document.getElementById('stageCol') as HTMLElement | null;
const panelProject = document.getElementById('panelProject') as HTMLElement | null;
const panelScenes = document.getElementById('panelScenes') as HTMLElement | null;
const panelSplice = document.getElementById('panelSplice') as HTMLElement | null;
const panelCatalog = document.getElementById('panelCatalog') as HTMLElement | null;
const layerList = document.getElementById('layerList') as HTMLElement | null;
const sceneOrder = document.getElementById('sceneOrder') as HTMLElement | null;
const voicePanel = document.getElementById('voicePanel') as HTMLElement | null;
// Панель «Образ сцены»
const sceneLookTitleText = document.getElementById('sceneLookTitleText') as HTMLElement | null;
const lookStyleText = document.getElementById('lookStyleText') as HTMLElement | null;
const lookStyleSelect = document.getElementById('lookStyle') as HTMLSelectElement | null;
const lookMoodText = document.getElementById('lookMoodText') as HTMLElement | null;
const lookMoodSelect = document.getElementById('lookMood') as HTMLSelectElement | null;
const lookStyleDesc = document.getElementById('lookStyleDesc') as HTMLElement | null;
const lookApplyStyleBtn = document.getElementById('lookApplyStyle') as HTMLButtonElement | null;
const lookApplyStyleAllBtn = document.getElementById('lookApplyStyleAll') as HTMLButtonElement | null;
const lookShotText = document.getElementById('lookShotText') as HTMLElement | null;
const lookShotSelect = document.getElementById('lookShot') as HTMLSelectElement | null;
const lookShotT0Text = document.getElementById('lookShotT0Text') as HTMLElement | null;
const lookShotT0 = document.getElementById('lookShotT0') as HTMLInputElement | null;
const lookShotDurText = document.getElementById('lookShotDurText') as HTMLElement | null;
const lookShotDur = document.getElementById('lookShotDur') as HTMLInputElement | null;
const lookShotStrengthText = document.getElementById('lookShotStrengthText') as HTMLElement | null;
const lookShotStrength = document.getElementById('lookShotStrength') as HTMLInputElement | null;
const lookApplyShotBtn = document.getElementById('lookApplyShot') as HTMLButtonElement | null;
const lookRemoveShotBtn = document.getElementById('lookRemoveShot') as HTMLButtonElement | null;
const lookNoteText = document.getElementById('lookNoteText') as HTMLElement | null;
const projectPreviewEl = document.getElementById('projectPreview') as HTMLCanvasElement | null;
const projectScrub = document.getElementById('projectScrub') as HTMLInputElement | null;
const projectTime = document.getElementById('projectTime') as HTMLElement | null;
const projectPlay = document.getElementById('projectPlay') as HTMLButtonElement | null;
const exportMp4Btn = document.getElementById('exportMp4') as HTMLButtonElement | null;
const exportCancelBtn = document.getElementById('exportCancel') as HTMLButtonElement | null;
const exportDownload = document.getElementById('exportDownload') as HTMLAnchorElement | null;
const exportStatusEl = document.getElementById('exportStatus') as HTMLElement | null;
const exportHintEl = document.getElementById('exportHint') as HTMLElement | null;
const exportMode = document.getElementById('exportMode') as HTMLSelectElement | null;
const exportFrom = document.getElementById('exportFrom') as HTMLInputElement | null;
const exportTo = document.getElementById('exportTo') as HTMLInputElement | null;
const exportFrameAt = document.getElementById('exportFrameAt') as HTMLInputElement | null;
const exportScale = document.getElementById('exportScale') as HTMLSelectElement | null;
const exportFromLabel = document.getElementById('exportFromLabel') as HTMLElement | null;
const exportToLabel = document.getElementById('exportToLabel') as HTMLElement | null;
const exportFrameLabel = document.getElementById('exportFrameLabel') as HTMLElement | null;
const exportModeText = document.getElementById('exportModeText') as HTMLElement | null;
const exportFromText = document.getElementById('exportFromText') as HTMLElement | null;
const exportToText = document.getElementById('exportToText') as HTMLElement | null;
const exportFrameText = document.getElementById('exportFrameText') as HTMLElement | null;
const exportScaleText = document.getElementById('exportScaleText') as HTMLElement | null;

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
const catalogCode = document.getElementById('catalogCode') as HTMLTextAreaElement | null;
const catalogCodeReset = document.getElementById('catalogCodeReset') as HTMLButtonElement | null;
const catalogCodeSave = document.getElementById('catalogCodeSave') as HTMLButtonElement | null;
const catalogCodeFile = document.getElementById('catalogCodeFile') as HTMLInputElement | null;
const catalogCodeStatus = document.getElementById('catalogCodeStatus') as HTMLElement | null;
const catalogCodeErrors = document.getElementById('catalogCodeErrors') as HTMLUListElement | null;
let codeDraft: CheckModelJsonResult | undefined;
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
const catalogPanelUpload = document.getElementById('catalogPanelUpload') as HTMLElement | null;
const catalogUploadDrop = document.getElementById('catalogUploadDrop') as HTMLElement | null;
const catalogUploadPick = document.getElementById('catalogUploadPick') as HTMLButtonElement | null;
const catalogUploadFilesInput = document.getElementById('catalogUploadFiles') as HTMLInputElement | null;
const catalogUploadLicense = document.getElementById('catalogUploadLicense') as HTMLInputElement | null;
const catalogUploadAuthor = document.getElementById('catalogUploadAuthor') as HTMLInputElement | null;
const catalogUploadSource = document.getElementById('catalogUploadSource') as HTMLInputElement | null;
const catalogUploadResults = document.getElementById('catalogUploadResults') as HTMLUListElement | null;
const catalogUploadStatus = document.getElementById('catalogUploadStatus') as HTMLElement | null;

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
const ideaAuto = document.getElementById('ideaAuto') as HTMLButtonElement | null;
const ideaAiCheck = document.getElementById('ideaAiCheck') as HTMLButtonElement | null;
const ideaAutoStatus = document.getElementById('ideaAutoStatus') as HTMLElement | null;
const ideaAutoExport = document.getElementById('ideaAutoExport') as HTMLInputElement | null;
const ideaAutoExportText = document.getElementById('ideaAutoExportText') as HTMLElement | null;
const ideaSaveAllBtn = document.getElementById('ideaSaveAll') as HTMLButtonElement | null;
const ideaSaveAllStatus = document.getElementById('ideaSaveAllStatus') as HTMLElement | null;
const ideaSaveAllErrors = document.getElementById('ideaSaveAllErrors') as HTMLUListElement | null;
const ideaCopyPrompt = document.getElementById('ideaCopyPrompt') as HTMLButtonElement | null;
const ideaCopyProjectPrompt = document.getElementById('ideaCopyProjectPrompt') as HTMLButtonElement | null;
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
  none.textContent = EDITOR_STRINGS.scenes.noStyle;
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
/** ТЗ из ответа ИИ (путь «ТЗ + проект одним ответом»); записывается в meta.brief при создании проекта. */
let ideaReplyBrief = '';
const SCOPE_LABELS: Record<JsonScope, string> = EDITOR_STRINGS.scopeLabels;

// Состояние каталога
let catalogQuery = '';
let catalogViewValue: string = EDITOR_STRINGS.catalog.all;
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
const TOP_TABS: ReadonlyArray<readonly [TopTab, string]> = EDITOR_STRINGS.topTabs;
const TAB_KEY = 'animation-motion/tab/v1';
const SCENE_TAB_KEY = 'animation-motion/scene-tab/v1';
const AUTO_EXPORT_KEY = 'animation-motion/auto-export/v1';
const TRANSITION_OPTIONS = ['cut', 'fade', 'crossfade', 'slide', 'wipe', 'dip'] as const;
let activeTopTab: TopTab = 'project';
let spliceT = 0;
let splicePlaying = true;

function updateSavedLabel() {
  const el = document.getElementById('saveState');
  if (el) el.textContent = hasUnsavedChanges ? EDITOR_STRINGS.common.unsaved : EDITOR_STRINGS.common.saved;
}
function saveAutosave() {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), project })); } catch {}
}
function applyChange(label: string, mutator: () => void) {
  mutator();
  sceneThumbCache.clear();
  history.push(label, project);
  hasUnsavedChanges = true;
  updateSavedLabel();
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(saveAutosave, 1000);
  renderTabs(); frame();
}
function restoreProject(value: ProjectV1) {
  project = structuredClone(value); activeSceneIndex = 0; scene = project.scenes[0].scene; duration = scene.duration;
  sceneThumbCache.clear();
  syncStoryField();
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
    item.textContent = EDITOR_STRINGS.errors.issueLine(issue.path, issue.message);
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
  ideaReplyBrief = '';
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
  if (ideaStatus) { ideaStatus.textContent = errors.length ? EDITOR_STRINGS.errors.aiReplyErrors(errors.length) : ''; ideaStatus.classList.toggle('err', errors.length > 0); }
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
/** Вставлен только документ ТЗ: заголовки «## 1.»…«## 7.» без JSON-блока. */
const ideaReplyMessage = (text: string): string => (/^##\s*[1-7]\./m.test(text) ? EDITOR_STRINGS.project.briefNotJson : EDITOR_STRINGS.project.notJson);
function selectedStyleId(): string | undefined {
  return ideaStyle?.value || undefined;
}
function checkBriefField(): boolean {
  const text = ideaBrief?.value.trim() ?? '';
  if (!text) {
    showList(briefErrEl, []);
    showList(briefWarnEl, []);
    if (ideaCopyProjectPrompt) ideaCopyProjectPrompt.disabled = false;
    setIdeaBriefStatus('', false);
    return true;
  }
  const scenes = ideaScenes ? Number(ideaScenes.value) : 5;
  const result = validateBrief(text, { scenes });
  showList(briefErrEl, result.errors);
  showList(briefWarnEl, result.warnings);
  if (ideaCopyProjectPrompt) ideaCopyProjectPrompt.disabled = !result.ok;
  setIdeaBriefStatus(result.ok
    ? (result.warnings.length ? EDITOR_STRINGS.project.briefAcceptedWarnings(result.warnings.length) : EDITOR_STRINGS.project.briefAccepted)
    : EDITOR_STRINGS.project.briefErrors(result.errors.length), !result.ok);
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

/** Флаг «Сразу собрать видео» живёт в localStorage и переживает закрытие вкладки; по умолчанию выключен. */
function autoExportRequested(): boolean {
  try { return localStorage.getItem(AUTO_EXPORT_KEY) === '1'; } catch { return false; }
}
function setAutoExportRequested(value: boolean): void {
  try { localStorage.setItem(AUTO_EXPORT_KEY, value ? '1' : '0'); } catch {}
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
  if (stageCol) stageCol.hidden = tab !== 'scenes';
  if (appEl) appEl.classList.toggle('full', tab !== 'scenes');
  renderTopTabs();
  if (persist) storageSet(TAB_KEY, tab);
  if (tab === 'splice') { renderSceneOrder(); renderProjectPreview(); void refreshExportPanel(); void refreshVoicePanel(); }
  else if (tab === 'catalog') renderCatalogList();
  else if (tab === 'scenes') frame();
}

function renderLayerList() {
  if (!layerList) return;
  layerList.innerHTML = '';
  const layers = project.scenes[activeSceneIndex]?.scene.layers ?? [];
  if (layers.length === 0) { layerList.textContent = EDITOR_STRINGS.scenes.noLayers; return; }
  layers.forEach((layer, layerIndex) => {
    const block = document.createElement('div');
    block.className = 'layer';
    const title = document.createElement('div');
    title.className = 'layer-name';
    title.textContent = EDITOR_STRINGS.scenes.layerLine(layer.name, layer.depth, layer.visible === false);
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

const sceneThumbCache = new Map<string, HTMLCanvasElement>();

function sceneThumbnail(entry: ProjectSceneV1, index: number): HTMLCanvasElement {
  const key = `${index}:${entry.id}`;
  const cached = sceneThumbCache.get(key);
  if (cached) return cached;
  const w = 240;
  const h = project.format === '9:16' ? Math.round(w * 16 / 9) : Math.round(w * 9 / 16);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.className = 'order-thumb';
  const g = canvas.getContext('2d');
  if (g) {
    const env = { createCanvas: (cw: number, ch: number) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; }, catalog, cache };
    try { renderFrame(g, entry.scene, entry.scene.duration * 0.4, { w, h }, env); } catch {}
  }
  sceneThumbCache.set(key, canvas);
  return canvas;
}

function focusSceneCard(index: number) {
  requestAnimationFrame(() => {
    const cards = sceneOrder?.querySelectorAll<HTMLElement>('.order-row');
    cards?.[index]?.focus();
  });
}

function transitionControl(index: number, entry: ProjectSceneV1): HTMLElement {
  const transition = document.createElement('div');
  transition.className = 'order-transition';
  const type = entry.transition?.type ?? 'cut';
  const limit = transitionLimit(index);
  const typeLabel = document.createElement('label');
  typeLabel.className = 'f';
  typeLabel.textContent = EDITOR_STRINGS.scenes.transition;
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
  durationLabel.textContent = EDITOR_STRINGS.scenes.durationLabel;
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
  return transition;
}

/** Можно ли начать перетаскивание карточки сцены с этого целевого узла.
 * Захват только у миниатюры или заголовка карточки; никогда из полей ввода,
 * кнопок, переключателей, аудио и блока перехода. */
function canStartCardDrag(target: Element | null): boolean {
  if (!target) return false;
  if (target.closest('input, select, textarea, button, summary, audio, .voice-block, .order-transition')) return false;
  return Boolean(target.closest('.order-thumb, .order-head'));
}

function renderSceneOrder() {
  if (!sceneOrder) return;
  sceneOrder.innerHTML = '';
  project.scenes.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'order-row';
    row.tabIndex = 0;
    row.draggable = false;
    row.dataset.index = String(index);
    row.title = EDITOR_STRINGS.scenes.dragHint;
    row.appendChild(sceneThumbnail(entry, index));
    if (index > 0) row.appendChild(transitionControl(index, entry));
    const head = document.createElement('div');
    head.className = 'order-head';
    const name = document.createElement('div');
    name.className = 'order-name';
    name.textContent = `${index + 1}. ${entry.name}`;
    const duration = document.createElement('div');
    duration.className = 'order-duration';
    duration.textContent = EDITOR_STRINGS.scenes.seconds(entry.scene.duration.toFixed(1));
    head.append(name, duration);
    row.appendChild(head);
    row.appendChild(sceneVoiceBlock(entry));
    row.appendChild(sceneSfxBlock(entry));
    row.addEventListener('keydown', (event) => {
      if ((event.target as HTMLElement).closest('.voice-block, .order-transition')) return;
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      const target = event.key === 'ArrowLeft' ? index - 1 : index + 1;
      if (target < 0 || target >= project.scenes.length) return;
      reorderScene(index, target);
      focusSceneCard(target);
    });
    row.addEventListener('pointerdown', (event) => {
      if (canStartCardDrag(event.target as Element | null)) row.draggable = true;
    });
    row.addEventListener('mousedown', (event) => {
      if (canStartCardDrag(event.target as Element | null)) row.draggable = true;
    });
    row.addEventListener('dragstart', (event) => {
      if (!row.draggable) { event.preventDefault(); return; }
      event.dataTransfer?.setData('text/plain', String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
    });
    row.addEventListener('pointerup', () => { row.draggable = false; });
    row.addEventListener('pointercancel', () => { row.draggable = false; });
    row.addEventListener('blur', () => { row.draggable = false; });
    row.addEventListener('dragover', (event) => { event.preventDefault(); });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer?.getData('text/plain'));
      if (!Number.isInteger(from) || from === index) return;
      reorderScene(from, index);
      focusSceneCard(index);
    });
    sceneOrder.appendChild(row);
  });
  renderVoicePanel();
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
  if (project.subtitles && project.subtitles.enabled !== false) {
    const built = buildSubtitleCues(project);
    const cue = activeCueAt(built.cues, globalIndex / project.fps);
    if (cue) drawSubtitle(ctx, size.w, size.h, cue, project.subtitles, project.format);
  }
  if (projectScrub) projectScrub.value = seconds > 0 ? (spliceT / seconds).toFixed(2) : '0';
  if (projectTime) projectTime.textContent = EDITOR_STRINGS.splice.time(spliceT.toFixed(1), seconds.toFixed(1));
}

function renderCatalogTabs(active: string) {
  if (!catalogTabBar) return;
  catalogTabBar.innerHTML = '';
  const tabs: Array<[string, string]> = [['list', EDITOR_STRINGS.catalog.listTitle], ['preview', EDITOR_STRINGS.catalog.preview], ['newjson', EDITOR_STRINGS.catalog.newModelTitle], ['svg', EDITOR_STRINGS.catalog.svgImportTitle], ['upload', EDITOR_STRINGS.catalog.uploadTitle], ['modelprompt', EDITOR_STRINGS.catalog.modelPromptTab], ['credits', EDITOR_STRINGS.catalog.creditsTitle]];
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
    upload: catalogPanelUpload,
    modelprompt: catalogPanelModelPrompt,
    credits: catalogPanelCredits,
  };
  for (const [key, panel] of Object.entries(panels)) if (panel) panel.hidden = key !== id;
  renderCatalogTabs(id);
  if (id === 'list') renderCatalogList();
  else if (id === 'preview') { renderPreviewModelSelect(); loadCodeEditorFromSelection(); setPreviewPlaying(false); renderPreviewFrame(); }
  else if (id === 'upload') { catalogUploadDrop?.classList.remove('over'); void refreshUploadPanel(); }
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

/** Палитра миниатюр: цвета слотов берём из эталонной сцены — у моделей fill задают слотом («mid», «near», «window»). */
const thumbnailPalette: Palette = (demoScene as unknown as SceneV1).palette;

/** Средняя яркость заливок модели; null, если цвет не определить ни по hex, ни по слоту палитры. */
function averageFillLuminance(asset: CatalogAsset, palette: Palette): number | null {
  const values: number[] = [];
  for (const part of asset.parts ?? []) {
    const luminance = resolveFillLuminance(part.fill, palette);
    if (luminance !== null) values.push(luminance);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Яркость заливки так же, как её видит рендер: слот палитры → его цвет, иначе сам hex; null — если ни то ни другое. */
function resolveFillLuminance(fill: unknown, palette: Palette): number | null {
  if (typeof fill !== 'string' || fill === 'none') return null;
  return hexLuminance(col(fill, palette));
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
  const fillLuminance = averageFillLuminance(asset, thumbnailPalette);
  scene.palette = { ...thumbnailPalette, sky: fillLuminance !== null && fillLuminance > 0.7 ? ['#17141f', '#2c2735'] : ['#f4f1ea', '#dcd6ca'] };
  scene.world = { unitsPerMeter };
  scene.layers.unshift({ id: 'thumb-bg', name: EDITOR_STRINGS.scenes.background, depth: 0, visible: true, objects: [{ id: 'thumb-bg', name: EDITOR_STRINGS.scenes.background, kind: 'sky', x: 0, y: 0, s: 1 }] });
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
  catalogCount.textContent = EDITOR_STRINGS.catalog.modelsCount(rows.length);
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
    addBtn.textContent = EDITOR_STRINGS.catalog.addToSceneTitle;
    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.textContent = EDITOR_STRINGS.catalog.copyModelJson;
    const copyPromptBtn = document.createElement('button');
    copyPromptBtn.textContent = EDITOR_STRINGS.catalog.copyModelPrompt;
    actions.append(addBtn, copyJsonBtn, copyPromptBtn);
    row.append(img, info, actions);
    catalogList.appendChild(row);
    addBtn.onclick = () => addCatalogAssetToScene(entry);
    copyJsonBtn.onclick = () => void copyText(asset ? JSON.stringify(asset, null, 2) : `{}`, EDITOR_STRINGS.catalog.modelTitle(entry.name ?? entry.id));
    copyPromptBtn.onclick = () => {
      if (!asset) return;
      const prompt = buildPrompt(asset, { task: EDITOR_STRINGS.catalog.modelEditTask, scope: EDITOR_STRINGS.catalog.modelScope });
      void copyText(prompt, EDITOR_STRINGS.catalog.modelPromptCopy(asset.name));
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
  applyChange(EDITOR_STRINGS.catalog.addToScene(asset.name), () => { targetLayer.objects.push(object); });
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
  setCatalogStatus(catalogNewJsonStatus, result.ok ? EDITOR_STRINGS.catalog.saveReady : EDITOR_STRINGS.catalog.modelJsonErrors(result.errors.length), !result.ok);
}

function saveCatalogModel(asset: CatalogAsset, statusEl: HTMLElement | null = catalogNewJsonStatus) {
  const taken = new Set(Object.keys(catalog));
  let id = asset.id;
  if (taken.has(id)) {
    const overwrite = confirm(EDITOR_STRINGS.catalog.overwriteIdConfirm(id));
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
  setCatalogStatus(statusEl, EDITOR_STRINGS.catalog.savedAs(id), false);
  renderPreviewModelSelect();
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
    if (result.errors.length) setCatalogStatus(catalogSvgStatus, EDITOR_STRINGS.catalog.importErrors(result.errors.map((e) => `${e.path || ''}: ${e.message}`).join('; ')), true);
    else if (result.ok) setCatalogStatus(catalogSvgStatus, EDITOR_STRINGS.catalog.geometryReady(result.asset!.parts.length, result.warnings.length), false);
    else setCatalogStatus(catalogSvgStatus, EDITOR_STRINGS.catalog.importFailed, true);
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
  setCatalogStatus(catalogSvgStatus, EDITOR_STRINGS.catalog.imported(importedId), false);
}

// ---------- локальный сервис: загрузка моделей перетаскиванием ----------
const VIEWS: readonly string[] = ['side', 'bottom', 'front', 'top', 'three-quarter'];
/** Размер SVG из пачки: в drag-and-drop нет поля размера, поправимо в JSON модели. */
const SVG_UPLOAD_SIZE_M = 1.5;
let localApiReady: boolean | null = null;
let uploadInFlight = false;

async function checkLocalApi(): Promise<boolean> {
  try {
    const response = await fetch('/__api/ping', { headers: { accept: 'application/json' } });
    const data = (await response.json()) as { ok?: boolean; version?: number };
    localApiReady = response.ok && data.ok === true && data.version === 1;
  } catch {
    localApiReady = false;
  }
  return localApiReady;
}

async function localApiAvailable(): Promise<boolean> {
  return localApiReady === null ? checkLocalApi() : localApiReady;
}

interface CatalogAddReply {
  ok: boolean;
  id?: string;
  errors?: Array<{ path: string; message: string }>;
}

async function postCatalogAdd(model: unknown, overwrite: boolean): Promise<CatalogAddReply> {
  try {
    const response = await fetch('/__api/catalog/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, overwrite }),
    });
    const text = await response.text();
    try {
      return JSON.parse(text) as CatalogAddReply;
    } catch {
      return { ok: false, errors: [{ path: '', message: EDITOR_STRINGS.errors.serverNotJson(response.status) }] };
    }
  } catch (error) {
    localApiReady = false;
    return { ok: false, errors: [{ path: '', message: EDITOR_STRINGS.errors.serverUnavailable(error instanceof Error ? error.message : String(error)) }] };
  }
}

function issueMessage(errors: CatalogAddReply['errors']): string {
  const first = errors?.[0];
  if (!first) return EDITOR_STRINGS.catalog.serverRejectedModel;
  return `${first.path ? `${first.path}: ` : ''}${first.message}`;
}

function addUploadResult(fileName: string, message: string, isOk: boolean): void {
  if (!catalogUploadResults) return;
  const item = document.createElement('li');
  item.className = isOk ? 'ok' : 'bad';
  item.textContent = `${isOk ? '✔' : '✖'} ${fileName}: ${message}`;
  catalogUploadResults.appendChild(item);
}

async function buildModelForUpload(file: File, license: { name: string; author: string; source: string }): Promise<{ model?: unknown; error?: string }> {
  const text = await file.text();
  if (/\.svg$/i.test(file.name)) {
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const slug = baseName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
    const result = buildSvgModel(text, {
      id: slug, name: baseName, view: 'side', sizeM: SVG_UPLOAD_SIZE_M, sizeAxis: 'height', tags: [],
      license: { ...license, attribution: false },
    });
    if (!result.ok || !result.asset) return { error: result.errors.map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join('; ') || EDITOR_STRINGS.catalog.svgNotRecognized };
    return { model: result.asset };
  }
  if (/\.json$/i.test(file.name) || /\.json$/i.test(file.type)) {
    try {
      return { model: extractJson(text) };
    } catch (error) {
      return { error: EDITOR_STRINGS.errors.jsonParseLower(error instanceof Error ? error.message : String(error)) };
    }
  }
  return { error: EDITOR_STRINGS.catalog.onlyJsonSvg };
}

async function uploadCatalogFiles(files: readonly File[]): Promise<void> {
  if (uploadInFlight || files.length === 0) return;
  uploadInFlight = true;
  if (catalogUploadResults) catalogUploadResults.innerHTML = '';
  try {
    if (!(await localApiAvailable())) {
      setCatalogStatus(catalogUploadStatus, EDITOR_STRINGS.catalog.uploadOfflineLong, true);
      return;
    }
    const license = {
      name: (catalogUploadLicense?.value ?? '').trim() || 'own',
      author: (catalogUploadAuthor?.value ?? '').trim() || 'project',
      source: (catalogUploadSource?.value ?? '').trim(),
    };
    let added = 0;
    for (const file of files) {
      const prepared = await buildModelForUpload(file, license);
      if (!prepared.model) {
        addUploadResult(file.name, prepared.error ?? EDITOR_STRINGS.catalog.fileRejected, false);
        continue;
      }
      const candidateId = String((prepared.model as CatalogAsset).id ?? '');
      const taken = Object.prototype.hasOwnProperty.call(catalog, candidateId);
      const overwrite = taken && confirm(EDITOR_STRINGS.catalog.overwriteModelConfirm(candidateId));
      const reply = await postCatalogAdd(prepared.model, overwrite);
      if (reply.ok) {
        added++;
        addUploadResult(file.name, EDITOR_STRINGS.catalog.uploadAdded(reply.id), true);
      } else {
        addUploadResult(file.name, issueMessage(reply.errors), false);
      }
    }
    if (added > 0) {
      setCatalogStatus(catalogUploadStatus, EDITOR_STRINGS.catalog.addedReload(added, EDITOR_STRINGS.project.reloadHint), false);
      saveAutosave();
      if (isExportInFlight()) {
        setCatalogStatus(catalogUploadStatus, `${EDITOR_STRINGS.catalog.addedReload(added, EDITOR_STRINGS.project.reloadHint)} · ${EDITOR_STRINGS.project.saveAll.waitExport}`, false);
      } else {
        window.setTimeout(() => location.reload(), 800);
      }
    } else {
      setCatalogStatus(catalogUploadStatus, EDITOR_STRINGS.catalog.addedNone, true);
    }
  } finally {
    uploadInFlight = false;
  }
}

async function refreshUploadPanel(): Promise<void> {
  const online = await localApiAvailable();
  if (online) setCatalogStatus(catalogUploadStatus, EDITOR_STRINGS.catalog.uploadReady, false);
  else setCatalogStatus(catalogUploadStatus, EDITOR_STRINGS.catalog.uploadOfflineLong, true);
}

/** Первый объект kind shape с таким id или именем, из которого можно собрать модель каталога. */
function findShapeModel(id: string): { name: string; model: Record<string, unknown> } | null {
  for (const entry of project.scenes) {
    for (const layer of entry.scene.layers) {
      for (const object of layer.objects) {
        if (object.kind !== 'shape' || (object.id !== id && object.name !== id)) continue;
        const model = (object.params as Record<string, unknown> | undefined)?.model;
        if (model && typeof model === 'object' && !Array.isArray(model)) return { name: object.name, model: model as Record<string, unknown> };
      }
    }
  }
  return null;
}

function suggestionToModel(suggestion: { id: string; description: string; view?: string; sizeM?: number }): unknown | null {
  const shape = findShapeModel(suggestion.id);
  if (!shape) return null;
  return {
    version: 1,
    id: suggestion.id,
    name: shape.name || suggestion.id,
    bounds: shape.model.bounds,
    realSize: { heightM: suggestion.sizeM ?? SVG_UPLOAD_SIZE_M },
    meta: {
      view: VIEWS.includes(suggestion.view ?? '') ? suggestion.view : 'side',
      tags: [suggestion.id],
      license: { name: 'own', author: 'project', source: '', attribution: false },
    },
    parts: shape.model.parts,
  };
}

// ---------- локальный сервис: экспорт MP4 кнопкой ----------
interface ExportReply {
  ok: boolean;
  jobId?: string;
  state?: 'running' | 'done' | 'error' | 'cancelled';
  frame?: number;
  total?: number;
  file?: string;
  message?: string;
  errors?: Array<{ path: string; message: string }>;
}

let exportJobId: string | null = null;
let exportSubmitting = false;
let exportPollTimer: number | null = null;
let exportLastIsProbe = false;
let exportLastIsFrame = false;

/** Экспорт идёт: POST проекта (id ещё не вернулся) или живое задание на сервисе. */
function isExportInFlight(): boolean {
  return exportSubmitting || exportJobId !== null;
}

function setExportStatus(message: string): void {
  if (!exportStatusEl) return;
  exportStatusEl.textContent = message;
}

function stopExportPolling(): void {
  if (exportPollTimer === null) return;
  window.clearTimeout(exportPollTimer);
  exportPollTimer = null;
}

async function fetchExportJson(url: string, init?: RequestInit): Promise<ExportReply> {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    try {
      return JSON.parse(text) as ExportReply;
    } catch {
      return { ok: false, errors: [{ path: '', message: EDITOR_STRINGS.errors.serverNotJson(response.status) }] };
    }
  } catch (error) {
    localApiReady = false;
    return { ok: false, errors: [{ path: '', message: EDITOR_STRINGS.errors.serverUnavailable(error instanceof Error ? error.message : String(error)) }] };
  }
}

function projectDurationSec(): number {
  return projectFrameCount(project) / project.fps;
}

type ExportMode = 'all' | 'range' | 'frame';

function exportPreviewPayload(): { ok: true; preview?: { frame?: number; range?: { from: number; to: number }; scale?: number }; probe: boolean; frame: boolean } | { ok: false; message: string } {
  const mode = (exportMode?.value as ExportMode) || 'all';
  const scale = Number(exportScale?.value ?? '1');
  const dur = projectDurationSec();
  const isProbe = mode !== 'all' || scale !== 1;
  if (mode === 'frame') {
    const frame = Number(exportFrameAt?.value ?? '0');
    if (!Number.isFinite(frame) || frame < 0 || frame >= dur) return { ok: false, message: EDITOR_STRINGS.preview.frameOutOfRange(frame, dur.toFixed(3)) };
    return { ok: true, preview: { frame, ...(scale !== 1 ? { scale } : {}) }, probe: isProbe, frame: true };
  }
  if (mode === 'range') {
    const from = Number(exportFrom?.value ?? '0');
    const to = Number(exportTo?.value ?? '0');
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return { ok: false, message: EDITOR_STRINGS.preview.badRange };
    if (to > dur + 1e-9) return { ok: false, message: EDITOR_STRINGS.preview.rangeTooLong(to, dur.toFixed(3)) };
    return { ok: true, preview: { range: { from, to }, ...(scale !== 1 ? { scale } : {}) }, probe: isProbe, frame: false };
  }
  if (scale !== 1) return { ok: true, preview: { scale }, probe: true, frame: false };
  return { ok: true, probe: false, frame: false };
}

function updateExportUi(): void {
  const mode = (exportMode?.value as ExportMode) || 'all';
  if (exportFromLabel) exportFromLabel.hidden = mode !== 'range';
  if (exportToLabel) exportToLabel.hidden = mode !== 'range';
  if (exportFrameLabel) exportFrameLabel.hidden = mode !== 'frame';
  const payload = exportPreviewPayload();
  if (exportMp4Btn) exportMp4Btn.textContent = payload.ok && payload.probe ? EDITOR_STRINGS.export.btnProbe : EDITOR_STRINGS.export.btnMp4;
}

let exportUiReady = false;

/** Длительность ролика меняется при правках; поля пробы подстраиваем при каждом заходе на вкладку, выбор пользователя не трогаем. */
function syncExportDuration(): void {
  const dur = projectDurationSec();
  const defaultTo = Math.min(5, Math.floor(dur * 10) / 10);
  if (exportTo && (exportTo.value === '' || Number(exportTo.value) <= 0 || Number(exportTo.value) > dur)) exportTo.value = String(defaultTo);
  if (exportFrameAt) exportFrameAt.max = String(Math.max(0, dur - 1 / Math.max(1, project.fps)));
  if (exportFrom) exportFrom.max = String(dur);
  if (exportTo) exportTo.max = String(dur);
  updateExportUi();
}

function initExportUi(): void {
  if (exportUiReady) { syncExportDuration(); return; }
  exportUiReady = true;
  if (exportModeText) exportModeText.textContent = EDITOR_STRINGS.export.mode;
  if (exportFromText) exportFromText.textContent = EDITOR_STRINGS.export.from;
  if (exportToText) exportToText.textContent = EDITOR_STRINGS.export.to;
  if (exportFrameText) exportFrameText.textContent = EDITOR_STRINGS.export.frameAt;
  if (exportScaleText) exportScaleText.textContent = EDITOR_STRINGS.export.scale;
  if (exportHintEl) exportHintEl.textContent = EDITOR_STRINGS.export.hint;
  if (exportMode) {
    exportMode.textContent = '';
    for (const [value, label] of [['all', EDITOR_STRINGS.export.modeAll], ['range', EDITOR_STRINGS.export.modeRange], ['frame', EDITOR_STRINGS.export.modeFrame]] as const) {
      const opt = document.createElement('option'); opt.value = value; opt.textContent = label; exportMode.appendChild(opt);
    }
  }
  if (exportScale) {
    exportScale.textContent = '';
    for (const [value, label] of [['1', '100%'], ['0.5', '50%'], ['0.25', '25%']] as const) {
      const opt = document.createElement('option'); opt.value = value; opt.textContent = label; exportScale.appendChild(opt);
    }
  }
  for (const el of [exportMode, exportFrom, exportTo, exportFrameAt, exportScale]) el?.addEventListener('change', updateExportUi);
  for (const el of [exportFrom, exportTo, exportFrameAt]) el?.addEventListener('input', updateExportUi);
  syncExportDuration();
}

function showExportResult(reply: ExportReply): void {
  if (exportMp4Btn) exportMp4Btn.disabled = false;
  if (exportCancelBtn) exportCancelBtn.hidden = true;
  if (reply.state === 'done') {
    if (exportDownload) {
      exportDownload.href = `/__api/export/file?id=${encodeURIComponent(exportJobId ?? '')}`;
      exportDownload.textContent = exportLastIsProbe
        ? (exportLastIsFrame ? EDITOR_STRINGS.export.downloadProbePng : EDITOR_STRINGS.export.downloadProbeMp4)
        : EDITOR_STRINGS.export.downloadMp4;
      exportDownload.hidden = false;
    }
    const done = exportLastIsProbe ? `${EDITOR_STRINGS.export.probeNote}; ${reply.file}` : EDITOR_STRINGS.export.done(reply.file);
    setExportStatus(done);
  } else if (reply.state === 'cancelled') {
    setExportStatus(EDITOR_STRINGS.export.cancelled);
  } else {
    setExportStatus(reply.message || issueMessage(reply.errors));
  }
  exportJobId = null;
  syncVoiceButtons();
}

async function pollExportStatus(): Promise<void> {
  if (!exportJobId) return;
  const reply = await fetchExportJson(`/__api/export/status?id=${encodeURIComponent(exportJobId)}`);
  if (!reply.ok || !reply.state) {
    showExportResult(reply);
    return;
  }
  if (reply.state === 'running') {
    setExportStatus(reply.total ? EDITOR_STRINGS.export.frameProgress(reply.frame, reply.total) : EDITOR_STRINGS.export.assembling);
    exportPollTimer = window.setTimeout(() => void pollExportStatus(), 500);
    return;
  }
  showExportResult(reply);
}

async function startExport(): Promise<void> {
  if (isExportInFlight()) return;
  if (exportDownload) exportDownload.hidden = true;
  if (!(await localApiAvailable())) {
    if (exportMp4Btn) exportMp4Btn.disabled = true;
    setExportStatus(EDITOR_STRINGS.export.offline);
    return;
  }
  const payload = exportPreviewPayload();
  if (!payload.ok) { setExportStatus(payload.message); return; }
  exportLastIsProbe = payload.probe;
  exportLastIsFrame = payload.frame;
  setExportStatus(EDITOR_STRINGS.export.sending);
  exportSubmitting = true;
  syncVoiceButtons();
  const reply = await fetchExportJson('/__api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: structuredClone(project), ...(payload.preview ? { preview: payload.preview } : {}) }),
  });
  exportSubmitting = false;
  if (!reply.ok || !reply.jobId) {
    setExportStatus(reply.ok ? EDITOR_STRINGS.export.noJobId : issueMessage(reply.errors));
    if (exportMp4Btn) exportMp4Btn.disabled = false;
    syncVoiceButtons();
    return;
  }
  exportJobId = reply.jobId;
  if (exportMp4Btn) exportMp4Btn.disabled = true;
  if (exportCancelBtn) exportCancelBtn.hidden = false;
  setExportStatus(payload.probe ? EDITOR_STRINGS.export.probeStarting(EDITOR_STRINGS.export.probeNote) : EDITOR_STRINGS.export.started);
  await pollExportStatus();
}

/** Полный экспорт «как по кнопке»: вкладка склейки, режим «Весь ролик», 100% — и тот же startExport. */
async function startFullExport(): Promise<void> {
  setTopTab('splice');
  if (exportMode) exportMode.value = 'all';
  if (exportScale) exportScale.value = '1';
  updateExportUi();
  await startExport();
}

async function cancelExport(): Promise<void> {
  if (!exportJobId) return;
  stopExportPolling();
  const reply = await fetchExportJson(`/__api/export/cancel?id=${encodeURIComponent(exportJobId)}`, { method: 'POST' });
  showExportResult({ ...reply, state: reply.state ?? 'cancelled' });
}

/** Кнопка активна только когда отвечает локальный сервис; офлайн остаётся подсказка про npm run export. */
async function refreshExportPanel(): Promise<void> {
  initExportUi();
  if (isExportInFlight()) return;
  const online = await localApiAvailable();
  // за время ping экспорт мог стартовать (авто-экспорт после «Создать одной кнопкой») — панель не трогаем
  if (isExportInFlight()) return;
  if (exportMp4Btn) exportMp4Btn.disabled = !online;
  setExportStatus(online ? '' : EDITOR_STRINGS.export.offline);
}

// ---------- voice panel: scene TTS and project music ----------
interface TtsAdapterInfo {
  id: string;
  label: string;
  ok: boolean;
  reason?: string;
}

interface VoiceSynthesizeReply {
  ok?: boolean;
  file?: string;
  durationSec?: number;
  words?: VoiceWord[];
  cached?: boolean;
  warnings?: string[];
  errors?: Array<{ path?: string; message?: string }>;
}

const VOICE_TEXT_MAX = 2000;
let voiceAdapters: TtsAdapterInfo[] = [];
let voiceAdaptersState: 'unknown' | 'online' | 'offline' = 'unknown';
let voiceAdaptersError = '';
let voiceBatchStatusEl: HTMLElement | null = null;
let voiceAudioFiles: string[] = [];
let voiceAudioState: 'unknown' | 'online' | 'offline' = 'unknown';
let voiceSynthBusy = false;
const voiceSceneStatus = new Map<string, { message: string; kind: 'ok' | 'warn' | 'err' }>();
const voiceOpenState = new Map<string, boolean>();
const voiceAdapterChoice = new Map<string, string>();
const sfxOpenState = new Map<string, boolean>();
const sfxAudioFiles: string[] = [];
let sfxAudioState: 'unknown' | 'online' | 'offline' = 'unknown';

function voiceIssueMessage(errors: Array<{ path?: string; message?: string }> | undefined): string {
  const first = errors?.[0];
  if (!first) return '';
  return `${first.path ? `${first.path}: ` : ''}${first.message ?? ''}`;
}

interface VoiceFetchResult<T> {
  ok: boolean;
  data?: T;
  message: string;
}

async function voiceFetch<T>(url: string, init?: RequestInit): Promise<VoiceFetchResult<T>> {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, message: EDITOR_STRINGS.errors.serverNotJson(response.status) };
    }
    if (!response.ok) {
      const errors = (data as { errors?: Array<{ path?: string; message?: string }> }).errors;
      return { ok: false, data: data as T, message: voiceIssueMessage(errors) || `HTTP ${response.status}` };
    }
    return { ok: true, data: data as T, message: '' };
  } catch (error) {
    localApiReady = false;
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function availableVoiceAdapters(): TtsAdapterInfo[] {
  return voiceAdapters.filter((adapter) => adapter.ok);
}

async function loadVoiceAdapters(): Promise<void> {
  const reply = await voiceFetch<{ ok?: boolean; adapters?: TtsAdapterInfo[] }>('/__api/tts/adapters', { headers: { accept: 'application/json' } });
  if (reply.ok && reply.data?.ok === true && Array.isArray(reply.data.adapters)) {
    voiceAdapters = reply.data.adapters;
    voiceAdaptersState = 'online';
    voiceAdaptersError = availableVoiceAdapters().length === 0
      ? EDITOR_STRINGS.voice.noAdapter(voiceAdapters.map((adapter) => `${adapter.label}: ${adapter.reason ?? ''}`).join('; '))
      : '';
  } else {
    voiceAdaptersState = 'offline';
    voiceAdaptersError = EDITOR_STRINGS.voice.adaptersFailed(reply.message);
  }
}

async function loadVoiceAudio(): Promise<void> {
  const reply = await voiceFetch<{ ok?: boolean; files?: string[] }>('/__api/audio/list', { headers: { accept: 'application/json' } });
  if (reply.ok && reply.data?.ok === true && Array.isArray(reply.data.files)) {
    const files = reply.data.files;
    voiceAudioFiles = files;
    voiceAudioState = 'online';
    sfxAudioFiles.length = 0;
    sfxAudioFiles.push(...files.filter((file) => file.startsWith('sfx/')));
    sfxAudioState = 'online';
  } else {
    voiceAudioState = 'offline';
    sfxAudioState = 'offline';
  }
}

async function refreshVoicePanel(): Promise<void> {
  renderSceneOrder();
  renderVoicePanel();
  if (!(await localApiAvailable())) {
    voiceAdaptersState = 'offline';
    voiceAudioState = 'offline';
    renderSceneOrder();
    renderVoicePanel();
    return;
  }
  await Promise.all([loadVoiceAdapters(), loadVoiceAudio()]);
  renderSceneOrder();
  renderVoicePanel();
}

function findProjectScene(sceneId: string): ProjectSceneV1 | undefined {
  return project.scenes.find((entry) => entry.id === sceneId);
}

function voiceStatusElement(sceneId: string): HTMLElement | null {
  return sceneOrder?.querySelector<HTMLElement>(`.voice-block[data-scene-id="${sceneId}"] .voice-status`) ?? null;
}

function syncVoiceButtons(): void {
  const busy = voiceSynthBusy || isExportInFlight();
  for (const button of document.querySelectorAll<HTMLButtonElement>('.voice-synth, .voice-remove, .voice-synth-all')) {
    button.disabled = busy || button.dataset.voiceDisabled === '1';
  }
}

function applySceneVoiceText(sceneId: string, rawText: string): void {
  const entry = findProjectScene(sceneId);
  if (!entry) return;
  const text = rawText.trim();
  if (text === (entry.voice?.text ?? '').trim()) return;
  voiceSceneStatus.delete(sceneId);
  applyChange('scene-voice-text', () => {
    if (!text) {
      if (!entry.voice) return;
      delete entry.voice.text;
      if (!entry.voice.file) delete entry.voice;
      return;
    }
    entry.voice = { ...(entry.voice ?? {}), text };
  });
}

function applySceneVoiceNumber(sceneId: string, field: 'offset' | 'gain', value: number): void {
  const entry = findProjectScene(sceneId);
  if (!entry?.voice) return;
  const limit = field === 'gain' ? 2 : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(value) || value < 0 || value > limit) return;
  if ((entry.voice[field] ?? (field === 'gain' ? 1 : 0)) === value) return;
  applyChange(`scene-voice-${field}`, () => {
    if (entry.voice) entry.voice[field] = value;
  });
}

function removeSceneVoice(sceneId: string, name: string): void {
  const entry = findProjectScene(sceneId);
  const voice = entry?.voice;
  if (!voice) return;
  if (!confirm(EDITOR_STRINGS.voice.removeConfirm(name))) return;
  voiceSceneStatus.delete(sceneId);
  applyChange('scene-voice-remove', () => {
    delete voice.file;
    delete voice.words;
    delete voice.offset;
    delete voice.gain;
    delete voice.spokenText;
    if (Object.keys(voice).length === 0) delete entry.voice;
  });
}

function applyProjectMusic(file: string): void {
  const music = project.audio?.music;
  if (!file) {
    if (!music) return;
    applyChange('project-music', () => {
      if (!project.audio) return;
      delete project.audio.music;
      if (Object.keys(project.audio).length === 0) delete project.audio;
    });
    return;
  }
  if (music?.file === file) return;
  applyChange('project-music', () => {
    const audio = { ...(project.audio ?? {}) };
    audio.music = { ...(audio.music ?? {}), file };
    project.audio = audio;
  });
}

function applyProjectMusicGain(value: number): void {
  const music = project.audio?.music;
  if (!music || !Number.isFinite(value) || value < 0 || value > 1 || music.gain === value) return;
  applyChange('project-music-gain', () => {
    music.gain = value;
  });
}

function applyProjectMusicDuck(value: boolean): void {
  const music = project.audio?.music;
  if (!music || music.duck === value) return;
  applyChange('project-music-duck', () => {
    music.duck = value;
  });
}

async function synthesizeSceneVoice(sceneId: string, rawText: string, adapterId: string, status: HTMLElement): Promise<void> {
  const setStatus = (message: string, kind?: 'ok' | 'warn' | 'err') => {
    status.textContent = message;
    status.classList.toggle('err', kind === 'err');
    status.classList.toggle('warn', kind === 'warn');
    status.classList.toggle('ok', kind === 'ok');
  };
  if (voiceSynthBusy) { setStatus(EDITOR_STRINGS.voice.busy, 'warn'); return; }
  if (isExportInFlight()) { setStatus(EDITOR_STRINGS.voice.busyExport, 'warn'); return; }
  const text = rawText.trim();
  if (!text) { setStatus(EDITOR_STRINGS.voice.emptyText, 'warn'); return; }
  if (voiceAdaptersState !== 'online') { setStatus(EDITOR_STRINGS.voice.offline, 'err'); return; }
  voiceSynthBusy = true;
  setStatus(EDITOR_STRINGS.voice.synthesizing);
  syncVoiceButtons();
  try {
    const reply = await voiceFetch<VoiceSynthesizeReply>('/__api/tts/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(adapterId ? { adapter: adapterId } : {}) }),
    });
    if (!reply.ok || reply.data?.ok !== true || !reply.data.file) {
      setStatus(voiceIssueMessage(reply.data?.errors) || reply.message, 'err');
      return;
    }
    const data = reply.data;
    const entry = findProjectScene(sceneId);
    if (!entry) { setStatus(EDITOR_STRINGS.voice.sceneMissing, 'err'); return; }
    if ((entry.voice?.text ?? '').trim() !== text) { setStatus(EDITOR_STRINGS.voice.textChanged, 'err'); return; }
    const seconds = Number(data.durationSec ?? 0).toFixed(2);
    const words = Array.isArray(data.words) ? data.words.length : 0;
    let message = data.cached ? EDITOR_STRINGS.voice.cached(seconds, words) : EDITOR_STRINGS.voice.fresh(seconds, words);
    const end = Number(entry.voice?.offset ?? 0) + Number(data.durationSec ?? 0);
    const tooLong = end > entry.scene.duration + 1e-6;
    if (tooLong) message += `; ${EDITOR_STRINGS.voice.tooLong((end - entry.scene.duration).toFixed(2))}`;
    voiceSceneStatus.set(sceneId, { message, kind: tooLong ? 'warn' : 'ok' });
    setStatus(message, tooLong ? 'warn' : 'ok');
    applyChange('scene-voice-synthesize', () => {
      applyVoiceResult(entry, text, { file: data.file as string, words: data.words as VoiceWord[], durationSec: Number(data.durationSec ?? 0), cached: data.cached ?? false });
    });
  } finally {
    voiceSynthBusy = false;
    syncVoiceButtons();
  }
}

async function synthesizeAllScenes(): Promise<void> {
  if (voiceSynthBusy) { setStatus(EDITOR_STRINGS.voice.busy, true); return; }
  if (isExportInFlight()) { setStatus(EDITOR_STRINGS.voice.busyExport, true); return; }
  if (voiceAdaptersState !== 'online' || availableVoiceAdapters().length === 0) {
    setStatus(EDITOR_STRINGS.voice.batchNoAdapter, true);
    if (voiceBatchStatusEl) voiceBatchStatusEl.textContent = EDITOR_STRINGS.voice.batchNoAdapter;
    return;
  }
  const plan = voiceBatchPlan(project);
  if (plan.todo.length === 0) {
    setStatus(EDITOR_STRINGS.voice.batchNoText, true);
    if (voiceBatchStatusEl) voiceBatchStatusEl.textContent = EDITOR_STRINGS.voice.batchNoText;
    return;
  }
  const adapterId = availableVoiceAdapters()[0]?.id ?? '';
  const projectSnapshot = project;
  const sceneById = new Map(project.scenes.map((entry) => [entry.id, entry]));
  voiceSynthBusy = true;
  syncVoiceButtons();
  const total = plan.todo.length;
  try {
    const result = await runVoiceBatch(plan, async (sceneId, text) => {
      if (project !== projectSnapshot) throw new Error(EDITOR_STRINGS.voice.batchProjectReloaded);
      const entry = sceneById.get(sceneId);
      if (!entry || !project.scenes.includes(entry)) throw new Error(EDITOR_STRINGS.voice.batchSceneMissing);
      const statusEl = voiceStatusElement(sceneId);
      const reply = await voiceFetch<VoiceSynthesizeReply>('/__api/tts/synthesize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, ...(adapterId ? { adapter: adapterId } : {}) }),
      });
      if (!reply.ok || reply.data?.ok !== true || !reply.data.file) {
        throw new Error(voiceIssueMessage(reply.data?.errors) || reply.message);
      }
      const data = reply.data;
      if (project !== projectSnapshot) throw new Error(EDITOR_STRINGS.voice.batchProjectReloaded);
      const entry2 = sceneById.get(sceneId);
      if (!entry2 || !project.scenes.includes(entry2)) throw new Error(EDITOR_STRINGS.voice.batchSceneMissing);
      if ((entry2.voice?.text ?? '').trim() !== text) throw new Error(EDITOR_STRINGS.voice.textChanged);
      const seconds = Number(data.durationSec ?? 0).toFixed(2);
      const words = Array.isArray(data.words) ? data.words.length : 0;
      let message = data.cached ? EDITOR_STRINGS.voice.cached(seconds, words) : EDITOR_STRINGS.voice.fresh(seconds, words);
      const end = Number(entry2.voice?.offset ?? 0) + Number(data.durationSec ?? 0);
      const tooLong = end > entry2.scene.duration + 1e-6;
      if (tooLong) message += `; ${EDITOR_STRINGS.voice.tooLong((end - entry2.scene.duration).toFixed(2))}`;
      voiceSceneStatus.set(sceneId, { message, kind: tooLong ? 'warn' : 'ok' });
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.classList.toggle('ok', !tooLong);
        statusEl.classList.toggle('warn', tooLong);
        statusEl.classList.toggle('err', false);
      }
      applyChange('scene-voice-synthesize', () => {
        applyVoiceResult(entry2, text, { file: data.file as string, words: data.words as VoiceWord[], durationSec: Number(data.durationSec ?? 0), cached: data.cached ?? false });
      });
      return { file: data.file as string, words: data.words as VoiceWord[], durationSec: Number(data.durationSec ?? 0), cached: data.cached ?? false };
    }, {
      onProgress: (d, t) => { if (voiceBatchStatusEl) voiceBatchStatusEl.textContent = EDITOR_STRINGS.voice.batchProgress(d, t); },
      onSceneResult: (sceneId, result) => {
        if ('error' in result) {
          const message = result.error;
          voiceSceneStatus.set(sceneId, { message, kind: 'err' });
          const statusEl = voiceStatusElement(sceneId);
          if (statusEl) {
            statusEl.textContent = message;
            statusEl.classList.toggle('err', true);
            statusEl.classList.toggle('ok', false);
            statusEl.classList.toggle('warn', false);
          }
        }
      },
      shouldAbort: () => project !== projectSnapshot,
    });
    const summary = EDITOR_STRINGS.voice.batchResult(result.ok, result.skipped, result.errors, result.seconds, plan.stale);
    if (voiceBatchStatusEl) voiceBatchStatusEl.textContent = summary;
    setStatus(summary, result.errors > 0);
  } finally {
    voiceSynthBusy = false;
    syncVoiceButtons();
  }
}

function sceneVoiceBlock(entry: ProjectSceneV1): HTMLElement {
  const block = document.createElement('details');
  block.className = 'voice-block';
  block.dataset.sceneId = entry.id;
  block.open = voiceOpenState.get(entry.id) ?? Boolean(entry.voice?.file);
  block.addEventListener('toggle', () => voiceOpenState.set(entry.id, block.open));
  block.addEventListener('dragstart', (event) => event.preventDefault());

  const summary = document.createElement('summary');
  summary.textContent = EDITOR_STRINGS.voice.title;
  block.appendChild(summary);

  const voice = entry.voice;
  const status = document.createElement('div');
  status.className = 'msg voice-status';
  const savedStatus = voiceSceneStatus.get(entry.id);
  if (savedStatus) {
    status.textContent = savedStatus.message;
    status.classList.toggle('ok', savedStatus.kind === 'ok');
    status.classList.toggle('warn', savedStatus.kind === 'warn');
    status.classList.toggle('err', savedStatus.kind === 'err');
  }

  const textLabel = document.createElement('label');
  textLabel.className = 'f';
  const textTitle = document.createElement('span');
  textTitle.textContent = EDITOR_STRINGS.voice.textLabel;
  const counter = document.createElement('span');
  counter.className = 'hint voice-counter';
  textTitle.appendChild(counter);
  const textArea = document.createElement('textarea');
  textArea.rows = 3;
  textArea.maxLength = VOICE_TEXT_MAX;
  textArea.value = voice?.text ?? '';
  textArea.setAttribute('aria-label', EDITOR_STRINGS.voice.ariaText(entry.name));
  const syncCounter = () => { counter.textContent = EDITOR_STRINGS.voice.counter(textArea.value.length, VOICE_TEXT_MAX); };
  syncCounter();
  textArea.addEventListener('input', syncCounter);
  textArea.addEventListener('change', () => applySceneVoiceText(entry.id, textArea.value));
  textLabel.append(textTitle, textArea);
  block.appendChild(textLabel);

  const hasVoice = Boolean((voice?.text ?? '').trim() || voice?.file);
  const bar = document.createElement('div');
  bar.className = 'bar';

  const offsetLabel = document.createElement('label');
  offsetLabel.className = 'f';
  const offsetTitle = document.createElement('span');
  offsetTitle.textContent = EDITOR_STRINGS.voice.offsetLabel;
  const offset = document.createElement('input');
  offset.type = 'number';
  offset.min = '0';
  offset.step = '0.1';
  offset.style.width = '72px';
  offset.value = String(voice?.offset ?? 0);
  offset.disabled = !hasVoice;
  offset.setAttribute('aria-label', EDITOR_STRINGS.voice.ariaOffset(entry.name));
  offset.addEventListener('change', () => applySceneVoiceNumber(entry.id, 'offset', Number(offset.value)));
  offsetLabel.append(offsetTitle, offset);

  const gainLabel = document.createElement('label');
  gainLabel.className = 'f';
  const gainTitle = document.createElement('span');
  gainTitle.textContent = EDITOR_STRINGS.voice.gainLabel;
  const gain = document.createElement('input');
  gain.type = 'number';
  gain.min = '0';
  gain.max = '2';
  gain.step = '0.05';
  gain.style.width = '72px';
  gain.value = String(voice?.gain ?? 1);
  gain.disabled = !hasVoice;
  gain.setAttribute('aria-label', EDITOR_STRINGS.voice.ariaGain(entry.name));
  gain.addEventListener('change', () => applySceneVoiceNumber(entry.id, 'gain', Number(gain.value)));
  gainLabel.append(gainTitle, gain);

  const adapterLabel = document.createElement('label');
  adapterLabel.className = 'f';
  const adapterTitle = document.createElement('span');
  adapterTitle.textContent = EDITOR_STRINGS.voice.adapterLabel;
  const select = document.createElement('select');
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = EDITOR_STRINGS.voice.adapterAuto;
  select.appendChild(auto);
  for (const adapter of voiceAdapters) {
    const option = document.createElement('option');
    option.value = adapter.id;
    option.textContent = adapter.ok ? adapter.label : `${adapter.label} — ${adapter.reason ?? ''}`;
    option.disabled = !adapter.ok;
    select.appendChild(option);
  }
  const chosen = voiceAdapterChoice.get(entry.id) ?? '';
  select.value = voiceAdapters.some((adapter) => adapter.id === chosen && adapter.ok) ? chosen : '';
  select.disabled = voiceAdaptersState !== 'online' || availableVoiceAdapters().length === 0;
  select.title = voiceAdaptersState === 'online' ? voiceAdaptersError : EDITOR_STRINGS.voice.offline;
  select.setAttribute('aria-label', EDITOR_STRINGS.voice.ariaAdapter(entry.name));
  select.addEventListener('change', () => voiceAdapterChoice.set(entry.id, select.value));
  adapterLabel.append(adapterTitle, select);

  bar.append(offsetLabel, gainLabel, adapterLabel);
  block.appendChild(bar);

  const buttons = document.createElement('div');
  buttons.className = 'btns';
  const synth = document.createElement('button');
  synth.type = 'button';
  synth.className = 'voice-synth primary';
  synth.textContent = EDITOR_STRINGS.voice.synthesize;
  synth.setAttribute('aria-label', EDITOR_STRINGS.voice.ariaSynthesize(entry.name));
  synth.addEventListener('mousedown', (event) => event.preventDefault());
  const updateSynthState = () => {
    const noAdapters = voiceAdaptersState !== 'online' || availableVoiceAdapters().length === 0;
    const base = noAdapters || !textArea.value.trim();
    synth.dataset.voiceDisabled = base ? '1' : '0';
    synth.disabled = base || voiceSynthBusy || isExportInFlight();
    if (base) {
      if (voiceAdaptersState !== 'online') synth.title = voiceAdaptersError || EDITOR_STRINGS.voice.offline;
      else if (availableVoiceAdapters().length === 0) synth.title = EDITOR_STRINGS.voice.noAdapter(voiceAdapters.map((a) => `${a.label}: ${a.reason ?? ''}`).join('; '));
      else synth.title = EDITOR_STRINGS.voice.emptyText;
    } else synth.title = '';
  };
  synth.addEventListener('click', () => {
    const text = textArea.value;
    applySceneVoiceText(entry.id, text);
    const statusEl = voiceStatusElement(entry.id) ?? status;
    void synthesizeSceneVoice(entry.id, text, select.value, statusEl);
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'voice-remove';
  remove.textContent = EDITOR_STRINGS.voice.remove;
  remove.setAttribute('aria-label', EDITOR_STRINGS.voice.ariaRemove(entry.name));
  remove.addEventListener('mousedown', (event) => event.preventDefault());
  remove.addEventListener('click', () => removeSceneVoice(entry.id, entry.name));
  buttons.append(synth, remove);
  block.appendChild(buttons);
  block.appendChild(status);

  if (voice?.file) {
    const fileRow = document.createElement('div');
    fileRow.className = 'voice-file';
    const caption = document.createElement('span');
    caption.textContent = `${EDITOR_STRINGS.voice.fileLabel}: ${voice.file}`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = `/__api/audio/file?path=${encodeURIComponent(voice.file)}`;
    audio.setAttribute('aria-label', EDITOR_STRINGS.voice.ariaAudio(voice.file));
    fileRow.append(caption, audio);
    block.appendChild(fileRow);
  }

  textArea.addEventListener('input', updateSynthState);
  updateSynthState();
  remove.dataset.voiceDisabled = hasVoice ? '0' : '1';
  remove.disabled = !hasVoice || voiceSynthBusy || isExportInFlight();
  return block;
}

function sceneSfxBlock(entry: ProjectSceneV1): HTMLElement {
  const block = document.createElement('details');
  block.className = 'sfx-block';
  block.dataset.sceneId = entry.id;
  block.open = sfxOpenState.get(entry.id) ?? Boolean(entry.sfx?.length);
  block.addEventListener('toggle', () => sfxOpenState.set(entry.id, block.open));
  block.addEventListener('dragstart', (event) => event.preventDefault());

  const summary = document.createElement('summary');
  const sfx = entry.sfx ?? [];
  summary.textContent = `${EDITOR_STRINGS.sfx.title} (${sfx.length})`;
  block.appendChild(summary);

  const sfxSorted = [...sfx].sort((a, b) => a.at - b.at);

  const note = document.createElement('div');
  note.className = 'hint';
  if (sfxAudioState === 'offline') note.textContent = EDITOR_STRINGS.sfx.serviceUnavailable;
  else if (sfxAudioState === 'unknown') note.textContent = EDITOR_STRINGS.voice.loading;
  if (note.textContent) block.appendChild(note);

  for (let index = 0; index < sfxSorted.length; index++) {
    const effect = sfxSorted[index];
    const realIndex = sfx.indexOf(effect);
    if (realIndex === -1) continue;

    const row = document.createElement('div');
    row.className = 'sfx-row';

    const fileLabelEl = document.createElement('label');
    fileLabelEl.className = 'f';
    const fileTitle = document.createElement('span');
    fileTitle.textContent = EDITOR_STRINGS.sfx.fileLabel;
    const fileSelect = document.createElement('select');
    fileSelect.setAttribute('aria-label', EDITOR_STRINGS.sfx.ariaFile(entry.name));
    const sfxFirst = sfxAudioFiles.filter((file) => file.startsWith('sfx/'));
    const otherFiles = sfxAudioFiles.filter((file) => !file.startsWith('sfx/'));
    const ordered = [...sfxFirst, ...otherFiles];
    for (const file of ordered) {
      const option = document.createElement('option');
      option.value = file;
      option.textContent = file;
      fileSelect.appendChild(option);
    }
    const hasFile = ordered.includes(effect.file);
    fileSelect.value = hasFile ? effect.file : '';
    if (!hasFile) {
      const missing = document.createElement('option');
      missing.value = '';
      missing.textContent = `${effect.file} (${EDITOR_STRINGS.sfx.notInFolder})`;
      missing.disabled = true;
      fileSelect.insertBefore(missing, fileSelect.firstChild);
      fileSelect.value = '';
    }
    fileSelect.disabled = sfxAudioState !== 'online';
    fileSelect.title = sfxAudioState === 'online' ? '' : EDITOR_STRINGS.sfx.serviceUnavailable;
    fileSelect.addEventListener('change', () => {
      const value = fileSelect.value;
      if (!value) return;
      applyChange('scene-sfx-change', () => {
        const cur = entry.sfx?.[realIndex];
        if (cur) cur.file = value;
      });
    });
    fileLabelEl.append(fileTitle, fileSelect);

    const atLabel = document.createElement('label');
    atLabel.className = 'f';
    const atTitle = document.createElement('span');
    atTitle.textContent = EDITOR_STRINGS.sfx.atLabel;
    const at = document.createElement('input');
    at.type = 'number';
    at.min = '0';
    at.step = '0.1';
    at.value = String(effect.at ?? 0);
    at.setAttribute('aria-label', EDITOR_STRINGS.sfx.ariaAt(entry.name));
    at.title = EDITOR_STRINGS.sfx.atHint;
    const atWarn = document.createElement('div');
    atWarn.className = 'msg';
    const refreshAtWarn = () => {
      const raw = Number(at.value);
      const tooLong = Number.isFinite(raw) && raw > entry.scene.duration + 1e-6;
      atWarn.textContent = tooLong ? EDITOR_STRINGS.sfx.afterScene(entry.scene.duration.toFixed(1)) : '';
      atWarn.classList.toggle('warn', tooLong);
      atWarn.classList.toggle('ok', false);
      atWarn.classList.toggle('err', false);
    };
    refreshAtWarn();
    at.addEventListener('input', refreshAtWarn);
    at.addEventListener('change', () => {
      const raw = Number(at.value);
      if (!Number.isFinite(raw) || raw < 0) { at.value = String(effect.at ?? 0); return; }
      const value = raw;
      if (Math.abs(value - (effect.at ?? 0)) < 1e-9) return;
      applyChange('scene-sfx-change', () => {
        const cur = entry.sfx?.[realIndex];
        if (cur) cur.at = value;
      });
    });
    atLabel.append(atTitle, at);

    const gainLabel = document.createElement('label');
    gainLabel.className = 'f';
    const gainTitle = document.createElement('span');
    gainTitle.textContent = EDITOR_STRINGS.sfx.gainLabel;
    const gain = document.createElement('input');
    gain.type = 'number';
    gain.min = '0';
    gain.max = '2';
    gain.step = '0.1';
    gain.value = String(effect.gain ?? 1);
    gain.setAttribute('aria-label', EDITOR_STRINGS.sfx.ariaGain(entry.name));
    gain.addEventListener('change', () => {
      const raw = Number(gain.value);
      if (!Number.isFinite(raw) || raw < 0 || raw > 2) { gain.value = String(effect.gain ?? 1); return; }
      const value = raw;
      if (Math.abs(value - (effect.gain ?? 1)) < 1e-9) return;
      applyChange('scene-sfx-change', () => {
        const cur = entry.sfx?.[realIndex];
        if (cur) cur.gain = value;
      });
    });
    gainLabel.append(gainTitle, gain);

    const listen = document.createElement('button');
    listen.type = 'button';
    listen.className = 'sfx-listen';
    listen.textContent = EDITOR_STRINGS.sfx.listen;
    listen.setAttribute('aria-label', EDITOR_STRINGS.sfx.ariaListen(effect.file));
    listen.addEventListener('mousedown', (event) => event.preventDefault());
    listen.addEventListener('click', () => {
      const audio = new Audio(`/__api/audio/file?path=${encodeURIComponent(effect.file)}`);
      audio.play().catch(() => {});
    });
    listen.disabled = sfxAudioState !== 'online';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'sfx-remove';
    removeBtn.textContent = EDITOR_STRINGS.sfx.remove;
    removeBtn.setAttribute('aria-label', EDITOR_STRINGS.sfx.ariaRemove(realIndex));
    removeBtn.addEventListener('mousedown', (event) => event.preventDefault());
    removeBtn.addEventListener('click', () => {
      applyChange('scene-sfx-remove', () => {
        if (!entry.sfx) return;
        entry.sfx.splice(realIndex, 1);
        if (entry.sfx.length === 0) delete entry.sfx;
      });
    });

    row.append(fileLabelEl, atLabel, gainLabel, listen, removeBtn);
    block.appendChild(row);
    block.appendChild(atWarn);
  }

  const addBar = document.createElement('div');
  addBar.className = 'sfx-addbar';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'sfx-add primary';
  add.textContent = EDITOR_STRINGS.sfx.add;
  add.setAttribute('aria-label', EDITOR_STRINGS.sfx.ariaAdd(entry.name));
  add.addEventListener('mousedown', (event) => event.preventDefault());
  const firstFile = sfxAudioFiles.length > 0 ? sfxAudioFiles[0] : '';
  const atLimit = sfx.length >= 64;
  add.disabled = sfxAudioState !== 'online' || atLimit || !firstFile;
  add.title = atLimit ? EDITOR_STRINGS.sfx.limit : (sfxAudioState !== 'online' ? EDITOR_STRINGS.sfx.serviceUnavailable : '');
  add.setAttribute('aria-disabled', String(add.disabled));
  add.addEventListener('click', () => {
    if (atLimit || !firstFile || sfxAudioState !== 'online') return;
    applyChange('scene-sfx-add', () => {
      if (!entry.sfx) entry.sfx = [];
      entry.sfx.push({ file: firstFile, at: 0 });
    });
  });
  addBar.append(add);
  block.appendChild(addBar);

  return block;
}

function subtitlesAreDefaults(style: ProjectSubtitlesV1): boolean {
  return (style.maxWords ?? 3) === 3
    && (style.upper ?? false) === false
    && (style.position ?? 'bottom') === 'bottom'
    && (style.size === undefined || style.size === defaultSubtitleSize(project.format));
}

function applySubtitlesChange(label: string, mutator: () => void): void {
  applyChange(label, mutator);
  renderVoicePanel();
  renderProjectPreview();
}

function setSubtitlesEnabled(enabled: boolean): void {
  const current = project.subtitles;
  if (enabled) {
    if (current && current.enabled !== false) return;
    applySubtitlesChange('project-subtitles', () => {
      if (!project.subtitles) project.subtitles = {};
      delete project.subtitles.enabled;
    });
    return;
  }
  if (!current) return;
  applySubtitlesChange('project-subtitles', () => {
    if (subtitlesAreDefaults(current)) delete project.subtitles;
    else current.enabled = false;
  });
}

function updateSubtitles(label: string, mutator: (style: ProjectSubtitlesV1) => void): void {
  if (!project.subtitles) return;
  applySubtitlesChange(label, () => {
    const style = project.subtitles!;
    mutator(style);
    if (style.enabled === true) delete style.enabled;
  });
}

function subtitlesBlock(): HTMLElement {
  const block = document.createElement('div');
  block.className = 'voicesubs';
  const title = document.createElement('h2');
  title.style.margin = '0';
  title.textContent = EDITOR_STRINGS.subtitles.title;
  block.appendChild(title);

  const current = project.subtitles;
  const on = Boolean(current) && current!.enabled !== false;

  const enableLabel = document.createElement('label');
  enableLabel.className = 'f';
  enableLabel.style.flexDirection = 'row';
  enableLabel.style.alignItems = 'center';
  enableLabel.style.gap = '4px';
  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.checked = on;
  enable.setAttribute('aria-label', EDITOR_STRINGS.subtitles.enable);
  enable.addEventListener('change', () => setSubtitlesEnabled(enable.checked));
  const enableText = document.createElement('span');
  enableText.textContent = EDITOR_STRINGS.subtitles.enable;
  enableLabel.append(enable, enableText);
  block.appendChild(enableLabel);

  const bar = document.createElement('div');
  bar.className = 'bar';

  const wordsLabel = document.createElement('label');
  wordsLabel.className = 'f';
  const wordsTitle = document.createElement('span');
  wordsTitle.textContent = EDITOR_STRINGS.subtitles.maxWords;
  const words = document.createElement('select');
  words.disabled = !on;
  words.setAttribute('aria-label', EDITOR_STRINGS.subtitles.ariaMaxWords);
  for (let value = 1; value <= 6; value++) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    words.appendChild(option);
  }
  words.value = String(current?.maxWords ?? 3);
  words.addEventListener('change', () => {
    const value = Number(words.value);
    updateSubtitles('project-subtitles-words', (style) => {
      if (value === 3) delete style.maxWords;
      else style.maxWords = value;
    });
  });
  wordsLabel.append(wordsTitle, words);

  const sizeLabel = document.createElement('label');
  sizeLabel.className = 'f';
  const sizeTitle = document.createElement('span');
  sizeTitle.textContent = EDITOR_STRINGS.subtitles.size;
  const size = document.createElement('input');
  size.type = 'number';
  size.min = '0.03';
  size.max = '0.12';
  size.step = '0.005';
  size.style.width = '76px';
  size.value = String(current?.size ?? defaultSubtitleSize(project.format));
  size.disabled = !on;
  size.setAttribute('aria-label', EDITOR_STRINGS.subtitles.ariaSize);
  size.addEventListener('change', () => {
    const raw = Number(size.value);
    if (!Number.isFinite(raw)) return;
    const value = Math.min(0.12, Math.max(0.03, raw));
    updateSubtitles('project-subtitles-size', (style) => {
      if (Math.abs(value - defaultSubtitleSize(project.format)) < 1e-9) delete style.size;
      else style.size = value;
    });
  });
  sizeLabel.append(sizeTitle, size);

  const positionLabel = document.createElement('label');
  positionLabel.className = 'f';
  const positionTitle = document.createElement('span');
  positionTitle.textContent = EDITOR_STRINGS.subtitles.position;
  const position = document.createElement('select');
  position.disabled = !on;
  position.setAttribute('aria-label', EDITOR_STRINGS.subtitles.ariaPosition);
  const positions: Array<['bottom' | 'center' | 'top', string]> = [
    ['bottom', EDITOR_STRINGS.subtitles.positionBottom],
    ['center', EDITOR_STRINGS.subtitles.positionCenter],
    ['top', EDITOR_STRINGS.subtitles.positionTop],
  ];
  for (const [value, label] of positions) {
    const option = document.createElement('option');
    option.value = value as string;
    option.textContent = label;
    position.appendChild(option);
  }
  position.value = current?.position ?? 'bottom';
  position.addEventListener('change', () => {
    const value = position.value;
    updateSubtitles('project-subtitles-position', (style) => {
      if (value === 'bottom') delete style.position;
      else style.position = value as ProjectSubtitlesV1['position'];
    });
  });
  positionLabel.append(positionTitle, position);

  const upperLabel = document.createElement('label');
  upperLabel.className = 'f';
  upperLabel.style.flexDirection = 'row';
  upperLabel.style.alignItems = 'center';
  upperLabel.style.gap = '4px';
  const upper = document.createElement('input');
  upper.type = 'checkbox';
  upper.checked = current?.upper === true;
  upper.disabled = !on;
  upper.setAttribute('aria-label', EDITOR_STRINGS.subtitles.ariaUpper);
  upper.addEventListener('change', () => {
    updateSubtitles('project-subtitles-upper', (style) => {
      if (upper.checked) style.upper = true;
      else delete style.upper;
    });
  });
  const upperText = document.createElement('span');
  upperText.textContent = EDITOR_STRINGS.subtitles.upper;
  upperLabel.append(upper, upperText);

  bar.append(wordsLabel, sizeLabel, positionLabel, upperLabel);
  block.appendChild(bar);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = EDITOR_STRINGS.subtitles.hint;
  block.appendChild(hint);

  const built = buildSubtitleCues(project);
  if (built.missingWords.length) {
    const missing = document.createElement('div');
    missing.className = 'hint';
    missing.textContent = EDITOR_STRINGS.subtitles.missing(built.missingWords.length);
    block.appendChild(missing);
  }
  return block;
}

function renderVoicePanel(): void {
  if (!voicePanel) return;
  voicePanel.innerHTML = '';

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = EDITOR_STRINGS.voice.canvasNote;
  voicePanel.appendChild(hint);

  const batchBar = document.createElement('div');
  batchBar.className = 'bar';
  const batchBtn = document.createElement('button');
  batchBtn.type = 'button';
  batchBtn.className = 'voice-synth-all primary';
  batchBtn.textContent = EDITOR_STRINGS.voice.synthesizeAll;
  batchBtn.setAttribute('aria-label', EDITOR_STRINGS.voice.synthesizeAll);
  const plan0 = voiceBatchPlan(project);
  batchBtn.dataset.voiceDisabled = (plan0.todo.length === 0 || voiceAdaptersState !== 'online' || availableVoiceAdapters().length === 0) ? '1' : '0';
  const batchStatus = document.createElement('span');
  batchStatus.className = 'msg voice-batch-status';
  voiceBatchStatusEl = batchStatus;
  batchBtn.addEventListener('click', () => void synthesizeAllScenes());
  batchBar.append(batchBtn, batchStatus);
  voicePanel.appendChild(batchBar);

  const music = document.createElement('div');
  music.className = 'voicemusic';
  const title = document.createElement('h2');
  title.style.margin = '0';
  title.textContent = EDITOR_STRINGS.voice.musicTitle;
  music.appendChild(title);

  const current = project.audio?.music;
  const bar = document.createElement('div');
  bar.className = 'bar';

  const fileLabel = document.createElement('label');
  fileLabel.className = 'f';
  const fileTitle = document.createElement('span');
  fileTitle.textContent = EDITOR_STRINGS.voice.musicFile;
  const select = document.createElement('select');
  select.setAttribute('aria-label', EDITOR_STRINGS.voice.musicTitle);
  const none = document.createElement('option');
  none.value = '';
  none.textContent = EDITOR_STRINGS.voice.musicNone;
  select.appendChild(none);
  for (const file of voiceAudioFiles) {
    const option = document.createElement('option');
    option.value = file;
    option.textContent = file;
    select.appendChild(option);
  }
  select.value = current?.file && voiceAudioFiles.includes(current.file) ? current.file : '';
  select.disabled = voiceAudioState !== 'online';
  select.title = voiceAudioState === 'online' ? '' : EDITOR_STRINGS.voice.offline;
  select.addEventListener('change', () => applyProjectMusic(select.value));
  fileLabel.append(fileTitle, select);

  const gainLabel = document.createElement('label');
  gainLabel.className = 'f';
  const gainTitle = document.createElement('span');
  gainTitle.textContent = EDITOR_STRINGS.voice.musicGain;
  const gain = document.createElement('input');
  gain.type = 'number';
  gain.min = '0';
  gain.max = '1';
  gain.step = '0.05';
  gain.style.width = '72px';
  gain.value = String(current?.gain ?? 0.25);
  gain.disabled = !current;
  gain.setAttribute('aria-label', EDITOR_STRINGS.voice.musicGain);
  gain.addEventListener('change', () => applyProjectMusicGain(Number(gain.value)));
  gainLabel.append(gainTitle, gain);

  const duckLabel = document.createElement('label');
  duckLabel.className = 'f';
  duckLabel.style.flexDirection = 'row';
  duckLabel.style.alignItems = 'center';
  duckLabel.style.gap = '4px';
  const duck = document.createElement('input');
  duck.type = 'checkbox';
  duck.checked = current?.duck !== false;
  duck.disabled = !current;
  const duckText = document.createElement('span');
  duckText.textContent = EDITOR_STRINGS.voice.musicDuck;
  duck.addEventListener('change', () => applyProjectMusicDuck(duck.checked));
  duckLabel.append(duck, duckText);

  bar.append(fileLabel, gainLabel, duckLabel);
  music.appendChild(bar);

  const note = document.createElement('div');
  note.className = 'hint';
  if (voiceAudioState === 'offline') note.textContent = EDITOR_STRINGS.voice.offline;
  else if (voiceAudioState === 'unknown') note.textContent = EDITOR_STRINGS.voice.loading;
  else if (voiceAudioFiles.length === 0) note.textContent = EDITOR_STRINGS.voice.musicEmpty;
  if (note.textContent) music.appendChild(note);

  voicePanel.appendChild(music);
  voicePanel.appendChild(subtitlesBlock());
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
  void copyText(prompt, EDITOR_STRINGS.catalog.modelPrompt);
  if (catalogModelPromptStatus) {
    const bytes = new TextEncoder().encode(prompt).length;
    catalogModelPromptStatus.textContent = EDITOR_STRINGS.status.copiedKb((bytes / 1024).toFixed(1));
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
  if (!text.includes('{')) { setCatalogStatus(catalogModelStatus, EDITOR_STRINGS.catalog.notModelJson, true); return; }
  let candidate: unknown;
  try { candidate = extractJson(text); } catch { setCatalogStatus(catalogModelStatus, EDITOR_STRINGS.errors.aiReplyParse, true); return; }
  const result = checkModelJsonText(text);
  modelCandidate = result.ok ? candidate : undefined;
  showList(catalogModelErrors, result.errors);
  showList(catalogModelWarnings, result.warnings);
  if (catalogSaveModel) catalogSaveModel.disabled = !result.ok;
  setCatalogStatus(catalogModelStatus, result.ok ? EDITOR_STRINGS.catalog.aiReplyOk : EDITOR_STRINGS.errors.aiReplyErrors(result.errors.length), !result.ok);
}

function copyCatalogModelPromptForSuggestion(description: string, view: string | undefined, sizeM: number | undefined, statusEl: HTMLElement) {
  const prompt = buildModelPrompt({ description, view: view as 'side' | 'bottom' | 'front' | 'top' | 'three-quarter' | undefined, sizeM });
  void copyText(prompt, EDITOR_STRINGS.catalog.modelPromptCopy(description));
  statusEl.textContent = EDITOR_STRINGS.status.copiedKb((new TextEncoder().encode(prompt).length / 1024).toFixed(1));
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
  const asset = previewAssetFor(catalog[catalogPreviewModel?.value ?? ''], codeDraft);
  if (!asset) return;
  const preset = (catalogPreset?.value ?? 'none') as 'none' | 'walk' | 'run' | 'fly' | 'swim' | 'hop' | 'sway';
  const scene = buildPreviewScene(asset, preset, previewDuration);
  const time = Number(catalogTime?.value ?? 0);
  renderFrame(ctx, scene, time, { w: 280, h: 280 }, { createCanvas: (w: number, h: number) => { const cc = document.createElement('canvas'); cc.width = w; cc.height = h; return cc; }, catalog: catalogWithDraft(catalog, asset), cache });
  if (catalogTimeText) catalogTimeText.textContent = EDITOR_STRINGS.splice.time(time.toFixed(1), previewDuration.toFixed(1));
}

function loadCodeEditorFromSelection() {
  const asset = catalog[catalogPreviewModel?.value ?? ''];
  codeDraft = undefined;
  if (catalogCode) catalogCode.value = asset ? formatModelJson(asset) : '';
  showList(catalogCodeErrors, []);
  if (catalogCodeSave) catalogCodeSave.disabled = true;
  setCatalogStatus(catalogCodeStatus, '', false);
}

function onCodeEdited() {
  if (!catalogCode) return;
  const result = checkModelJsonText(catalogCode.value.trim());
  if (result.ok) codeDraft = result;
  showList(catalogCodeErrors, result.errors);
  if (catalogCodeSave) catalogCodeSave.disabled = !result.ok;
  setCatalogStatus(catalogCodeStatus, result.ok ? EDITOR_STRINGS.catalog.noErrorsPreview : EDITOR_STRINGS.catalog.previewErrorsStale(result.errors.length), !result.ok);
  if (result.ok) renderPreviewFrame();
}

function setPreviewPlaying(playing: boolean) {
  previewPlaying = playing;
  if (catalogPlay) catalogPlay.textContent = playing ? EDITOR_STRINGS.common.pause : EDITOR_STRINGS.common.play;
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

/** Пачкой сохраняем только то, что уже найдено в проекте как kind "shape"; остальное — пропущено. */
async function saveAllSuggestions(): Promise<void> {
  if (ideaSaveAllBtn) ideaSaveAllBtn.disabled = true;
  if (ideaSaveAllStatus) ideaSaveAllStatus.textContent = EDITOR_STRINGS.common.saving;
  if (ideaSaveAllErrors) ideaSaveAllErrors.innerHTML = '';
  let saved = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const suggestion of ideaSuggestions) {
    const model = suggestionToModel(suggestion);
    if (!model) { skipped++; continue; }
    const reply = await postCatalogAdd(model, false);
    if (reply.ok) saved++;
    else failures.push(issueMessage(reply.errors));
  }
  if (ideaSaveAllStatus) {
    const summary = EDITOR_STRINGS.project.saveAll.result(saved, skipped, failures.length);
    ideaSaveAllStatus.textContent = skipped > 0 ? `${summary} · ${EDITOR_STRINGS.project.saveAll.noShape}` : summary;
  }
  for (const message of failures) {
    if (!ideaSaveAllErrors) break;
    const item = document.createElement('li');
    item.className = 'bad';
    item.textContent = `✖ ${message}`;
    ideaSaveAllErrors.appendChild(item);
  }
  if (ideaSaveAllBtn) ideaSaveAllBtn.disabled = false;
  if (saved === 0) return;
  saveAutosave();
  if (!isExportInFlight()) {
    window.setTimeout(() => location.reload(), 800);
    return;
  }
  if (ideaSaveAllStatus) ideaSaveAllStatus.textContent = `${ideaSaveAllStatus.textContent} · ${EDITOR_STRINGS.project.saveAll.waitExport}`;
}

function renderIdeaSuggestions() {
  const list = document.getElementById('ideaSuggestionsList') as HTMLElement | null;
  const panel = document.getElementById('ideaSuggestions') as HTMLElement | null;
  if (!list || !panel) return;
  if (ideaSuggestions.length === 0) { panel.hidden = true; list.innerHTML = ''; return; }
  panel.hidden = false;
  list.innerHTML = '';
  if (ideaSaveAllStatus) ideaSaveAllStatus.textContent = '';
  if (ideaSaveAllErrors) ideaSaveAllErrors.innerHTML = '';
  for (const s of ideaSuggestions) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;border:1px solid #ddd5ca;border-radius:6px;padding:6px';
    const text = document.createElement('span');
    text.textContent = EDITOR_STRINGS.catalog.shapeLine(s.id, s.description, s.view, s.sizeM);
    text.style.flex = '1';
    text.style.minWidth = '0';
    const button = document.createElement('button');
    button.textContent = EDITOR_STRINGS.catalog.copyThisModelPrompt;
    const status = document.createElement('span');
    status.className = 'hint';
    status.style.marginLeft = '8px';
    button.onclick = () => copyCatalogModelPromptForSuggestion(s.description, s.view, s.sizeM, status);
    const save = document.createElement('button');
    save.textContent = EDITOR_STRINGS.catalog.saveToCatalog;
    const hasShape = findShapeModel(s.id) !== null;
    save.disabled = !hasShape;
    if (!hasShape) save.title = EDITOR_STRINGS.catalog.shapeMissing(s.id);
    save.onclick = () => {
      const model = suggestionToModel(s);
      if (!model) {
        status.textContent = EDITOR_STRINGS.catalog.shapeMissingHint;
        return;
      }
      status.textContent = EDITOR_STRINGS.common.saving;
      void localApiAvailable().then(async (online) => {
        if (!online) {
          status.textContent = EDITOR_STRINGS.catalog.uploadOfflineShort;
          return;
        }
        const reply = await postCatalogAdd(model, false);
        if (reply.ok) {
          status.textContent = EDITOR_STRINGS.catalog.savedReload(reply.id, EDITOR_STRINGS.project.reloadHint);
          saveAutosave();
          if (isExportInFlight()) {
            status.textContent = `${status.textContent} · ${EDITOR_STRINGS.project.saveAll.waitExport}`;
          } else {
            window.setTimeout(() => location.reload(), 800);
          }
        } else {
          status.textContent = `✖ ${issueMessage(reply.errors)}`;
        }
      });
    };
    row.append(text, button, save, status);
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
  if (!confirm(EDITOR_STRINGS.project.replaceConfirm)) return;
  applyChange('new-project-from-idea', () => {
    const next = structuredClone(candidate as ProjectV1);
    const styleId = selectedStyleId();
    const story = (ideaText?.value ?? '').trim().slice(0, STORY_MAX_CHARS);
    const advancedBrief = ideaBrief?.value.trim() ?? '';
    const briefFromAdvanced = advancedBrief && validateBrief(advancedBrief, { scenes: ideaScenes ? Number(ideaScenes.value) : 5 }).ok ? extractBrief(advancedBrief) : '';
    const briefText = ideaReplyBrief || briefFromAdvanced;
    if (briefText || styleId || story) {
      next.meta = {
        ...(next.meta ?? {}),
        ...(briefText ? { brief: briefText } : {}),
        ...(styleId ? { styleId } : {}),
        ...(story ? { story } : {}),
      };
    }
    project = next;
    activeSceneIndex = 0;
    scene = project.scenes[0].scene;
    duration = scene.duration;
    t = Math.min(t, duration);
  });
  syncStoryField();
  ideaCandidate = undefined;
  ideaErrList = [];
  ideaReplyBrief = '';
  if (ideaCreate) ideaCreate.disabled = true;
  if (ideaFix) ideaFix.hidden = true;
  setStatus(EDITOR_STRINGS.project.createdFromIdea, false);
  if (autoExportRequested()) void startFullExport();
}
function kindExample(kind: string): Record<string, unknown> {
  const spec = KIND_SPEC[kind as keyof typeof KIND_SPEC];
  const params: Record<string, unknown> = {};
  for (const field of spec.params) if (field.default !== undefined) params[field.name] = structuredClone(field.default);
  if (kind === 'text') params.text = EDITOR_STRINGS.common.text;
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
    button.textContent = EDITOR_STRINGS.catalog.copyExample;
    button.onclick = () => copyText(JSON.stringify(kindExample(kind), null, 2), EDITOR_STRINGS.catalog.exampleTemplate(kind));
    row.append(name, button);
    templates.appendChild(row);
  }
}
async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(EDITOR_STRINGS.status.copiedInBuffer(label), false);
  } catch {
    setStatus(EDITOR_STRINGS.status.copyFailed(label), true);
  }
}
function applyJsonText() {
  if (!jsonArea) return;
  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonArea.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportErrors([{ path: '', message: EDITOR_STRINGS.errors.jsonParseWithMessage(message) }]);
    setStatus(EDITOR_STRINGS.errors.jsonParse, true);
    return;
  }
  const target = currentTarget();
  const result = validateTargetJson(project, target, candidate, Object.keys(catalog));
  if (!result.ok) {
    reportErrors(result.errors, candidate);
    setStatus(EDITOR_STRINGS.errors.applyJsonErrors(result.errors.length), true);
    return;
  }
  try {
    applyCandidate(candidate, target, 'apply-json');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    return;
  }
  showList(aiWarnings, result.warnings);
  setStatus(EDITOR_STRINGS.common.applyUndo, false);
}
function checkAiResponse() {
  if (!aiResponse) return;
  const text = aiResponse.value.trim();
  if (!text) {
    reportErrors([{ path: '', message: EDITOR_STRINGS.errors.pasteAiReply }]);
    setStatus(EDITOR_STRINGS.errors.emptyAiReply, true);
    return;
  }
  let candidate: unknown;
  try {
    candidate = extractJson(text);
  } catch (error) {
    reportErrors([{ path: '', message: error instanceof Error ? error.message : String(error) }]);
    setStatus(EDITOR_STRINGS.errors.aiReplyParse, true);
    return;
  }
  const target = currentTarget();
  const result = validateTargetJson(project, target, candidate, Object.keys(catalog));
  if (!result.ok) {
    reportErrors(result.errors, candidate);
    setStatus(EDITOR_STRINGS.errors.fixAvailable(result.errors.length), true);
    return;
  }
  showList(aiErrors, []);
  showList(aiWarnings, result.warnings);
  fixCandidate = undefined;
  fixErrors = [];
  if (aiFixBtn) aiFixBtn.hidden = true;
  pendingApply = { candidate, target, label: 'apply-ai-json' };
  if (aiApplyBtn) aiApplyBtn.disabled = false;
  setStatus(result.warnings.length ? EDITOR_STRINGS.errors.readyWithWarnings(result.warnings.length) : EDITOR_STRINGS.errors.readyApply, false);
}
function checkIdeaResponse(): boolean {
  if (!ideaResponse) return false;
  const text = ideaResponse.value.trim();
  if (!text) {
    reportIdeaErrors([{ path: '', message: EDITOR_STRINGS.errors.pasteAiReply }]);
    setIdeaStatus(EDITOR_STRINGS.errors.emptyAiReply, true);
    if (ideaCreate) ideaCreate.disabled = true;
    return false;
  }
  if (!text.includes('{')) {
    const message = ideaReplyMessage(text);
    reportIdeaErrors([{ path: '', message }]);
    setIdeaStatus(message, true);
    if (ideaCreate) ideaCreate.disabled = true;
    return false;
  }
  let split: SplitReply;
  try {
    split = splitReply(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportIdeaErrors([{ path: '', message }]);
    setIdeaStatus(EDITOR_STRINGS.project.briefNoProjectJson, true);
    if (ideaCreate) ideaCreate.disabled = true;
    return false;
  }
  let candidate: unknown;
  try {
    candidate = extractJson(split.jsonText);
  } catch (error) {
    reportIdeaErrors([{ path: '', message: error instanceof Error ? error.message : String(error) }]);
    setIdeaStatus(EDITOR_STRINGS.errors.aiReplyParse, true);
    if (ideaCreate) ideaCreate.disabled = true;
    return false;
  }
  const reply = validateProjectReply(candidate, { catalogIds: Object.keys(catalog) });
  ideaReplyBrief = '';
  if (split.brief) {
    const scenes = ideaScenes ? Number(ideaScenes.value) : 5;
    const briefCheck = validateBrief(split.brief, { scenes });
    if (briefCheck.ok) ideaReplyBrief = split.brief;
    else reply.warnings.push({ path: 'meta.brief', message: EDITOR_STRINGS.project.briefNotApplied(briefCheck.errors[0]?.message) });
  }
  ideaCandidate = candidate;
  ideaErrList = [...reply.errors];
  showList(ideaErrEl, reply.errors);
  showList(ideaWarnEl, reply.warnings);
  if (reply.errors.length === 0) {
    if (ideaCreate) ideaCreate.disabled = false;
    if (ideaFix) ideaFix.hidden = true;
    setIdeaStatus(reply.warnings.length ? EDITOR_STRINGS.project.briefReadyWithWarnings(reply.warnings.length) : EDITOR_STRINGS.project.briefReady, false);
    if (reply.suggestions.length) console.log(formatSuggestions(reply.suggestions));
    return true;
  }
  if (ideaCreate) ideaCreate.disabled = true;
  if (ideaFix) ideaFix.hidden = false;
  setIdeaStatus(EDITOR_STRINGS.project.ideaErrorsFix(reply.errors.length), true);
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
  const action = shouldHandleUndoKey({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, target: event.target as HTMLElement | null });
  if (!action) return;
  event.preventDefault();
  if (action === 'redo') redoChange(); else undoChange();
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

const SAFE_ZONES_KEY = 'animation-motion/safe-zones/v1';
let showSafeZones = false;
try { showSafeZones = localStorage.getItem(SAFE_ZONES_KEY) === '1'; } catch {}

// Оверлей живёт только в превью: в рендер и экспорт он не попадает.
function drawSafeZones(g: CanvasRenderingContext2D, w: number, h: number) {
  const zone = SAFE_ZONES[vertical ? '9:16' : '16:9'];
  const k = h / 1000;
  g.save();
  g.strokeStyle = 'rgba(255, 214, 102, 0.7)';
  g.lineWidth = 2;
  g.strokeRect(zone.left * k, zone.top * k, w - (zone.left + zone.right) * k, h - (zone.top + zone.bottom) * k);
  g.restore();
}

function frame() {
  scene = project.scenes[activeSceneIndex].scene;
  duration = scene.duration;
  if (!ctx) return;
  const errors = validateScene(scene, { catalogIds: Object.keys(catalog) });
  showErrors(errors.ok ? null : errors.errors);
  if (!errors.ok) return;
  renderFrame(ctx, scene, t, size, { createCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, catalog, cache });
  if (showSafeZones) drawSafeZones(ctx, size.w, size.h);
  if (scrub) scrub.value = (t / duration).toFixed(2);
  if (timeText) timeText.textContent = EDITOR_STRINGS.splice.time(t.toFixed(1), duration.toFixed(1));
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
  if (playBtn) playBtn.textContent = p ? EDITOR_STRINGS.common.pause : EDITOR_STRINGS.common.play;
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
  projectPlay.textContent = splicePlaying ? EDITOR_STRINGS.common.pause : EDITOR_STRINGS.common.play;
  if (splicePlaying) renderProjectPreview();
};
if (projectScrub) projectScrub.oninput = (e) => {
  splicePlaying = false;
  if (projectPlay) projectPlay.textContent = EDITOR_STRINGS.common.play;
  const seconds = Math.max(0, projectFrameCount(project) / project.fps);
  spliceT = Number((e.target as HTMLInputElement).value) * seconds;
  renderProjectPreview();
};
if (exportMp4Btn) exportMp4Btn.onclick = () => void startExport();
if (exportCancelBtn) exportCancelBtn.onclick = () => void cancelExport();
if (aspectH) aspectH.onclick = () => setAspect('h');
if (aspectV) aspectV.onclick = () => setAspect('v');
if (safeZonesText) safeZonesText.textContent = EDITOR_STRINGS.preview.safeZones;
if (safeZonesToggle) {
  safeZonesToggle.checked = showSafeZones;
  safeZonesToggle.onchange = () => {
    showSafeZones = safeZonesToggle.checked;
    try { localStorage.setItem(SAFE_ZONES_KEY, showSafeZones ? '1' : '0'); } catch {}
    frame();
  };
}

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
    const tab = document.createElement('div');
    tab.className = 'scene-tab';
    const select = document.createElement('button');
    select.type = 'button';
    select.textContent = entry.name;
    select.classList.toggle('on', index === activeSceneIndex);
    select.onclick = () => { activeSceneIndex = index; scene = entry.scene; duration = scene.duration; frame(); renderTabs(); };
    select.ondblclick = () => { const name = prompt(EDITOR_STRINGS.scenes.namePrompt, entry.name); if (name?.trim()) applyChange('rename-scene', () => { entry.name = name.trim(); }); };
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'scene-close';
    close.textContent = '×';
    close.title = project.scenes.length > 1 ? EDITOR_STRINGS.scenes.deleteSceneTitle : EDITOR_STRINGS.scenes.lastScene;
    close.disabled = project.scenes.length <= 1;
    close.onclick = (event) => { event.stopPropagation(); deleteSceneAt(index); };
    tab.append(select, close);
    tabs.appendChild(tab);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'scene-add ghost';
  add.textContent = '+';
  add.title = EDITOR_STRINGS.scenes.newScene;
  add.onclick = addScene;
  tabs.appendChild(add);
  if (projectTitle) projectTitle.value = project.title;
  if (projectFormat) projectFormat.value = project.format;
  if (projectFps) projectFps.value = String(project.fps);
  if (projectDuration) projectDuration.textContent = EDITOR_STRINGS.project.sizes((projectFrameCount(project) / project.fps).toFixed(1), scene.duration.toFixed(1));
  syncObjectOptions();
  refreshJson();
  resetAiResult();
  resetIdeaResult();
  renderLayerList();
  renderSceneOrder();
  storageSet(SCENE_TAB_KEY, String(activeSceneIndex));
}
function addScene() { applyChange('add-scene', () => { project.scenes.push(makeEmptyScene(EDITOR_STRINGS.scenes.newScene)); activeSceneIndex = project.scenes.length - 1; scene = project.scenes[activeSceneIndex].scene; duration = scene.duration; }); }
function deleteSceneAt(index: number) {
  if (project.scenes.length <= 1) return;
  const entry = project.scenes[index];
  if (!entry || !confirm(EDITOR_STRINGS.scenes.deleteConfirm(entry.name))) return;
  applyChange('delete-scene', () => { project.scenes.splice(index, 1); activeSceneIndex = Math.min(index, project.scenes.length - 1); scene = project.scenes[activeSceneIndex].scene; duration = scene.duration; });
}
function reorderScene(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= project.scenes.length || to >= project.scenes.length) return;
  applyChange('move-scene', () => {
    const [entry] = project.scenes.splice(from, 1);
    project.scenes.splice(to, 0, entry);
    activeSceneIndex = to;
    scene = project.scenes[activeSceneIndex].scene;
    duration = scene.duration;
  });
}
function updateProjectControls() { applyChange('project-settings', () => { if (projectTitle) project.title = projectTitle.value; if (projectFormat) project.format = projectFormat.value as ProjectV1['format']; if (projectFps) project.fps = Number(projectFps.value); }); }
const STORY_MAX_CHARS = 4000;
function syncStoryField() { if (ideaText && document.activeElement !== ideaText) ideaText.value = project.meta?.story ?? ''; }
function updateProjectStory() {
  const story = (ideaText?.value ?? '').trim().slice(0, STORY_MAX_CHARS);
  applyChange('project-story', () => {
    const meta = { ...(project.meta ?? {}) };
    if (story) meta.story = story; else delete meta.story;
    if (Object.keys(meta).length) project.meta = meta; else delete project.meta;
  });
}
document.getElementById('duplicateScene')?.addEventListener('click', () => applyChange('duplicate-scene', () => { const entry = structuredClone(project.scenes[activeSceneIndex]); entry.id = `s-${Date.now()}`; entry.name += EDITOR_STRINGS.scenes.copySuffix; project.scenes.splice(activeSceneIndex + 1, 0, entry); activeSceneIndex++; scene = project.scenes[activeSceneIndex].scene; duration = scene.duration; }));
projectTitle?.addEventListener('change', updateProjectControls); projectFormat?.addEventListener('change', updateProjectControls); projectFps?.addEventListener('change', updateProjectControls);
ideaText?.addEventListener('change', updateProjectStory);
document.getElementById('newProject')?.addEventListener('click', () => { applyChange('new-project', () => { project = { version: 1, title: EDITOR_STRINGS.project.newProject, fps: 30, format: '16:9', scenes: [makeEmptyScene(EDITOR_STRINGS.project.firstSceneName)] }; activeSceneIndex = 0; }); syncStoryField(); });
document.getElementById('saveProject')?.addEventListener('click', () => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${project.title.replace(/[\\/:*?"<>|]/g, '_')}.json`; link.click(); URL.revokeObjectURL(link.href); hasUnsavedChanges = false; updateSavedLabel(); });
document.getElementById('openProjectButton')?.addEventListener('click', () => openInput?.click());
openInput?.addEventListener('change', async () => { const file = openInput.files?.[0]; if (!file) return; try { const parsed: unknown = JSON.parse(await file.text()); const result = validateProject(parsed, { catalogIds: Object.keys(catalog) }); if (!result.ok) { showErrors(result.errors); return; } applyChange('open-project', () => restoreProject(parsed as ProjectV1)); hasUnsavedChanges = false; updateSavedLabel(); showErrors(null); } catch (error) { showErrors([{ path: '', message: EDITOR_STRINGS.errors.projectOpen(String(error)) }]); } finally { openInput.value = ''; } });

if (applyBtn) applyBtn.onclick = applyJsonText;
if (copyJsonBtn) copyJsonBtn.onclick = () => {
  const value = targetJson(project, currentTarget());
  if (value === undefined) { setStatus(EDITOR_STRINGS.common.objectNotSelected, true); return; }
  void copyText(JSON.stringify(value, null, 2), 'JSON');
};
if (copyAiBtn) copyAiBtn.onclick = () => {
  const value = targetJson(project, currentTarget());
  if (value === undefined) { setStatus(EDITOR_STRINGS.common.objectNotSelected, true); return; }
  const task = aiTaskInput?.value.trim() ?? '';
  void copyText(buildPrompt(value, { task, scope: SCOPE_LABELS[jsonScope] }), EDITOR_STRINGS.status.aiRequestTitle);
};
if (aiCheckBtn) aiCheckBtn.onclick = checkAiResponse;
if (aiApplyBtn) aiApplyBtn.onclick = () => {
  if (!pendingApply) return;
  const { candidate, target, label } = pendingApply;
  try {
    applyCandidate(candidate, target, label);
    setStatus(EDITOR_STRINGS.common.applyUndo, false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
};
if (aiFixBtn) aiFixBtn.onclick = () => {
  if (fixCandidate === undefined || fixErrors.length === 0) return;
  void copyText(buildFixRequest(fixCandidate, fixErrors), EDITOR_STRINGS.status.fixRequestTitle);
};
if (ideaCopyBrief) ideaCopyBrief.onclick = async () => {
  const idea = ideaText?.value.trim() ?? '';
  if (!idea) { setIdeaBriefStatus(EDITOR_STRINGS.common.enterIdea, true); return; }
  try {
    const scenes = ideaScenes ? Number(ideaScenes.value) : 5;
    const seconds = ideaSeconds ? Number(ideaSeconds.value) : 8;
    const format = (ideaFormat?.value ?? '16:9') as '16:9' | '9:16';
    const prompt = buildBriefPrompt({ idea, scenes, sceneSeconds: seconds, format, styleId: selectedStyleId(), catalogIndex });
    await navigator.clipboard.writeText(prompt);
    const kb = (new TextEncoder().encode(prompt).length / 1024).toFixed(1);
    setIdeaBriefStatus(EDITOR_STRINGS.status.briefPromptCopied(kb), false);
  } catch (error) {
    setIdeaBriefStatus(error instanceof Error ? error.message : String(error), true);
  }
};
if (ideaBrief) ideaBrief.addEventListener('input', () => { checkBriefField(); });
if (ideaScenes) ideaScenes.addEventListener('change', () => { if (ideaBrief?.value.trim()) checkBriefField(); });
/** Общие параметры промта проекта из вкладки «Проект»; null, если рассказ пустой. */
function ideaPromptBase(): { idea: string; scenes: number; sceneSeconds: number; format: '16:9' | '9:16'; styleId?: string } | null {
  const idea = ideaText?.value.trim() ?? '';
  if (!idea) { setIdeaCopyStatus(EDITOR_STRINGS.common.enterIdea, true); setIdeaStatus('', false); return null; }
  const scenes = ideaScenes ? Number(ideaScenes.value) : 5;
  const sceneSeconds = ideaSeconds ? Number(ideaSeconds.value) : 8;
  const format = (ideaFormat?.value ?? '16:9') as '16:9' | '9:16';
  const styleId = selectedStyleId();
  return { idea, scenes, sceneSeconds, format, ...(styleId ? { styleId } : {}) };
}
async function copyProjectPrompt(prompt: string) {
  try {
    await navigator.clipboard.writeText(prompt);
    if (ideaPromptFallback) ideaPromptFallback.hidden = true;
    const kb = (new TextEncoder().encode(prompt).length / 1024).toFixed(1);
    setIdeaCopyStatus(EDITOR_STRINGS.status.copiedIdeaPrompt(kb), false);
    setIdeaStatus('', false);
  } catch {
    if (ideaPromptOut) ideaPromptOut.value = prompt;
    if (ideaPromptFallback) ideaPromptFallback.hidden = false;
    setIdeaCopyStatus(EDITOR_STRINGS.common.copyNoBuffer, true);
    setIdeaStatus('', false);
  }
}
function setIdeaAutoStatus(message: string, isError: boolean) {
  if (!ideaAutoStatus) return;
  ideaAutoStatus.textContent = message;
  ideaAutoStatus.classList.toggle('err', isError);
}
const AI_LABELS: Record<string, string> = { gemini: 'Gemini', groq: 'Groq' };
async function postAi(route: string, body?: unknown): Promise<{ ok?: boolean; text?: string; provider?: string; message?: string; results?: Array<{ ok: boolean; message: string }>; errors?: Array<{ message: string }> } | null> {
  try {
    const response = await fetch(`/__api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return await response.json();
  } catch {
    return null;
  }
}
if (ideaAuto) ideaAuto.onclick = async () => {
  const base = ideaPromptBase();
  if (!base) return;
  let prompt: string;
  try {
    prompt = buildProjectPrompt({ ...base, catalogIndex, withBrief: true });
  } catch (error) {
    setIdeaAutoStatus(error instanceof Error ? error.message : String(error), true);
    return;
  }
  ideaAuto.disabled = true;
  if (ideaAiCheck) ideaAiCheck.disabled = true;
  setIdeaAutoStatus(EDITOR_STRINGS.project.aiCreating, false);
  setIdeaStatus('', false);
  const data = await postAi('ai/generate', { prompt });
  ideaAuto.disabled = false;
  if (ideaAiCheck) ideaAiCheck.disabled = false;
  if (!data) { setIdeaAutoStatus(EDITOR_STRINGS.project.serviceDownManualPrompt(EDITOR_STRINGS.project.serviceDown), true); return; }
  if (data.ok && typeof data.text === 'string' && ideaResponse) {
    ideaResponse.value = data.text;
    setIdeaAutoStatus(EDITOR_STRINGS.project.aiDone(AI_LABELS[data.provider ?? ''] ?? data.provider), false);
    if (checkIdeaResponse() && ideaCreate) ideaCreate.click();
    return;
  }
  setIdeaAutoStatus(data.message ?? data.errors?.[0]?.message ?? EDITOR_STRINGS.project.aiFailed, true);
  try { await copyProjectPrompt(prompt); } catch { /* буфер недоступен: промт можно скопировать кнопкой ниже */ }
};
if (ideaAutoExportText) ideaAutoExportText.textContent = EDITOR_STRINGS.project.autoExportLabel;
if (ideaAutoExport) {
  ideaAutoExport.checked = autoExportRequested();
  ideaAutoExport.onchange = () => setAutoExportRequested(ideaAutoExport.checked);
}
if (ideaSaveAllBtn) {
  ideaSaveAllBtn.textContent = EDITOR_STRINGS.project.saveAll.button;
  ideaSaveAllBtn.onclick = () => void saveAllSuggestions();
}
if (ideaAiCheck) ideaAiCheck.onclick = async () => {
  ideaAiCheck.disabled = true;
  setIdeaAutoStatus(EDITOR_STRINGS.project.aiChecking, false);
  const data = await postAi('ai/check');
  ideaAiCheck.disabled = false;
  if (!data) { setIdeaAutoStatus(EDITOR_STRINGS.project.serviceDown, true); return; }
  if (!data.results || data.results.length === 0) { setIdeaAutoStatus(EDITOR_STRINGS.project.aiNoKeys, true); return; }
  setIdeaAutoStatus(data.results.map((item) => item.message).join(' · '), data.results.every((item) => !item.ok));
};
if (ideaCopyPrompt) ideaCopyPrompt.onclick = async () => {
  const base = ideaPromptBase();
  if (!base) return;
  try {
    await copyProjectPrompt(buildProjectPrompt({ ...base, catalogIndex, withBrief: true }));
  } catch (error) {
    setIdeaCopyStatus(error instanceof Error ? error.message : String(error), true);
  }
};
if (ideaCopyProjectPrompt) ideaCopyProjectPrompt.onclick = async () => {
  const base = ideaPromptBase();
  if (!base) return;
  if (!checkBriefField()) { setIdeaCopyStatus(EDITOR_STRINGS.project.briefErrorsShort, true); return; }
  try {
    const briefText = ideaBrief?.value.trim();
    await copyProjectPrompt(buildProjectPrompt({ ...base, catalogIndex, ...(briefText ? { brief: extractBrief(briefText) } : {}) }));
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
    ideaReplyBrief = '';
    if (!text) {
      return;
    }
    if (!text.includes('{')) {
      const message = ideaReplyMessage(text);
      reportIdeaErrors([{ path: '', message }]);
      setIdeaStatus(message, true);
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
  const candidate = ideaCandidate;
  const ideaReply = validateProjectReply(candidate as ProjectV1, { catalogIds: Object.keys(catalog) });
  ideaSuggestions = ideaReply.suggestions;
  if (!confirm(EDITOR_STRINGS.project.replaceConfirm)) return;
  applyIdeaProject(candidate!);
  renderIdeaSuggestions();
};
if (ideaFix) ideaFix.onclick = () => {
  if (ideaCandidate === undefined || ideaErrList.length === 0) return;
  void copyText(buildFixRequest(ideaCandidate, ideaErrList), EDITOR_STRINGS.status.fixRequestTitle);
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

const undoButton = document.getElementById('undo');
const redoButton = document.getElementById('redo');
undoButton?.addEventListener('click', undoChange);
redoButton?.addEventListener('click', redoChange);
if (undoButton) undoButton.title = EDITOR_STRINGS.common.undoTitle;
if (redoButton) redoButton.title = EDITOR_STRINGS.common.redoTitle;

// ---------- панель «Образ сцены» ----------
const lookMoodLabels: Record<StyleMood, string> = {
  dawn: EDITOR_STRINGS.scenes.look.moodDawn,
  day: EDITOR_STRINGS.scenes.look.moodDay,
  dusk: EDITOR_STRINGS.scenes.look.moodDusk,
  night: EDITOR_STRINGS.scenes.look.moodNight,
};
function lookShotLabel(name: string): string {
  return EDITOR_STRINGS.scenes.cameraShots[name as keyof typeof EDITOR_STRINGS.scenes.cameraShots] ?? name;
}
function updateLookStyleDesc() {
  if (!lookStyleDesc) return;
  const preset = STYLE_PRESETS.find((item) => item.id === lookStyleSelect?.value);
  lookStyleDesc.textContent = preset?.description ?? '';
}
function initSceneLookPanel() {
  if (sceneLookTitleText) sceneLookTitleText.textContent = EDITOR_STRINGS.scenes.look.title;
  if (lookStyleText) lookStyleText.textContent = EDITOR_STRINGS.scenes.look.styleLabel;
  if (lookMoodText) lookMoodText.textContent = EDITOR_STRINGS.scenes.look.moodLabel;
  if (lookShotText) lookShotText.textContent = EDITOR_STRINGS.scenes.look.shotLabel;
  if (lookShotT0Text) lookShotT0Text.textContent = EDITOR_STRINGS.scenes.look.shotT0Label;
  if (lookShotDurText) lookShotDurText.textContent = EDITOR_STRINGS.scenes.look.shotDurationLabel;
  if (lookShotStrengthText) lookShotStrengthText.textContent = EDITOR_STRINGS.scenes.look.shotStrengthLabel;
  if (lookApplyStyleBtn) lookApplyStyleBtn.textContent = EDITOR_STRINGS.scenes.look.applyStyle;
  if (lookApplyStyleAllBtn) lookApplyStyleAllBtn.textContent = EDITOR_STRINGS.scenes.look.applyStyleAll;
  if (lookApplyShotBtn) lookApplyShotBtn.textContent = EDITOR_STRINGS.scenes.look.applyShot;
  if (lookRemoveShotBtn) lookRemoveShotBtn.textContent = EDITOR_STRINGS.scenes.look.removeShot;
  if (lookNoteText) lookNoteText.textContent = EDITOR_STRINGS.scenes.look.paletteNote;
  if (lookStyleSelect) {
    for (const preset of STYLE_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      lookStyleSelect.appendChild(option);
    }
    lookStyleSelect.addEventListener('change', updateLookStyleDesc);
    updateLookStyleDesc();
  }
  if (lookMoodSelect) {
    for (const mood of STYLE_MOODS) {
      const option = document.createElement('option');
      option.value = mood;
      option.textContent = lookMoodLabels[mood];
      lookMoodSelect.appendChild(option);
    }
  }
  if (lookShotSelect) {
    for (const name of CAMERA_SHOT_NAMES) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = lookShotLabel(name);
      lookShotSelect.appendChild(option);
    }
  }
}
function lookStyleChoice(): { styleId: string; mood: StyleMood } {
  return { styleId: lookStyleSelect?.value ?? '', mood: (lookMoodSelect?.value ?? 'day') as StyleMood };
}
function lookFieldNumber(input: HTMLInputElement | null): number | undefined {
  const raw = (input?.value ?? '').trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}
function applyLookStyleToScene(index: number): { ok: true; scene: SceneV1 } | { ok: false; message: string } {
  const entry = project.scenes[index];
  if (!entry) return { ok: false, message: EDITOR_STRINGS.scenes.look.noScene(index + 1) };
  const { styleId, mood } = lookStyleChoice();
  const result = applySceneStyle(entry.scene, styleId, mood);
  return result.ok ? { ok: true, scene: result.value } : { ok: false, message: result.message };
}
function onLookApplyStyle() {
  const result = applyLookStyleToScene(activeSceneIndex);
  if (!result.ok) { showErrors([{ path: 'style', message: result.message }]); return; }
  applyChange('scene-style', () => { project.scenes[activeSceneIndex].scene = result.scene; });
}
function onLookApplyStyleAll() {
  const results = project.scenes.map((_, index) => applyLookStyleToScene(index));
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) { showErrors([{ path: 'style', message: failed.message }]); return; }
  applyChange('scene-style-all', () => {
    project.scenes.forEach((entry, index) => {
      const result = results[index];
      if (result && result.ok) entry.scene = result.scene;
    });
  });
}
function onLookApplyShot() {
  const entry = project.scenes[activeSceneIndex];
  if (!entry) return;
  const shot: CameraShot = { name: (lookShotSelect?.value ?? 'static') as CameraShotName };
  const t0 = lookFieldNumber(lookShotT0);
  if (t0 !== undefined) shot.t0 = t0;
  const duration = lookFieldNumber(lookShotDur);
  if (duration !== undefined) shot.duration = duration;
  const strength = lookFieldNumber(lookShotStrength);
  if (strength !== undefined) shot.strength = strength;
  const keys = entry.scene.camera.keys.length;
  if (keys > 0 && !confirm(EDITOR_STRINGS.scenes.look.keysConfirm(keys))) return;
  const result = setSceneShot(entry.scene, shot);
  if (!result.ok) { showErrors([{ path: 'camera.shot', message: result.message }]); return; }
  applyChange('scene-shot', () => { project.scenes[activeSceneIndex].scene = result.value.scene; });
}
function onLookRemoveShot() {
  const result = setSceneShot(project.scenes[activeSceneIndex].scene, null);
  if (!result.ok) { showErrors([{ path: 'camera.shot', message: result.message }]); return; }
  applyChange('scene-shot-remove', () => { project.scenes[activeSceneIndex].scene = result.value.scene; });
}
initSceneLookPanel();
if (lookApplyStyleBtn) lookApplyStyleBtn.onclick = onLookApplyStyle;
if (lookApplyStyleAllBtn) lookApplyStyleAllBtn.onclick = onLookApplyStyleAll;
if (lookApplyShotBtn) lookApplyShotBtn.onclick = onLookApplyShot;
if (lookRemoveShotBtn) lookRemoveShotBtn.onclick = onLookRemoveShot;

syncScopeRow();
renderTemplates();
const storedScene = Number(storageGet(SCENE_TAB_KEY));
if (Number.isInteger(storedScene) && storedScene >= 0 && storedScene < project.scenes.length) {
  activeSceneIndex = storedScene;
  scene = project.scenes[storedScene].scene;
  duration = scene.duration;
}
renderTabs();
syncStoryField();
updateSavedLabel();

// Каталог: первичный рендер и обработчики
renderCatalogTabs('list');
switchCatalogPanel('list');
if (catalogSearch) catalogSearch.addEventListener('input', (e) => { catalogQuery = (e.target as HTMLInputElement).value; renderCatalogList(); });
if (catalogViewEl) catalogViewEl.addEventListener('change', (e) => { catalogViewValue = (e.target as HTMLSelectElement).value; renderCatalogList(); });
if (catalogCheckJson) catalogCheckJson.onclick = checkCatalogNewJson;
if (catalogNewJson) catalogNewJson.addEventListener('input', checkCatalogNewJson);
if (catalogCopyFixJson) catalogCopyFixJson.onclick = () => { if (newJsonCandidate === undefined || newJsonErrors.length === 0) return; void copyText(buildFixRequest(newJsonCandidate, newJsonErrors), EDITOR_STRINGS.status.fixRequestTitle); };
if (catalogSaveJson) catalogSaveJson.onclick = () => { const candidate = newJsonCandidate; if (!candidate) return; saveCatalogModel(candidate); };
if (catalogSvgFile) catalogSvgFile.addEventListener('change', checkCatalogSvg);
for (const el of document.querySelectorAll('#catalogPanelSvg input, #catalogPanelSvg select')) { if (el !== catalogSvgFile) el.addEventListener('input', checkCatalogSvg); }
if (catalogImportSvg) catalogImportSvg.onclick = importSvgToCatalog;
if (catalogCopyFixSvg) catalogCopyFixSvg.onclick = () => { if (!svgCandidate || !svgCandidate.asset) return; void copyText(buildFixRequest(svgCandidate.asset, svgCandidate.errors), EDITOR_STRINGS.status.fixRequestTitle); };
if (catalogUploadPick) catalogUploadPick.onclick = () => catalogUploadFilesInput?.click();
if (catalogUploadFilesInput) catalogUploadFilesInput.addEventListener('change', () => {
  const picked = Array.from(catalogUploadFilesInput.files ?? []);
  catalogUploadFilesInput.value = '';
  void uploadCatalogFiles(picked);
});
if (catalogUploadDrop) {
  catalogUploadDrop.addEventListener('dragover', (event) => { event.preventDefault(); catalogUploadDrop.classList.add('over'); });
  catalogUploadDrop.addEventListener('dragleave', () => catalogUploadDrop.classList.remove('over'));
  catalogUploadDrop.addEventListener('drop', (event) => {
    event.preventDefault();
    catalogUploadDrop.classList.remove('over');
    void uploadCatalogFiles(Array.from(event.dataTransfer?.files ?? []));
  });
}
if (catalogModelDesc) catalogModelDesc.addEventListener('input', updateCatalogModelPrompt);
if (catalogModelView) catalogModelView.addEventListener('change', updateCatalogModelPrompt);
if (catalogModelSizeM) catalogModelSizeM.addEventListener('input', updateCatalogModelPrompt);
if (catalogCopyModelPrompt) catalogCopyModelPrompt.onclick = copyCatalogModelPrompt;
if (catalogModelResponse) catalogModelResponse.addEventListener('input', checkCatalogModelResponse);
if (catalogSaveModel) catalogSaveModel.onclick = () => { const candidate = modelCandidate; if (!candidate) return; saveCatalogModel(candidate as CatalogAsset); };
if (catalogShowCredits) catalogShowCredits.onclick = () => { renderCatalogCredits(); if (catalogCreditsOut) { catalogCreditsOut.hidden = false; void copyText(catalogCreditsOut.textContent ?? '', EDITOR_STRINGS.catalog.creditsTitle); } };
if (catalogPlay) catalogPlay.onclick = () => setPreviewPlaying(!previewPlaying);
if (catalogTime) catalogTime.addEventListener('input', (e) => { setPreviewPlaying(false); previewTs = Number((e.target as HTMLInputElement).value); renderPreviewFrame(); });
if (catalogPreviewModel) catalogPreviewModel.addEventListener('change', () => { setPreviewPlaying(false); loadCodeEditorFromSelection(); renderPreviewFrame(); });
if (catalogCode) catalogCode.addEventListener('input', onCodeEdited);
if (catalogCodeReset) catalogCodeReset.onclick = () => { loadCodeEditorFromSelection(); renderPreviewFrame(); };
if (catalogCodeSave) catalogCodeSave.onclick = () => { const a = codeDraft?.ok ? codeDraft.asset : undefined; if (a) saveCatalogModel(a, catalogCodeStatus); };
if (catalogCodeFile) catalogCodeFile.addEventListener('change', async () => {
  const file = catalogCodeFile.files?.[0];
  if (!file || !catalogCode) return;
  catalogCode.value = await file.text();
  onCodeEdited();
  catalogCodeFile.value = '';
});
if (catalogPreset) catalogPreset.addEventListener('change', () => { setPreviewPlaying(false); renderPreviewFrame(); });

try {
  const stored = localStorage.getItem(AUTOSAVE_KEY);
  if (stored) {
    const saved = JSON.parse(stored) as { savedAt?: number; project?: unknown };
    const valid = validateProject(saved.project, { catalogIds: Object.keys(catalog) });
    if (saved.savedAt && valid.ok && confirm(EDITOR_STRINGS.project.restoreSession)) restoreProject(saved.project as ProjectV1);
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
    if (!equal(a1, a2)) { fail = EDITOR_STRINGS.preview.selfTestT0(label); break; }
    const t6 = renderToCanvas(w, h, scene, 6);
    const t6b = renderToCanvas(w, h, scene, 6);
    if (!equal(t6, t6b)) { fail = EDITOR_STRINGS.preview.selfTestT6(label); break; }
    const a0again = renderToCanvas(w, h, scene, 0);
    if (!equal(a0again, a1)) { fail = EDITOR_STRINGS.preview.selfTestBetween(label); break; }
  }
  pre.hidden = false;
  pre.textContent = fail ? `SELFTEST: FAIL: ${fail}` : 'SELFTEST: PASS';
}
