import { createHash } from 'node:crypto';

export const KNOWN_DIFFERENCE_SCHEMA_VERSION = '1.0';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function signature(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function devProEntries(diff) {
  const entries = [];
  for (const category of ['groups', 'models', 'introPages']) {
    for (const change of diff.changes[category]) {
      const detail = { category, change: stableValue(change) };
      entries.push({ signature: signature(detail), ...detail });
    }
  }
  return entries.sort((left, right) => left.signature.localeCompare(right.signature));
}

function missingReferenceEntries(report) {
  return report.references.map((reference) => {
    const detail = {
      section: reference.section,
      groupId: reference.groupId,
      modelId: reference.modelId,
    };
    return {
      signature: signature(detail),
      ...detail,
      tagName: reference.tagName ?? null,
    };
  }).sort((left, right) => left.signature.localeCompare(right.signature));
}

function validateBaseline(value) {
  if (!isRecord(value) || value.baselineType !== 'AM_KNOWN_DIFFERENCES') {
    throw new TypeError('known differences must be an AM_KNOWN_DIFFERENCES baseline');
  }
  for (const field of ['devProDifferences', 'proMissingModelReferences']) {
    if (!Array.isArray(value[field])) {
      throw new TypeError('known differences ' + field + ' must be an array');
    }
  }
}

export function captureKnownDifferences(input) {
  if (!isRecord(input?.devProDiff) || !isRecord(input?.proMissingModelReferences)) {
    throw new TypeError('devProDiff and proMissingModelReferences are required');
  }
  const devProDifferences = devProEntries(input.devProDiff);
  const proMissingModelReferences = missingReferenceEntries(
    input.proMissingModelReferences,
  );
  return {
    schemaVersion: KNOWN_DIFFERENCE_SCHEMA_VERSION,
    baselineType: 'AM_KNOWN_DIFFERENCES',
    createdAt: new Date().toISOString(),
    summary: {
      devProDifferences: devProDifferences.length,
      proMissingModelReferences: proMissingModelReferences.length,
    },
    devProDifferences,
    proMissingModelReferences,
  };
}

function compareEntries(current, known) {
  const currentBySignature = new Map(current.map((entry) => [entry.signature, entry]));
  const knownBySignature = new Map(known.map((entry) => [entry.signature, entry]));
  return {
    current,
    known: current.filter((entry) => knownBySignature.has(entry.signature)),
    added: current.filter((entry) => !knownBySignature.has(entry.signature)),
    resolved: known.filter((entry) => !currentBySignature.has(entry.signature)),
  };
}

export function checkForNewDifferences(input) {
  validateBaseline(input?.baseline);
  const devPro = compareEntries(
    devProEntries(input.devProDiff),
    input.baseline.devProDifferences,
  );
  const missingReferences = compareEntries(
    missingReferenceEntries(input.proMissingModelReferences),
    input.baseline.proMissingModelReferences,
  );
  const passed = devPro.added.length === 0 && missingReferences.added.length === 0;
  return {
    checkType: 'NEW_DIFFERENCE_CHECK',
    passed,
    baselineCreatedAt: input.baseline.createdAt,
    summary: {
      currentDevProDifferences: devPro.current.length,
      knownDevProDifferences: devPro.known.length,
      newDevProDifferences: devPro.added.length,
      resolvedDevProDifferences: devPro.resolved.length,
      currentMissingModelReferences: missingReferences.current.length,
      knownMissingModelReferences: missingReferences.known.length,
      newMissingModelReferences: missingReferences.added.length,
      resolvedMissingModelReferences: missingReferences.resolved.length,
    },
    newDevProDifferences: devPro.added,
    resolvedDevProDifferences: devPro.resolved,
    newMissingModelReferences: missingReferences.added,
    resolvedMissingModelReferences: missingReferences.resolved,
  };
}
