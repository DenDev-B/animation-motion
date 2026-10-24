import fs from 'node:fs';
import assert from 'node:assert/strict';
import { locateFrame, projectFrameCount, validateProject, type ProjectV1 } from '../engine/project.ts';

const project = JSON.parse(fs.readFileSync('projects/whale-demo.project.json', 'utf8')) as ProjectV1;
assert.deepEqual(validateProject(project), { ok: true, errors: [], warnings: [] });
const total = projectFrameCount(project);
const firstCount = Math.round(project.scenes[0].scene.duration * project.fps);
assert.equal(locateFrame(project, firstCount - 1).sceneIndex, 0);
assert.equal(locateFrame(project, firstCount).sceneIndex, 1);
assert.equal(total, project.scenes.reduce((sum, entry) => sum + Math.round(entry.scene.duration * project.fps), 0));

function expectError(change: (value: any) => void, path: string) {
  const value = structuredClone(project);
  change(value);
  const result = validateProject(value);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.path === path), `ожидалась ошибка ${path}: ${JSON.stringify(result.errors)}`);
}

expectError((value) => { value.scenes[1].id = value.scenes[0].id; }, 'scenes[1].id');
expectError((value) => { value.scenes = []; }, 'scenes');
expectError((value) => { value.fps = 25; }, 'fps');
expectError((value) => { value.format = 'square'; }, 'format');
expectError((value) => { value.scenes[1].scene.layers = 'broken'; }, 'scenes[1].scene.layers');

console.log('check:project PASS');
