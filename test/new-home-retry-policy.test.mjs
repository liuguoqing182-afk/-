import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  shouldRetryNewHomeNameCollectionIncomplete,
} from '../src/new-home-retry-policy.mjs';

const retryable = {
  module: '新首页配置',
  objectName: 'New',
  businessVerdict: 'ERROR',
  verdictReasonCode: 'TAG_MODEL_NAME_COLLECTION_INCOMPLETE',
  attempt: 1,
};

test('retries the first incomplete New name collection once', () => {
  assert.equal(
    shouldRetryNewHomeNameCollectionIncomplete(retryable),
    true,
  );
});

test('does not retry the same New collection error after the extra attempt', () => {
  assert.equal(
    shouldRetryNewHomeNameCollectionIncomplete({
      ...retryable,
      attempt: 2,
    }),
    false,
  );
});

test('does not affect other modules, tags, verdicts, or reasons', () => {
  const nonRetryableOverrides = [
    { module: 'More Style Video配置' },
    { objectName: 'Trend Hub' },
    { businessVerdict: 'FAIL' },
    { verdictReasonCode: 'TAG_MODEL_NAME_UNRESOLVED' },
  ];

  for (const override of nonRetryableOverrides) {
    assert.equal(
      shouldRetryNewHomeNameCollectionIncomplete({
        ...retryable,
        ...override,
      }),
      false,
    );
  }
});

test('checks the New retry before accepting screenshots as final', async () => {
  const runnerSource = await fs.readFile(
    new URL('../scripts/run-app-screenshot-plan.mjs', import.meta.url),
    'utf8',
  );
  const retryCheckIndex = runnerSource.indexOf(
    'shouldRetryNewHomeNameCollectionIncomplete({',
  );
  const screenshotAcceptanceIndex = runnerSource.indexOf(
    'if (attemptRecord.screenshots.length < task.screenshotTotal)',
    retryCheckIndex,
  );

  assert.ok(retryCheckIndex >= 0);
  assert.ok(screenshotAcceptanceIndex > retryCheckIndex);
  const retryBlock = runnerSource.slice(
    retryCheckIndex,
    screenshotAcceptanceIndex,
  );
  for (const expectedField of [
    'module: task.module',
    'objectName: task.objectName',
    'businessVerdict: taskOutcome.businessVerdict',
    'verdictReasonCode: taskOutcome.verdictReasonCode',
    'attempt',
  ]) {
    assert.ok(retryBlock.includes(expectedField));
  }
});
