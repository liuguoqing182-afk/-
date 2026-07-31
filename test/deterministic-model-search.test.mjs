import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_SEARCH_ATTEMPT_TIMEOUT_MS,
  MODEL_SEARCH_EXECUTION_ATTEMPT_MAX,
  MODEL_SEARCH_NO_RESULT_CONFIRMATION_READS,
  MODEL_SEARCH_OPERATION_TIMEOUT_MS,
  MODEL_SEARCH_RESULT_TIMEOUT_MS,
  centerOfNode,
  classifyModelSearchObservation,
  deterministicModelSearchTargets,
  encodeAdbInputText,
  encodeAdbUnicodeInput,
  findHomeSearchTrigger,
  findSearchInput,
  isExplicitModelSearchNoResult,
  parsePhysicalScreenSize,
  requiresAdbUnicodeInput,
  resolveModelSearchAtDeadline,
} from '../src/deterministic-model-search.mjs';

function verdict({
  businessVerdict = 'FAIL',
  reason = 'MODEL_TEXT_MISMATCH',
  resultState = 'RESULTS',
  title = 'Actual',
  imageState = 'LOADED',
  visible = true,
} = {}) {
  return {
    businessVerdict,
    verdictReasonCode: reason,
    evidence: {
      resultState,
      firstResultVisible: visible,
      firstResultTitle: title,
      firstResultImageState: imageState,
    },
  };
}

test('uses the final 100-second result window and three execution attempts', () => {
  assert.equal(MODEL_SEARCH_OPERATION_TIMEOUT_MS, 10_000);
  assert.equal(MODEL_SEARCH_RESULT_TIMEOUT_MS, 100_000);
  assert.equal(MODEL_SEARCH_ATTEMPT_TIMEOUT_MS, 110_000);
  assert.equal(MODEL_SEARCH_EXECUTION_ATTEMPT_MAX, 3);
});

test('selects the top-right Search trigger and the editable search field', () => {
  const hierarchy = `<hierarchy>
    <node text="Search" content-desc="Search" class="android.view.View" clickable="true" editable="false" focused="false" bounds="[1280,60][1420,200]" />
    <node text="Search tips" content-desc="" class="android.view.View" clickable="false" editable="false" focused="false" bounds="[40,900][400,980]" />
    <node text="" content-desc="Search" class="android.widget.EditText" clickable="true" editable="true" focused="true" bounds="[80,120][1250,260]" />
    <node text="" content-desc="" class="android.view.View" clickable="false" editable="false" focused="false" bounds="[0,0][1440,2960]" />
  </hierarchy>`;

  const trigger = findHomeSearchTrigger(hierarchy);
  const input = findSearchInput(hierarchy);
  assert.deepEqual(centerOfNode(trigger), { x: 1350, y: 130 });
  assert.deepEqual(centerOfNode(input), { x: 665, y: 190 });
});

test('a completely read name mismatch is a final business failure', () => {
  assert.deepEqual(classifyModelSearchObservation(verdict()), {
    state: 'BUSINESS_COMPLETE',
  });
});

test('a name mismatch without a readable image is still execution-incomplete', () => {
  const incomplete = verdict({ imageState: 'UNKNOWN' });
  assert.deepEqual(resolveModelSearchAtDeadline(incomplete), {
    state: 'EXECUTION_INCOMPLETE',
    reason: 'MODEL_TEXT_MISMATCH',
  });
});

test('a completely read non-matching result for a deletion is a business failure', () => {
  assert.deepEqual(
    classifyModelSearchObservation(
      verdict({
        reason: 'DELETION_NOT_PROVEN',
        title: 'Different card',
        imageState: 'LOADED',
      }),
    ),
    { state: 'BUSINESS_COMPLETE' },
  );
});

test('a matching card with a loading image waits until the deadline', () => {
  const loadingVerdict = verdict({
    reason: 'MODEL_IMAGE_NOT_LOADED',
    title: 'Expected',
    imageState: 'LOADING',
  });
  assert.deepEqual(classifyModelSearchObservation(loadingVerdict), {
    state: 'WAIT_FOR_RESULT',
  });
  assert.deepEqual(resolveModelSearchAtDeadline(loadingVerdict), {
    state: 'BUSINESS_COMPLETE',
    verdict: loadingVerdict,
  });
});

test('a visible card overrides a contradictory no-results state while its image loads', () => {
  const loadingVerdict = verdict({
    reason: 'MODEL_IMAGE_NOT_LOADED',
    resultState: 'NO_RESULTS',
    title: 'Expected',
    imageState: 'PLACEHOLDER',
  });
  assert.deepEqual(classifyModelSearchObservation(loadingVerdict), {
    state: 'WAIT_FOR_RESULT',
  });
  assert.equal(isExplicitModelSearchNoResult(loadingVerdict), false);
});

