const RETRYABLE_TAG_MODULES = new Set([
  '新首页配置',
  'More Style Video配置',
  'More Style AI Filter配置',
]);

export const MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS = 30_000;

export const TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES = Object.freeze({
  INCOMPLETE: 'TAG_MODEL_NAME_COLLECTION_INCOMPLETE',
  MISSING_ADDED_MODEL: 'MISSING_ADDED_TAG_MODEL',
});

export function hasAbsentTagModelAssertion(modelAssertions) {
  return (
    Array.isArray(modelAssertions) &&
    modelAssertions.some(
      (assertion) => assertion?.expectedState === 'ABSENT',
    )
  );
}

export function currentScreenVisionAttemptMaxForTag({ modelAssertions }) {
  return hasAbsentTagModelAssertion(modelAssertions) ? 2 : 1;
}

export function createTagNameCollectionRetryState() {
  return {
    retryCountByFailureType: {},
  };
}

function hasFailureTypeRetryAvailable(retryState, failureType) {
  return (
    retryState?.retryCountByFailureType &&
    Number(retryState.retryCountByFailureType[failureType] ?? 0) < 1
  );
}

export function markTagNameCollectionRetryUsed({
  retryState,
  failureType,
}) {
  if (!retryState?.retryCountByFailureType || !failureType) return;
  retryState.retryCountByFailureType[failureType] =
    Number(retryState.retryCountByFailureType[failureType] ?? 0) + 1;
}

export function shouldRetryTagNameCollectionIncomplete({
  module,
  businessVerdict,
  verdictReasonCode,
  attempt,
  modelAssertions,
  retryState,
}) {
  const matchesFailure =
    RETRYABLE_TAG_MODULES.has(module) &&
    businessVerdict === 'ERROR' &&
    verdictReasonCode ===
      TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.INCOMPLETE;
  if (!matchesFailure) return false;

  if (
    hasAbsentTagModelAssertion(modelAssertions) &&
    retryState?.retryCountByFailureType
  ) {
    return hasFailureTypeRetryAvailable(
      retryState,
      TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.INCOMPLETE,
    );
  }

  return attempt === 1;
}

export function shouldRetryMissingAddedTagModels({
  module,
  businessVerdict,
  verdictReasonCode,
  missingModels,
  attempt,
  modelAssertions,
  retryState,
}) {
  const matchesFailure =
    RETRYABLE_TAG_MODULES.has(module) &&
    businessVerdict === 'FAIL' &&
    verdictReasonCode === 'TAG_MODEL_NAME_MISMATCH' &&
    Array.isArray(missingModels) &&
    missingModels.some(
      (model) => model?.expectedState === 'PRESENT' && model?.name,
    );
  if (!matchesFailure) return false;

  if (
    hasAbsentTagModelAssertion(modelAssertions) &&
    retryState?.retryCountByFailureType
  ) {
    return hasFailureTypeRetryAvailable(
      retryState,
      TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.MISSING_ADDED_MODEL,
    );
  }

  return attempt === 1;
}
