export function shouldRetryNewHomeNameCollectionIncomplete({
  module,
  objectName,
  businessVerdict,
  verdictReasonCode,
  attempt,
}) {
  return (
    module === '新首页配置' &&
    objectName === 'New' &&
    businessVerdict === 'ERROR' &&
    verdictReasonCode === 'TAG_MODEL_NAME_COLLECTION_INCOMPLETE' &&
    attempt === 1
  );
}
