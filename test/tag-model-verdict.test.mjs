import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateTagModelAssertions,
  normalizeVisibleModelName,
  uniqueVisibleModelNames,
} from '../src/tag-model-verdict.mjs';

test('normalizes visible model names without weakening exact-name matching', () => {
  assert.equal(normalizeVisibleModelName('  Vintage   Transit '), 'vintage transit');
  assert.notEqual(
    normalizeVisibleModelName('Vintage Transit Extra'),
    normalizeVisibleModelName('Vintage Transit'),
  );
  assert.deepEqual(
    uniqueVisibleModelNames([' Vintage Transit ', 'vintage   transit', 'Other']),
    ['Vintage Transit', 'Other'],
  );
});

test('passes when all added tag models are found', () => {
  const result = evaluateTagModelAssertions(
    [
      { id: '1418', name: 'Vintage Transit', expectedState: 'PRESENT' },
      { id: '1419', name: 'Station Wanderer', expectedState: 'PRESENT' },
    ],
    ['Station Wanderer', 'Existing Style', 'Vintage Transit'],
  );

  assert.equal(result.businessVerdict, 'PASS');
  assert.equal(result.verdictReasonCode, 'TAG_MODEL_NAMES_MATCH');
  assert.deepEqual(result.actualModelNames, [
    'Station Wanderer',
    'Existing Style',
    'Vintage Transit',
  ]);
  assert.deepEqual(result.found.map((item) => item.id), ['1418', '1419']);
  assert.deepEqual(result.unassertedActualModelNames, ['Existing Style']);
  assert.deepEqual(
    result.comparisons.map(({ id, actualName, result: comparisonResult }) => [
      id,
      actualName,
      comparisonResult,
    ]),
    [
      ['1418', 'Vintage Transit', 'FOUND'],
      ['1419', 'Station Wanderer', 'FOUND'],
    ],
  );
});

test('reports missing and unexpectedly present tag models without throwing', () => {
  const result = evaluateTagModelAssertions(
    [
      { id: '1418', name: 'Vintage Transit', expectedState: 'PRESENT' },
      { id: '1419', name: 'Station Wanderer', expectedState: 'ABSENT' },
    ],
    ['Station Wanderer'],
  );

  assert.equal(result.businessVerdict, 'FAIL');
  assert.equal(result.verdictReasonCode, 'TAG_MODEL_NAME_MISMATCH');
  assert.deepEqual(result.missing.map((item) => item.id), ['1418']);
  assert.deepEqual(
    result.unexpectedlyPresent.map((item) => item.id),
    ['1419'],
  );
  assert.deepEqual(
    result.comparisons.map(({ id, result: comparisonResult }) => [
      id,
      comparisonResult,
    ]),
    [
      ['1418', 'MISSING'],
      ['1419', 'UNEXPECTEDLY_PRESENT'],
    ],
  );
});

test('reports unresolved IDs as an execution error', () => {
  const result = evaluateTagModelAssertions(
    [{ id: '22037', name: null, expectedState: 'PRESENT' }],
    [],
  );

  assert.equal(result.businessVerdict, 'ERROR');
  assert.equal(result.verdictReasonCode, 'TAG_MODEL_NAME_UNRESOLVED');
});

test('does not misreport missing names when page-name collection is incomplete', () => {
  const result = evaluateTagModelAssertions(
    [{ id: '1413', name: 'Grainy Portrait', expectedState: 'PRESENT' }],
    [],
    {
      actualNameCollectionComplete: false,
      collectionFailureReason: '所有页面的模型卡片名称采集结果均为空',
    },
  );

  assert.equal(result.businessVerdict, 'ERROR');
  assert.equal(
    result.verdictReasonCode,
    'TAG_MODEL_NAME_COLLECTION_INCOMPLETE',
  );
  assert.deepEqual(result.missing, []);
  assert.equal(result.comparisons[0].result, 'NOT_EVALUATED');
});