test('a fully read visible card can complete despite a contradictory no-results state', () => {
  const matchingVerdict = verdict({
    businessVerdict: 'PASS',
    reason: 'MODEL_TEXT_AND_IMAGE_MATCH',
    resultState: 'NO_RESULTS',
    title: 'Expected',
    imageState: 'LOADED',
  });
  assert.deepEqual(classifyModelSearchObservation(matchingVerdict), {
    state: 'BUSINESS_COMPLETE',
  });
});

test('an unreadable first card remains an execution incomplete result', () => {
  const unreadable = verdict({
    reason: 'MODEL_TEXT_MISSING',
    title: '',
    imageState: 'UNKNOWN',
  });
  assert.deepEqual(resolveModelSearchAtDeadline(unreadable), {
    state: 'EXECUTION_INCOMPLETE',
    reason: 'MODEL_TEXT_MISSING',
  });
});

test('an explicit no-result page is a complete business result', () => {
  assert.equal(MODEL_SEARCH_NO_RESULT_CONFIRMATION_READS, 2);
  assert.deepEqual(
    classifyModelSearchObservation(
      verdict({
        reason: 'MODEL_NOT_FOUND',
        resultState: 'NO_RESULTS',
        title: '',
        imageState: 'MISSING',
        visible: false,
      }),
    ),
    { state: 'BUSINESS_COMPLETE' },
  );
  assert.equal(
    isExplicitModelSearchNoResult(
      verdict({
        reason: 'MODEL_NOT_FOUND',
        resultState: 'NO_RESULTS',
        title: '',
        imageState: 'MISSING',
        visible: false,
      }),
    ),
    true,
  );
});

test('no-results with PLACEHOLDER image evidence keeps waiting', () => {
  const unsettled = verdict({
    reason: 'MODEL_NOT_FOUND',
    resultState: 'NO_RESULTS',
    title: '',
    imageState: 'PLACEHOLDER',
    visible: false,
  });
  assert.equal(isExplicitModelSearchNoResult(unsettled), false);
  assert.deepEqual(classifyModelSearchObservation(unsettled), {
    state: 'WAIT_FOR_RESULT',
    reason: 'MODEL_NOT_FOUND',
  });
  assert.deepEqual(resolveModelSearchAtDeadline(unsettled), {
    state: 'EXECUTION_INCOMPLETE',
    reason: 'MODEL_NOT_FOUND',
  });
});

test('no-results with UNKNOWN image evidence keeps waiting', () => {
  const unsettled = verdict({
    reason: 'MODEL_NOT_FOUND',
    resultState: 'NO_RESULTS',
    title: '',
    imageState: 'UNKNOWN',
    visible: false,
  });
  assert.equal(isExplicitModelSearchNoResult(unsettled), false);
  assert.deepEqual(classifyModelSearchObservation(unsettled), {
    state: 'WAIT_FOR_RESULT',
    reason: 'MODEL_NOT_FOUND',
  });
  assert.deepEqual(resolveModelSearchAtDeadline(unsettled), {
    state: 'EXECUTION_INCOMPLETE',
    reason: 'MODEL_NOT_FOUND',
  });
});

test('a contradictory no-result response with a title is not explicit absence', () => {
  const contradictory = verdict({
    reason: 'RESULT_CARD_MISSING',
    resultState: 'NO_RESULTS',
    title: 'Expected',
    imageState: 'UNKNOWN',
    visible: false,
  });
  assert.equal(isExplicitModelSearchNoResult(contradictory), false);
  assert.deepEqual(classifyModelSearchObservation(contradictory), {
    state: 'WAIT_FOR_RESULT',
    reason: 'RESULT_CARD_MISSING',
  });
});


test('derives stable model-search coordinates from the physical screen', () => {
  const size = parsePhysicalScreenSize('Physical size: 1440x2960');
  assert.deepEqual(size, { width: 1440, height: 2960 });
  assert.deepEqual(deterministicModelSearchTargets(size), {
    homeSearch: { x: 1228, y: 210 },
    searchInput: { x: 645, y: 252 },
    submitSearch: { x: 1300, y: 246 },
  });
});

test('prefers an Android override size and safely encodes model names', () => {
  assert.deepEqual(
    parsePhysicalScreenSize(
      'Physical size: 1440x2960\nOverride size: 1080x2220',
    ),
    { width: 1080, height: 2220 },
  );
  assert.equal(encodeAdbInputText('Kitchen Showdown III'), 'Kitchen%sShowdown%sIII');
  assert.equal(requiresAdbUnicodeInput('Kitchen Showdown III'), false);
  assert.equal(requiresAdbUnicodeInput('掌心变装'), true);
  assert.equal(encodeAdbUnicodeInput('掌心变装'), '5o6M5b+D5Y+Y6KOF');
  assert.throws(() => encodeAdbInputText('掌心变装'), /requires Unicode/);
  assert.throws(() => encodeAdbInputText('Bad & Unsafe'), /requires Unicode/);
  assert.throws(() => requiresAdbUnicodeInput('Bad\nText'), /control/);
});
