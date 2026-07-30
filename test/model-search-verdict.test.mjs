import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_VERDICTS,
  MODEL_EXPECTED_STATES,
  judgeAddedModelTitle,
  judgeModelSearchEvidence,
  normalizeModelName,
} from '../src/model-search-verdict.mjs';

function judge(overrides = {}) {
  return judgeModelSearchEvidence({
    modelName: 'Graphite Rose',
    expectedState: MODEL_EXPECTED_STATES.PRESENT,
    evidence: {
      resultState: 'RESULTS',
      firstResultVisible: true,
      firstResultTitle: 'Graphite Rose',
      firstResultImageState: 'LOADED',
    },
    ...overrides,
  });
}

test('added model passes by matching search-result text only', () => {
  const result = judgeAddedModelTitle({
    modelName: 'Film Handset',
    firstResultTitle: 'Film Handset',
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.PASS);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_MATCH');
});

test('added model fails when the visible search-result text differs', () => {
  const result = judgeAddedModelTitle({
    modelName: 'Film Handset',
    firstResultTitle: 'Film Handles',
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_MISMATCH');
});

test('passes an explicitly truncated title with matching prefix over 80 percent', () => {
  const result = judgeAddedModelTitle({
    modelName: 'Kitchen Showdown III',
    firstResultTitle: 'Kitchen Showdown ...',
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.PASS);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_PREFIX_MATCH');
  assert.equal(result.titleTruncated, true);
  assert.equal(result.titleMatched, true);
  assert.equal(result.visibleTitleCoverage, 0.8333);
});

test('accepts the single-character ellipsis as an explicit truncation marker', () => {
  const result = judgeAddedModelTitle({
    modelName: 'Kitchen Showdown III',
    firstResultTitle: 'Kitchen Showdown …',
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.PASS);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_PREFIX_MATCH');
});

test('does not accept a shortened title without an ellipsis', () => {
  const result = judgeAddedModelTitle({
    modelName: 'Kitchen Showdown III',
    firstResultTitle: 'Kitchen Showdown',
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_MISMATCH');
});

test('requires strictly more than 80 percent visible characters', () => {
  const result = judgeAddedModelTitle({
    modelName: 'ABCDEFGHIJ',
    firstResultTitle: 'ABCDEFGH...',
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.visibleTitleCoverage, 0.8);
});

test('rejects an ellipsized title whose beginning differs', () => {
  const result = judgeAddedModelTitle({
    modelName: 'ABCDEFGHIJ',
    firstResultTitle: 'XBCDEFGHI...',
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_MISMATCH');
});

test('normalizes width, whitespace, and English letter case', () => {
  assert.equal(normalizeModelName('  Ｇraphite   ROSE '), 'graphite rose');
});

test('passes a present model only when title and image both match', () => {
  const result = judge();
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.PASS);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_AND_IMAGE_MATCH');
  assert.equal(result.titleMatched, true);
  assert.equal(result.imageLoaded, true);
});

test('fails when the first result has no corresponding model text', () => {
  const result = judge({
    evidence: {
      resultState: 'RESULTS',
      firstResultVisible: true,
      firstResultTitle: '',
      firstResultImageState: 'LOADED',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_MISSING');
});

test('fails when the visible title differs from the published model', () => {
  const result = judge({
    evidence: {
      resultState: 'RESULTS',
      firstResultVisible: true,
      firstResultTitle: 'Graphite Ros',
      firstResultImageState: 'LOADED',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_MISMATCH');
});

test('fails when the matching card image is not loaded', () => {
  const result = judge({
    evidence: {
      resultState: 'RESULTS',
      firstResultVisible: true,
      firstResultTitle: 'Graphite Rose',
      firstResultImageState: 'PLACEHOLDER',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'MODEL_IMAGE_NOT_LOADED');
});

test('matching visible card overrides a contradictory no-results state', () => {
  const result = judge({
    evidence: {
      resultState: 'NO_RESULTS',
      firstResultVisible: true,
      firstResultTitle: 'Graphite Rose',
      firstResultImageState: 'LOADED',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.PASS);
  assert.equal(result.verdictReasonCode, 'MODEL_TEXT_AND_IMAGE_MATCH');
});

test('fails a present-model task when search has no results', () => {
  const result = judge({
    evidence: {
      resultState: 'NO_RESULTS',
      firstResultVisible: false,
      firstResultTitle: '',
      firstResultImageState: 'MISSING',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'MODEL_NOT_FOUND');
});

test('passes a deletion only when the page explicitly has no results', () => {
  const result = judge({
    expectedState: MODEL_EXPECTED_STATES.ABSENT,
    evidence: {
      resultState: 'NO_RESULTS',
      firstResultVisible: false,
      firstResultTitle: '',
      firstResultImageState: 'MISSING',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.PASS);
  assert.equal(result.verdictReasonCode, 'DELETED_MODEL_NOT_FOUND');
});

test('fails a deletion when the deleted model is still visible', () => {
  const result = judge({
    expectedState: MODEL_EXPECTED_STATES.ABSENT,
    evidence: {
      resultState: 'NO_RESULTS',
      firstResultVisible: true,
      firstResultTitle: 'Graphite Rose',
      firstResultImageState: 'LOADED',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.FAIL);
  assert.equal(result.verdictReasonCode, 'DELETED_MODEL_STILL_VISIBLE');
});

test('separates app/network errors from configuration failures', () => {
  const result = judge({
    evidence: {
      resultState: 'NETWORK_ERROR',
      firstResultVisible: false,
      firstResultTitle: '',
      firstResultImageState: 'UNKNOWN',
      pageIssue: 'Network Error',
    },
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.ERROR);
  assert.equal(result.verdictReasonCode, 'SEARCH_PAGE_ERROR');
});

test('marks conflicting delete and update declarations as an error', () => {
  const result = judge({
    expectedState: MODEL_EXPECTED_STATES.CONFLICT,
  });
  assert.equal(result.businessVerdict, BUSINESS_VERDICTS.ERROR);
  assert.equal(result.verdictReasonCode, 'CONFLICTING_CHANGE_TYPES');
});
