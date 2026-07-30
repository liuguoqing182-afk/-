import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVisibleModelNames } from '../src/tag-model-name-parser.mjs';

test('parses scalar delimiter response from the tag-card vision query', () => {
  assert.deepEqual(
    parseVisibleModelNames({
      visibleModelTitlesText:
        'Paw Driver || Petal Awakening || Tulip Cradle',
    }),
    ['Paw Driver', 'Petal Awakening', 'Tulip Cradle'],
  );
});

test('unwraps nested and legacy array responses without duplicate names', () => {
  assert.deepEqual(
    parseVisibleModelNames({
      result: {
        tagModelScan: {
          visibleModelNames: ['Grainy Portrait', 'grainy   portrait'],
        },
      },
    }),
    ['Grainy Portrait'],
  );
});

test('parses JSON text and numbered lines', () => {
  assert.deepEqual(
    parseVisibleModelNames({
      content: JSON.stringify(['Paw Driver', 'Petal Awakening']),
    }),
    ['Paw Driver', 'Petal Awakening'],
  );
  assert.deepEqual(
    parseVisibleModelNames('1. Paw Driver\n2. Petal Awakening'),
    ['Paw Driver', 'Petal Awakening'],
  );
});
