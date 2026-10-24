import assert from 'node:assert/strict';
import { formatFileToken, safeFileName } from './file-names.ts';

assert.equal(safeFileName('Что если: киты/летают. '), 'Что если_ киты_летают');
assert.equal(safeFileName('название.'), 'название');
assert.equal(formatFileToken('16:9'), '16x9');
assert.equal(formatFileToken('9:16'), '9x16');
for (const name of [safeFileName('a<>:"/\\|?*'), `${safeFileName('проект')}_${formatFileToken('16:9')}`, `${safeFileName('проект')}_${formatFileToken('9:16')}`]) {
  assert.doesNotMatch(name, /[<>:"/\\|?*\u0000-\u001f]/);
}
console.log('check:names PASS');
