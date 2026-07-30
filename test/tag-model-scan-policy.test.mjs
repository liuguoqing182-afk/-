import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TAG_BOUNDARY_MATCHING_SWIPE_READS,
  TAG_MODEL_QUICK_BACKWARD_SWIPES,
  TAG_MODEL_QUICK_FORWARD_SWIPES,
  TAG_MODEL_QUICK_VISIBLE_LIMIT,
  TAG_MODEL_SCAN_MODES,
  tagModelScanModeForTask,
} from '../src/tag-model-scan-policy.mjs';

function taskWithStates(states) {
  return {
    modelAssertions: states.map((expectedState, index) => ({
      id: String(index + 1),
      name: `Model ${index + 1}`,
      expectedState,
    })),
  };
}

test('uses the first-eight scan for one through four added models', () => {
  for (let count = 1; count <= 4; count += 1) {
    assert.equal(
      tagModelScanModeForTask(taskWithStates(Array(count).fill('PRESENT'))),
      TAG_MODEL_SCAN_MODES.FIRST_EIGHT,
    );
  }
});

test('uses the full scan for more than four added models', () => {
  assert.equal(
    tagModelScanModeForTask(taskWithStates(Array(5).fill('PRESENT'))),
    TAG_MODEL_SCAN_MODES.FULL,
  );
});

test('uses the full scan whenever a deleted model is asserted', () => {
  assert.equal(
    tagModelScanModeForTask(
      taskWithStates(['PRESENT', 'PRESENT', 'ABSENT']),
    ),
    TAG_MODEL_SCAN_MODES.FULL,
  );
});

test('uses the full scan when there is no added-model assertion', () => {
  assert.equal(
    tagModelScanModeForTask(taskWithStates([])),
    TAG_MODEL_SCAN_MODES.FULL,
  );
});

test('quick scan constants enforce first eight, two forward, two backward', () => {
  assert.equal(TAG_MODEL_QUICK_VISIBLE_LIMIT, 8);
  assert.equal(TAG_MODEL_QUICK_FORWARD_SWIPES, 2);
  assert.equal(TAG_MODEL_QUICK_BACKWARD_SWIPES, 2);
});


test('two identical post-swipe text reads confirm a tag boundary', () => {
  assert.equal(TAG_BOUNDARY_MATCHING_SWIPE_READS, 2);
});
