import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureKnownDifferences,
  checkForNewDifferences,
} from '../src/known-difference-baseline.mjs';

function diff(models = []) {
  return {
    changes: { groups: [], models, introPages: [] },
  };
}

function missing(references = []) {
  return { references };
}

const rename = {
  type: 'MODEL_RENAME',
  modelId: '274',
  beforeName: 'Wedding Venue',
  afterName: 'Wedding',
};
const reference = {
  section: 'TABS',
  groupId: 'group-1',
  tagName: 'New',
  modelId: '999',
};

test('accepts current known differences and missing references', () => {
  const baseline = captureKnownDifferences({
    devProDiff: diff([rename]),
    proMissingModelReferences: missing([reference]),
  });

  const result = checkForNewDifferences({
    baseline,
    devProDiff: diff([structuredClone(rename)]),
    proMissingModelReferences: missing([{ ...reference, tagName: 'Renamed tag' }]),
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.summary, {
    currentDevProDifferences: 1,
    knownDevProDifferences: 1,
    newDevProDifferences: 0,
    resolvedDevProDifferences: 0,
    currentMissingModelReferences: 1,
    knownMissingModelReferences: 1,
    newMissingModelReferences: 0,
    resolvedMissingModelReferences: 0,
  });
});

test('fails only newly added differences and reports resolved known items', () => {
  const baseline = captureKnownDifferences({
    devProDiff: diff([rename]),
    proMissingModelReferences: missing([reference]),
  });
  const newReference = { ...reference, modelId: '1000' };

  const result = checkForNewDifferences({
    baseline,
    devProDiff: diff([{
      type: 'MODEL_CATALOG_DELETE',
      model: { id: '980', name: 'Tiny Cleaner' },
    }]),
    proMissingModelReferences: missing([newReference]),
  });

  assert.equal(result.passed, false);
  assert.equal(result.summary.newDevProDifferences, 1);
  assert.equal(result.summary.resolvedDevProDifferences, 1);
  assert.equal(result.summary.newMissingModelReferences, 1);
  assert.equal(result.summary.resolvedMissingModelReferences, 1);
});
