import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmbeddedSceneUrl,
  getNextSceneIndex,
  getSceneById,
  LOW_CORTISOL_SCENES,
  resolveSceneFromQuery,
} from './sceneCatalog';

test('LOW_CORTISOL_SCENES includes all four original scenes plus Arc String', () => {
  const ids = LOW_CORTISOL_SCENES.map((s) => s.id);
  assert.deepEqual(ids, ['arc', 'moss', 'snow', 'dog', 'film']);
  assert.equal(getSceneById('arc').name, 'Arc String');
  assert.equal(getSceneById('moss').name, 'Moss & Pappus');
});

test('getNextSceneIndex wraps cleanly in both directions for keyboard listbox navigation', () => {
  assert.equal(getNextSceneIndex(0, -1, 5), 4);
  assert.equal(getNextSceneIndex(4, 1, 5), 0);
  assert.equal(getNextSceneIndex(2, 1, 5), 3);
});

test('resolveSceneFromQuery maps URL aliases cleanly', () => {
  assert.equal(resolveSceneFromQuery('moss-tree'), 'moss');
  assert.equal(resolveSceneFromQuery('snow'), 'snow');
  assert.equal(resolveSceneFromQuery('petting'), 'dog');
  assert.equal(resolveSceneFromQuery('film-bloom'), 'film');
  assert.equal(resolveSceneFromQuery('arc'), 'arc');
  assert.equal(resolveSceneFromQuery(null), 'arc');
});

test('buildEmbeddedSceneUrl targets self-hosted /scenes/index.html and forwards allowlisted flags only', () => {
  assert.equal(buildEmbeddedSceneUrl('moss'), '/scenes/index.html?demo=moss');
  assert.equal(
    buildEmbeddedSceneUrl('dog', '?demo=dog&breed=husky&webgl=1&q=high&evil=drop'),
    '/scenes/index.html?demo=dog&breed=husky&webgl=1&q=high'
  );
});
