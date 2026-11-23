import fs from 'node:fs';
import assert from 'node:assert/strict';
import { EditorHistory, shouldHandleUndoKey } from '../editor/history.ts';
import { applyTargetJson, targetJson, validateTargetJson, type JsonTarget } from '../editor/json-patch.ts';
import type { ProjectV1 } from '../engine/project.ts';

const makeProject = (): ProjectV1 => ({ version: 1, title: '0', fps: 30, format: '16:9', scenes: [] });
const history = new EditorHistory(makeProject(), 100, -1);
let state = makeProject();
for (let i = 1; i <= 5; i++) { state.title = String(i); history.push(`edit-${i}`, state); state = structuredClone(state); }
assert.equal(history.undo()?.title, '4');
assert.equal(history.undo()?.title, '3');
assert.equal(history.undo()?.title, '2');
assert.equal(history.redo()?.title, '3');
history.push('new', { ...state, title: 'new' });
assert.equal(history.canRedo, false);

const limited = new EditorHistory(makeProject(), 100, -1);
state = makeProject();
for (let i = 1; i <= 105; i++) { state.title = String(i); limited.push(`edit-${i}`, state); state = structuredClone(state); }
let undos = 0; while (limited.undo()) undos++;
assert.equal(undos, 100);

const independent = new EditorHistory(makeProject(), 100, -1);
state = makeProject(); state.title = 'saved'; independent.push('edit', state); state.title = 'mutated';
assert.equal(independent.undo()?.title, '0');

const demo = JSON.parse(fs.readFileSync('projects/whale-demo.project.json', 'utf8')) as ProjectV1;
const catalogIds = ['whale'];
const originalSceneTitle = demo.scenes[0].scene.title;
const sceneTarget: JsonTarget = { scope: 'scene', sceneIndex: 0, layerIndex: 0, objectIndex: 0 };
const editedScene = structuredClone(demo.scenes[0].scene);
editedScene.title = 'после ИИ';
assert.equal(validateTargetJson(demo, sceneTarget, editedScene, catalogIds).ok, true);
const appliedScene = applyTargetJson(demo, sceneTarget, editedScene);
assert.equal(appliedScene.scenes[0].scene.title, 'после ИИ');
assert.equal(demo.scenes[0].scene.title, originalSceneTitle);
const jsonHistory = new EditorHistory(demo, 100, -1);
jsonHistory.push('apply-json', appliedScene);
assert.equal(jsonHistory.undo()?.scenes[0].scene.title, demo.scenes[0].scene.title);
assert.equal(jsonHistory.redo()?.scenes[0].scene.title, 'после ИИ');

const layers = demo.scenes[0].scene.layers;
const layerIndex = layers.findIndex((entry) => entry.objects.length > 0);
assert.ok(layerIndex >= 0, 'в демо-проекте нет объектов');
const original = layers[layerIndex].objects[0];
const objectTarget: JsonTarget = { scope: 'object', sceneIndex: 0, layerIndex, objectIndex: 0 };
assert.deepEqual(targetJson(demo, objectTarget), original);
const editedObject = { ...structuredClone(original), name: 'объект после ИИ' };
const objectResult = validateTargetJson(demo, objectTarget, editedObject, catalogIds);
assert.equal(objectResult.ok, true, JSON.stringify(objectResult.errors));
const appliedObject = applyTargetJson(demo, objectTarget, editedObject);
assert.equal(appliedObject.scenes[0].scene.layers[layerIndex].objects[0].name, 'объект после ИИ');
assert.equal(demo.scenes[0].scene.layers[layerIndex].objects[0].name, original.name);
const brokenObject = { ...structuredClone(original), x: 'нет' };
const brokenResult = validateTargetJson(demo, objectTarget, brokenObject, catalogIds);
assert.equal(brokenResult.ok, false);
assert.ok(brokenResult.errors.some((issue) => issue.path === 'x'));

const projectTarget: JsonTarget = { scope: 'project', sceneIndex: 0, layerIndex: 0, objectIndex: 0 };
const editedProject = structuredClone(demo);
editedProject.title = 'Проект после ИИ';
assert.equal(validateTargetJson(demo, projectTarget, editedProject, catalogIds).ok, true);
assert.equal(applyTargetJson(demo, projectTarget, editedProject).title, 'Проект после ИИ');
assert.notEqual(demo.title, 'Проект после ИИ');

// --- горячие клавиши отмены/повтора (shouldHandleUndoKey) ---
const key = (over: Partial<Parameters<typeof shouldHandleUndoKey>[0]>) => ({ key: 'z', ...over });
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, target: { tagName: 'DIV' } })), 'undo', 'Ctrl+Z вне поля — отмена');
assert.equal(shouldHandleUndoKey(key({ metaKey: true, target: { tagName: 'DIV' } })), 'undo', 'Cmd+Z вне поля — отмена');
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, shiftKey: true, target: { tagName: 'DIV' } })), 'redo', 'Ctrl+Shift+Z — повтор');
assert.equal(shouldHandleUndoKey(key({ metaKey: true, shiftKey: true, target: { tagName: 'DIV' } })), 'redo', 'Cmd+Shift+Z — повтор');
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, key: 'y', target: { tagName: 'DIV' } })), 'redo', 'Ctrl+Y — повтор');
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, target: { tagName: 'INPUT' } })), null, 'Ctrl+Z в input не перехватывается');
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, target: { tagName: 'TEXTAREA' } })), null, 'Ctrl+Z в textarea не перехватывается');
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, target: { tagName: 'SELECT' } })), null, 'Ctrl+Z в select не перехватывается');
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true } })), null, 'Ctrl+Z в contenteditable не перехватывается');
assert.equal(shouldHandleUndoKey(key({ target: { tagName: 'DIV' } })), null, 'без Ctrl/Cmd — не наша клавиша');
assert.equal(shouldHandleUndoKey(key({ ctrlKey: true, key: 'a', target: { tagName: 'DIV' } })), null, 'Ctrl+A — не наша клавиша');

console.log('check:history PASS');
