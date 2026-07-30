import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isMoreStyleTagFlow,
  isTagModelTreeEvidenceFlow,
  moreStyleModelEvidenceComplete,
  tagModelTreeEvidenceComplete,
} from '../src/more-style-safe-speed-policy.mjs';

function task(flow, modelAssertions) {
  return { flow, modelAssertions };
}

test('recognizes only More Style Video and Filter tag flows', () => {
  assert.equal(isMoreStyleTagFlow('VIDEO_TAG'), true);
  assert.equal(isMoreStyleTagFlow('FILTER_TAG'), true);
  assert.equal(isMoreStyleTagFlow('HOME_TAG'), false);
});

test('tree-evidence optimization covers Home, Video, and Filter tags', () => {
  assert.equal(isTagModelTreeEvidenceFlow('HOME_TAG'), true);
  assert.equal(isTagModelTreeEvidenceFlow('VIDEO_TAG'), true);
  assert.equal(isTagModelTreeEvidenceFlow('FILTER_TAG'), true);
  assert.equal(isTagModelTreeEvidenceFlow('MODEL_SEARCH'), false);
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

test('accepts exact Home present evidence accumulated across tree reads', () => {
  const currentTask = task('HOME_TAG', [
    { name: 'Anniversary Reel', expectedState: 'PRESENT' },
    { name: 'Global Touch', expectedState: 'PRESENT' },
  ]);

  assert.equal(
    tagModelTreeEvidenceComplete(
      currentTask,
      ['Anniversary Reel'],
      ['  global   touch '],
    ),
    true,
  );
});

test('More Style compatibility wrapper remains restricted to More Style', () => {
  const present = [{ name: 'Sweet Scoop', expectedState: 'PRESENT' }];
  assert.equal(
    moreStyleModelEvidenceComplete(task('HOME_TAG', present), [], [
      'Sweet Scoop',
    ]),
    false,
  );
});

test('More Style still keeps AI for deletion, unresolved, and incomplete evidence', () => {
  const present = [{ name: 'Sweet Scoop', expectedState: 'PRESENT' }];
  assert.equal(
    tagModelTreeEvidenceComplete(
      task('FILTER_TAG', [
        { name: 'Sweet Scoop', expectedState: 'ABSENT' },
      ]),
      [],
      ['Sweet Scoop'],
    ),
    false,
  );
  assert.equal(
    tagModelTreeEvidenceComplete(
      task('VIDEO_TAG', [{ name: null, expectedState: 'PRESENT' }]),
      [],
      [],
    ),
    false,
  );
  assert.equal(
    tagModelTreeEvidenceComplete(
      task('FILTER_TAG', present),
      [],
      [],
    ),
    false,
  );
});

test('Home keeps AI for deletion, unresolved, and incomplete evidence', () => {
  const present = [{ name: 'Anniversary Reel', expectedState: 'PRESENT' }];
  assert.equal(
    tagModelTreeEvidenceComplete(
      task('HOME_TAG', [
        { name: 'Anniversary Reel', expectedState: 'ABSENT' },
      ]),
      [],
      ['Anniversary Reel'],
    ),
    false,
  );
  assert.equal(
    tagModelTreeEvidenceComplete(
      task('HOME_TAG', [{ name: null, expectedState: 'PRESENT' }]),
      [],
      [],
    ),
    false,
  );
  assert.equal(
    tagModelTreeEvidenceComplete(task('HOME_TAG', present), [], []),
    false,
  );
  assert.equal(
    tagModelTreeEvidenceComplete(
      task('HOME_TAG', [
        { name: 'Anniversary Reel', expectedState: 'PRESENT' },
        { name: 'Global Touch', expectedState: 'PRESENT' },
      ]),
      ['Anniversary Reel'],
      [],
    ),
    false,
  );
});
