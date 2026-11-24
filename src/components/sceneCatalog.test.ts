import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmbeddedSceneUrl,
  getNextSceneIndex,
  getSceneById,
  LOW_CORTISOL_SCENES,
  resolveSceneFromQuery,
} from './sceneCatalog';

test('LOW_CORTISOL_SCENES puts Moss & Pappus first and includes all five scenes', () => {
  const ids = LOW_CORTISOL_SCENES.map((s) => s.id);
  assert.deepEqual(ids, ['moss', 'snow', 'dog', 'film', 'arc']);
  assert.equal(getSceneById('moss').name, 'Moss & Pappus');
  assert.equal(getSceneById('arc').name, 'Arc String');
});

test('getNextSceneIndex wraps cleanly in both directions for keyboard listbox navigation', () => {
  assert.equal(getNextSceneIndex(0, -1, 5), 4);
  assert.equal(getNextSceneIndex(4, 1, 5), 0);
  assert.equal(getNextSceneIndex(2, 1, 5), 3);
});

test('resolveSceneFromQuery maps URL aliases cleanly and defaults to moss', () => {
  assert.equal(resolveSceneFromQuery('moss-tree'), 'moss');
  assert.equal(resolveSceneFromQuery('snow'), 'snow');
  assert.equal(resolveSceneFromQuery('petting'), 'dog');
  assert.equal(resolveSceneFromQuery('film-bloom'), 'film');
  assert.equal(resolveSceneFromQuery('arc'), 'arc');
  assert.equal(resolveSceneFromQuery('arc-string'), 'arc');
  assert.equal(resolveSceneFromQuery(null), 'moss');
});

test('buildEmbeddedSceneUrl targets self-hosted /scenes/ and forwards allowlisted flags only', () => {
  assert.equal(buildEmbeddedSceneUrl('moss'), '/scenes/?demo=moss');
  assert.equal(
    buildEmbeddedSceneUrl('dog', '?demo=dog&breed=husky&webgl=1&q=high&evil=drop'),
    '/scenes/?demo=dog&breed=husky&webgl=1&q=high'
  );
});
