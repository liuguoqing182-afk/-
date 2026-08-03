import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PIPELINE_FAILURE_COUNT,
  nextPipelineFailureOutcome,
  previousPipelineFailureCount,
  previousPipelineSkipReason,
} from '../src/app-screenshot-test-pipeline.mjs';

test('delivered screenshot pipelines remain idempotent', () => {
  assert.equal(
    previousPipelineSkipReason({ state: 'DELIVERED' }),
    'ALREADY_DELIVERED',
  );
  assert.equal(
    previousPipelineSkipReason({ state: 'DELIVERED_WITH_INCOMPLETE' }),
    'ALREADY_DELIVERED',
  );
});

test('failed screenshot pipelines are eligible for retry', () => {
  assert.equal(previousPipelineSkipReason({ state: 'FAILED' }), null);
  assert.equal(previousPipelineSkipReason({ state: 'SCREENSHOTTING' }), null);
  assert.equal(previousPipelineSkipReason(null), null);
});

test('a pipeline gets one automatic retry and then requires manual review', () => {
  assert.equal(MAX_PIPELINE_FAILURE_COUNT, 2);
  assert.equal(previousPipelineFailureCount(null), 0);
  assert.equal(previousPipelineFailureCount({ state: 'FAILED' }), 1);
  assert.deepEqual(nextPipelineFailureOutcome(null), {
    failureCount: 1,
    retryExhausted: false,
    manualReviewRequired: false,
  });
  assert.deepEqual(nextPipelineFailureOutcome({ state: 'FAILED' }), {
    failureCount: 2,
    retryExhausted: true,
    manualReviewRequired: true,
  });
  assert.equal(
    previousPipelineSkipReason({
      state: 'FAILED_RETRY_EXHAUSTED',
      failureCount: 2,
    }),
    'FAILED_RETRY_EXHAUSTED',
  );
});
