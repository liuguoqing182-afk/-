import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS,
  TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES,
  createTagNameCollectionRetryState,
  currentScreenVisionAttemptMaxForTag,
  markTagNameCollectionRetryUsed,
  shouldRetryMissingAddedTagModels,
  shouldRetryTagNameCollectionIncomplete,
} from '../src/tag-name-collection-retry-policy.mjs';

const retryable = {
  module: '新首页配置',
  businessVerdict: 'ERROR',
  verdictReasonCode: 'TAG_MODEL_NAME_COLLECTION_INCOMPLETE',
  attempt: 1,
};

test('retries the first incomplete name collection for every new-home tag', () => {
  for (const objectName of ['New', 'Trend Hub', 'Best Companion']) {
    assert.equal(
      shouldRetryTagNameCollectionIncomplete({
        ...retryable,
        objectName,
      }),
      true,
    );
  }
});

test('retries the first incomplete name collection for AI Filter tags', () => {
  assert.equal(
    shouldRetryTagNameCollectionIncomplete({
      ...retryable,
      module: 'More Style AI Filter配置',
      objectName: 'Baby',
    }),
    true,
  );
});

test('retries the first incomplete name collection for Video tags', () => {
  assert.equal(
    shouldRetryTagNameCollectionIncomplete({
      ...retryable,
      module: 'More Style Video配置',
      objectName: 'Viral Dance',
    }),
    true,
  );
});

test('does not retry the same collection error after the extra attempt', () => {
  assert.equal(
    shouldRetryTagNameCollectionIncomplete({
      ...retryable,
      attempt: 2,
    }),
    false,
  );
});

test('retries vision on the current screen only for tags with ABSENT assertions', () => {
  assert.equal(
    currentScreenVisionAttemptMaxForTag({
      modelAssertions: [
        { id: '22046', name: 'Western Reckoning II', expectedState: 'ABSENT' },
      ],
    }),
    2,
  );
  assert.equal(
    currentScreenVisionAttemptMaxForTag({
      modelAssertions: [
        { id: '3054', name: 'Spray Mural', expectedState: 'PRESENT' },
      ],
    }),
    1,
  );
  assert.equal(
    currentScreenVisionAttemptMaxForTag({ modelAssertions: [] }),
    1,
  );
});

test('keeps one incomplete-collection retry for an ABSENT task after another attempt failed', () => {
  const retryState = createTagNameCollectionRetryState();
  const request = {
    ...retryable,
    attempt: 2,
    modelAssertions: [
      { id: '22046', name: 'Western Reckoning II', expectedState: 'ABSENT' },
    ],
    retryState,
  };

  assert.equal(shouldRetryTagNameCollectionIncomplete(request), true);
  markTagNameCollectionRetryUsed({
    retryState,
    failureType: TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.INCOMPLETE,
  });
  assert.equal(
    shouldRetryTagNameCollectionIncomplete({ ...request, attempt: 3 }),
    false,
  );
});

test('does not affect excluded modules, verdicts, or reasons', () => {
  const nonRetryableOverrides = [
    { module: '模版修改' },
    { businessVerdict: 'FAIL' },
    { verdictReasonCode: 'TAG_MODEL_NAME_UNRESOLVED' },
  ];

  for (const override of nonRetryableOverrides) {
    assert.equal(
      shouldRetryTagNameCollectionIncomplete({
        ...retryable,
        ...override,
      }),
      false,
    );
  }
});

test('retries one missing added tag model after a positive delay', () => {
  assert.ok(MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS > 0);
  assert.equal(
    shouldRetryMissingAddedTagModels({
      module: 'More Style AI Filter配置',
      businessVerdict: 'FAIL',
      verdictReasonCode: 'TAG_MODEL_NAME_MISMATCH',
      missingModels: [
        { id: '3051', name: 'Diving Paw', expectedState: 'PRESENT' },
      ],
      attempt: 1,
    }),
    true,
  );
});

test('does not retry deletion mismatch or a second missing-model attempt', () => {
  const base = {
    module: 'More Style AI Filter配置',
    businessVerdict: 'FAIL',
    verdictReasonCode: 'TAG_MODEL_NAME_MISMATCH',
    missingModels: [
      { id: '3051', name: 'Diving Paw', expectedState: 'PRESENT' },
    ],
    attempt: 1,
  };

  assert.equal(
    shouldRetryMissingAddedTagModels({ ...base, attempt: 2 }),
    false,
  );
  assert.equal(
    shouldRetryMissingAddedTagModels({
      ...base,
      missingModels: [
        { id: '1443', name: 'Magic World', expectedState: 'ABSENT' },
      ],
    }),
    false,
  );
});

