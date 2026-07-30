import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isMoreStyleTagFlow,
  moreStyleModelEvidenceComplete,
} from '../src/more-style-safe-speed-policy.mjs';

function task(flow, modelAssertions) {
  return { flow, modelAssertions };
}

test('recognizes only More Style Video and Filter tag flows', () => {
  assert.equal(isMoreStyleTagFlow('VIDEO_TAG'), true);
  assert.equal(isMoreStyleTagFlow('FILTER_TAG'), true);
  assert.equal(isMoreStyleTagFlow('HOME_TAG'), false);
});

test('accepts exact present evidence accumulated from tree and prior reads', () => {
  const currentTask = task('VIDEO_TAG', [
    { name: 'Michael Dance 3', expectedState: 'PRESENT' },
    { name: 'Michael Dance 4', expectedState: 'PRESENT' },
  ]);

  assert.equal(
    moreStyleModelEvidenceComplete(
      currentTask,
      ['Michael Dance 3'],
      ['  michael   dance 4 '],
    ),
    true,
  );
});

test('keeps AI for Home, deletion, unresolved, and incomplete evidence', () => {
  const present = [{ name: 'Sweet Scoop', expectedState: 'PRESENT' }];
  assert.equal(
    moreStyleModelEvidenceComplete(task('HOME_TAG', present), [], [
      'Sweet Scoop',
    ]),
    false,
  );
  assert.equal(
    moreStyleModelEvidenceComplete(
      task('FILTER_TAG', [
        { name: 'Sweet Scoop', expectedState: 'ABSENT' },
      ]),
      [],
      ['Sweet Scoop'],
    ),
    false,
  );
  assert.equal(
    moreStyleModelEvidenceComplete(
      task('FILTER_TAG', [{ name: null, expectedState: 'PRESENT' }]),
      [],
      [],
    ),
    false,
  );
  assert.equal(
    moreStyleModelEvidenceComplete(task('FILTER_TAG', present), [], []),
    false,
  );
});
