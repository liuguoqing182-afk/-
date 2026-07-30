import { normalizeVisibleModelName } from './tag-model-verdict.mjs';

export function isMoreStyleTagFlow(flow) {
  return flow === 'VIDEO_TAG' || flow === 'FILTER_TAG';
}

export function isTagModelTreeEvidenceFlow(flow) {
  return flow === 'HOME_TAG' || isMoreStyleTagFlow(flow);
}

function allPresentModelEvidenceComplete(
  task,
  knownModelNames = [],
  currentControlTreeModelNames = [],
) {
  const assertions = task?.modelAssertions ?? [];
  if (
    assertions.length === 0 ||
    assertions.some(
      (assertion) =>
        !assertion.name || assertion.expectedState !== 'PRESENT',
    )
  ) {
    return false;
  }
  const known = new Set(
    [...knownModelNames, ...currentControlTreeModelNames]
      .map(normalizeVisibleModelName)
      .filter(Boolean),
  );
  return assertions.every((assertion) =>
    known.has(normalizeVisibleModelName(assertion.name)),
  );
}

export function tagModelTreeEvidenceComplete(
  task,
  knownModelNames = [],
  currentControlTreeModelNames = [],
) {
  if (!isTagModelTreeEvidenceFlow(task?.flow)) return false;
  return allPresentModelEvidenceComplete(
    task,
    knownModelNames,
    currentControlTreeModelNames,
  );
}

export function moreStyleModelEvidenceComplete(
  task,
  knownModelNames = [],
  currentControlTreeModelNames = [],
) {
  if (!isMoreStyleTagFlow(task?.flow)) return false;
  return allPresentModelEvidenceComplete(
    task,
    knownModelNames,
    currentControlTreeModelNames,
  );
}