test('tracks missing-added and incomplete-collection retry chances independently for a mixed ABSENT task', () => {
  const retryState = createTagNameCollectionRetryState();
  const modelAssertions = [
    { id: '3054', name: 'Spray Mural', expectedState: 'PRESENT' },
    { id: '22046', name: 'Western Reckoning II', expectedState: 'ABSENT' },
  ];
  markTagNameCollectionRetryUsed({
    retryState,
    failureType: TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.INCOMPLETE,
  });

  const request = {
    module: '新首页配置',
    businessVerdict: 'FAIL',
    verdictReasonCode: 'TAG_MODEL_NAME_MISMATCH',
    missingModels: [
      { id: '3054', name: 'Spray Mural', expectedState: 'PRESENT' },
    ],
    attempt: 2,
    modelAssertions,
    retryState,
  };
  assert.equal(shouldRetryMissingAddedTagModels(request), true);

  markTagNameCollectionRetryUsed({
    retryState,
    failureType:
      TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.MISSING_ADDED_MODEL,
  });
  assert.equal(
    shouldRetryMissingAddedTagModels({ ...request, attempt: 3 }),
    false,
  );
});

test('checks a missing added model before accepting screenshots as final', async () => {
  const runnerSource = await fs.readFile(
    new URL('../scripts/run-app-screenshot-plan.mjs', import.meta.url),
    'utf8',
  );
  const retryCheckIndex = runnerSource.indexOf(
    'shouldRetryMissingAddedTagModels({',
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
  assert.match(
    retryBlock,
    /await sleep\(MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS\)/u,
  );
  assert.match(retryBlock, /missingModels: missingAddedModels/u);
});

test('checks the module retry before accepting screenshots as final', async () => {
  const runnerSource = await fs.readFile(
    new URL('../scripts/run-app-screenshot-plan.mjs', import.meta.url),
    'utf8',
  );
  const retryCheckIndex = runnerSource.indexOf(
    'shouldRetryTagNameCollectionIncomplete({',
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
    'businessVerdict: taskOutcome.businessVerdict',
    'verdictReasonCode: taskOutcome.verdictReasonCode',
    'attempt',
    'modelAssertions: task.modelAssertions',
    'retryState: tagNameCollectionRetryState',
  ]) {
    assert.ok(retryBlock.includes(expectedField));
  }
});

test('runner performs the ABSENT current-screen vision retry before caching the result', async () => {
  const runnerSource = await fs.readFile(
    new URL('../scripts/run-app-screenshot-plan.mjs', import.meta.url),
    'utf8',
  );
  const observeStart = runnerSource.indexOf(
    'async function observeTagModelScreen(',
  );
  const observeEnd = runnerSource.indexOf(
    'async function scanTagModelNamesFull(',
    observeStart,
  );
  const observeBlock = runnerSource.slice(observeStart, observeEnd);

  assert.match(observeBlock, /currentScreenVisionAttemptMaxForTag\(\{/u);
  assert.match(
    observeBlock,
    /visionAttempt <= visionAttemptMax/u,
  );
  assert.match(observeBlock, /TAG_MODEL_VISION_RETRY/u);
  assert.ok(
    observeBlock.indexOf('visionAttempt <= visionAttemptMax') <
      observeBlock.indexOf('visionCache.set(hierarchySignature'),
  );
});

test('runner can extend the final attempt only for a claimed ABSENT failure-type retry', async () => {
  const runnerSource = await fs.readFile(
    new URL('../scripts/run-app-screenshot-plan.mjs', import.meta.url),
    'utf8',
  );
  const reserveStart = runnerSource.indexOf(
    'const reserveIndependentTagRetry =',
  );
  const loopStart = runnerSource.indexOf('for (', reserveStart);
  const reserveBlock = runnerSource.slice(reserveStart, loopStart);

  assert.ok(reserveStart >= 0);
  assert.match(reserveBlock, /markTagNameCollectionRetryUsed\(\{/u);
  assert.match(
    reserveBlock,
    /taskHasAbsentModelAssertion && attempt >= taskAttemptMax/u,
  );
  assert.match(reserveBlock, /taskAttemptMax = attempt \+ 1/u);
  assert.match(
    runnerSource.slice(loopStart, loopStart + 180),
    /attempt <= taskAttemptMax/u,
  );
});
