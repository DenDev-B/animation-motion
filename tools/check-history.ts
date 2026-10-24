import assert from 'node:assert/strict';
import { EditorHistory } from '../editor/history.ts';
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
console.log('check:history PASS');
