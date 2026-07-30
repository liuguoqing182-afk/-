export const TAG_MODEL_SCAN_MODES = Object.freeze({
  FIRST_EIGHT: 'FIRST_EIGHT',
  FULL: 'FULL',
  FULL_FALLBACK: 'FULL_FALLBACK',
});

export const TAG_MODEL_QUICK_VISIBLE_LIMIT = 8;
export const TAG_MODEL_QUICK_FORWARD_SWIPES = 2;
export const TAG_MODEL_QUICK_BACKWARD_SWIPES = 2;
export const TAG_BOUNDARY_MATCHING_SWIPE_READS = 2;

export function tagModelScanModeForTask(task = {}) {
  const assertions = Array.isArray(task.modelAssertions)
    ? task.modelAssertions
    : [];
  const addedModels = assertions.filter(
    (assertion) => assertion?.expectedState === 'PRESENT',
  );
  const hasDeletedModel = assertions.some(
    (assertion) => assertion?.expectedState === 'ABSENT',
  );

  if (
    addedModels.length >= 1 &&
    addedModels.length <= 4 &&
    !hasDeletedModel
  ) {
    return TAG_MODEL_SCAN_MODES.FIRST_EIGHT;
  }
  return TAG_MODEL_SCAN_MODES.FULL;
}
