const RETRYABLE_TAG_MODULES = new Set([
  '新首页配置',
  'More Style Video配置',
  'More Style AI Filter配置',
]);

export const MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS = 30_000;

export function shouldRetryTagNameCollectionIncomplete({
  module,
  businessVerdict,
  verdictReasonCode,
  attempt,
}) {
  return (
    RETRYABLE_TAG_MODULES.has(module) &&
    businessVerdict === 'ERROR' &&
    verdictReasonCode === 'TAG_MODEL_NAME_COLLECTION_INCOMPLETE' &&
    attempt === 1
  );
}

export function shouldRetryMissingAddedTagModels({
  module,
  businessVerdict,
  verdictReasonCode,
  missingModels,
  attempt,
}) {
  return (
    RETRYABLE_TAG_MODULES.has(module) &&
    businessVerdict === 'FAIL' &&
    verdictReasonCode === 'TAG_MODEL_NAME_MISMATCH' &&
    attempt === 1 &&
    Array.isArray(missingModels) &&
    missingModels.some(
      (model) => model?.expectedState === 'PRESENT' && model?.name,
    )
  );
}
