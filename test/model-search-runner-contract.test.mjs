import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const runner = await fs.readFile(
  new URL('../scripts/run-app-screenshot-plan.mjs', import.meta.url),
  'utf8',
);

function functionSource(startMarker, endMarker) {
  const start = runner.indexOf(startMarker);
  const end = runner.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return runner.slice(start, end);
}

test('added-model search is deterministic and has no AI action fallback', () => {
  const source = functionSource(
    'async function performModelSearch',
    'async function findTagWithoutOpening',
  );
  assert.match(source, /deterministicModelSearchTargets/);
  assert.match(source, /clearModelSearchInput/);
  assert.match(source, /inputModelSearchText/);
  assert.match(source, /targets\.submitSearch/);
  assert.doesNotMatch(source, /aiAction|performAiModelSearchFallback/);
  assert.match(source, /MODEL_SEARCH_ATTEMPT_TIMEOUT_MS/);
  assert.match(source, /MODEL_SEARCH_RESULT_TIMEOUT_MS/);
});

test('non-ASCII model names use Base64 Unicode IME input and always restore the original IME', () => {
  const source = functionSource(
    'function inputModelSearchText',
    'async function normalizeModelSearchPage',
  );
  assert.match(source, /requiresAdbUnicodeInput/);
  assert.match(source, /encodeAdbInputText/);
  assert.match(source, /ADB_UNICODE_INPUT_METHOD/);
  assert.match(source, /ADB_CLEAR_TEXT/);
  assert.match(source, /ADB_INPUT_B64/);
  assert.match(source, /encodeAdbUnicodeInput/);
  assert.match(source, /finally/);
  assert.match(source, /restoreInputMethod/);
  assert.ok(source.indexOf('ADB_CLEAR_TEXT') < source.indexOf('ADB_INPUT_B64'));
});

test('AI query is abortable and exclusive so retries cannot overlap', () => {
  const source = functionSource(
    'const aiActionGate',
    'async function waitForLoadedImages',
  );
  assert.match(source, /createExclusiveOperationGate/);
  assert.match(source, /runAbortableOperation/);
  assert.match(source, /agent\.aiQuery\(demand, \{ abortSignal \}\)/);
  assert.match(source, /AI_QUERY_ABORT_SETTLED/);
  assert.doesNotMatch(source, /withTimeout\(agent\.aiQuery/);
  const locateSource = functionSource(
    'async function tagAiLocate',
    'async function waitForLoadedImages',
  );
  assert.match(locateSource, /aiReadGate\.run/);
  assert.match(locateSource, /runAbortableOperation/);
  assert.match(locateSource, /agent\.aiLocate\(prompt, \{ abortSignal \}\)/);
  assert.match(locateSource, /TAG_AI_LOCATE_ABORT_SETTLED/);
});

test('added-model AI reads only the first result title', () => {
  const source = functionSource(
    'async function queryAddedModelTitle',
    'async function queryModelSearchEvidence',
  );
  assert.match(source, /firstResultTitle/);
  assert.doesNotMatch(source, /firstResultImageState|resultState|pageIssue/);
  assert.match(source, /judgeAddedModelTitle/);
  assert.match(source, /not completely readable/);
});

test('completed model-search verdict is screenshotted and is not retried', () => {
  const source = functionSource(
    'async function runModelSearch',
    'async function findTagWithoutOpening',
  );
  assert.match(source, /waitForAddedModelTitleVerdict/);
  assert.match(source, /captureCheckpoint\(1\)/);
  assert.doesNotMatch(runner, /BUSINESS_VERDICT_RETRY|retryBusinessVerdict/);
});

test('model search never force-stops or restarts the App process', () => {
  const source = functionSource(
    'async function executeTask',
    'const args = parseArgs',
  );
  const tagBranchStart = source.search(
    /\r?\n\r?\n  if \(isTagFlow\(task\.flow\)\)/,
  );
  assert.notEqual(tagBranchStart, -1);
  const modelBranch = source.slice(
    source.indexOf("if (task.flow === 'MODEL_SEARCH')"),
    tagBranchStart,
  );
  assert.match(modelBranch, /return runModelSearch\(task, context\)/);
  assert.doesNotMatch(
    modelBranch,
    /recoverHome|wakeAndBringToFront|restartAppForTagAttempt/,
  );
});

test('every tag attempt restarts the App before Home recovery', () => {
  const restartHelper = functionSource(
    'async function restartAppForTagAttempt',
    'async function assertTagModuleVisible',
  );
  const executeSource = functionSource(
    'async function executeTask',
    'const args = parseArgs',
  );
  assert.match(restartHelper, /'am', 'force-stop', packageName/);
  assert.match(executeSource, /if \(isTagFlow\(task\.flow\)\)/);
  const restartIndex = executeSource.indexOf(
    'await restartAppForTagAttempt(',
  );
  const recoverIndex = executeSource.indexOf('await recoverHome(');
  assert.ok(restartIndex >= 0);
  assert.ok(recoverIndex > restartIndex);
});

test('tag entry starts at restarted page-top and scans only with finger-up gestures', () => {
  const source = functionSource(
    'async function findTagWithoutOpening',
    'function isTagFlow',
  );
  assert.match(source, /direction=initial-top/);
  assert.match(source, /await tagVerticalSwipe\([\s\S]*?HOME_TAG_ENTRY_SWIPE_SETTLE_MS/);
  assert.match(source, /direction=finger-up/);
  assert.match(source, /page-bottom/);
  assert.doesNotMatch(
    source,
    /tagReverseVerticalSwipe|finger-down|scanScrollablePage/,
  );
});

test('Home tag entry keeps the original swipe and changes only its settle to 1.5 seconds', () => {
  const swipeSource = functionSource(
    'async function tagVerticalSwipe',
    'async function tagReverseVerticalSwipe',
  );
  const entrySource = functionSource(
    'async function findTagWithoutOpening',
    'function isTagFlow',
  );
  assert.match(
    swipeSource,
    /'720', '2300', '720', '720', '700'/,
  );
  assert.match(swipeSource, /settleMs = 2_000/);
  assert.match(swipeSource, /sleep\(settleMs\)/);
  assert.match(entrySource, /flow === 'HOME_TAG'/);
  assert.match(entrySource, /HOME_TAG_ENTRY_SWIPE_SETTLE_MS/);
  assert.match(runner, /HOME_TAG_ENTRY_SWIPE_SETTLE_MS = 1_500/);
});

test('decorated Home tags use read-only visual text fallback and programmatic tap', () => {
  const visualSource = functionSource(
    'function visualHomeTagReadEnabled',
    'async function findTagWithoutOpening',
  );
  const openSource = functionSource(
    'async function openTag',
    'async function enterTagModule',
  );
  assert.match(visualSource, /task\?\.flow === 'HOME_TAG'/);
  assert.match(visualSource, /homeTagTitleHasDecorativeSymbols/);
  assert.match(visualSource, /await aiQuery/);
  assert.match(visualSource, /await tagAiLocate/);
  assert.match(visualSource, /exactVisualHomeTagTitle/);
  assert.doesNotMatch(visualSource, /agent\.aiTap|agent\.aiAction|adbTap/);
  assert.match(openSource, /else if \(visualTapTarget\)/);
  assert.match(openSource, /adbTap\(deviceId, visualTapTarget\)/);
  assert.match(openSource, /HOME_TAG_VISUAL_OPEN_GUARD/);
});

test('tag model fast scan is content-driven and falls back inside one task', () => {
  const source = functionSource(
    'async function scanTagModelNamesFirstEight',
    'function extractHierarchyXml',
  );
  assert.match(source, /TAG_MODEL_QUICK_VISIBLE_LIMIT/);
  assert.match(source, /TAG_MODEL_QUICK_FORWARD_SWIPES/);
  assert.match(source, /TAG_MODEL_QUICK_BACKWARD_SWIPES/);
  assert.match(source, /tagModelScanModeForTask\(task\)/);
  assert.match(source, /scanTagModelNamesFull\(task, context/);
  assert.match(source, /FULL_FALLBACK/);
  assert.doesNotMatch(source, /attempt|recoverHome/);
});

test('tag tasks restore Home deterministically before one bounded AI fallback', () => {
  const source = functionSource(
    'async function recoverHome',
    'async function capture',
  );
  const deterministicIndex = source.indexOf(
    'await stabilizeHomeFeed(deviceId, deadline)',
  );
  const aiFallbackIndex = source.indexOf('await aiAction(');
  assert.ok(deterministicIndex >= 0);
  assert.ok(aiFallbackIndex > deterministicIndex);
  assert.match(source, /TAG_HOME_RECOVERY_TIMEOUT_MS/);
  assert.match(source, /deterministic-first succeeded; AI fallback skipped/);
  assert.match(source, /deterministic-first failed; using AI fallback/);
  assert.equal((source.match(/await aiAction\(/g) ?? []).length, 1);
});

test('account drawer recovery tries BACK before a tree-derived safe blank', () => {
  const source = functionSource(
    'async function dismissAccountDrawer',
    'async function stabilizeHomeFeed',
  );
  const backIndex = source.indexOf("'keyevent', 'BACK'");
  const safeTargetIndex = source.indexOf('safeAccountDrawerDismissTarget');
  assert.ok(backIndex >= 0);
  assert.ok(safeTargetIndex > backIndex);
  assert.doesNotMatch(source, /'200',\s*'1200'/);
});

test('stable Home is decided from tree state and selected Home is not blindly tapped', () => {
  const source = functionSource(
    'async function stabilizeHomeFeed',
    'async function confirmHomeReadOnly',
  );
  assert.match(source, /tagHomeActionForHierarchy/);
  assert.match(source, /TAG_HOME_ACTIONS\.DONE/);
  assert.match(source, /TAG_HOME_ACTIONS\.TAP_HOME/);
  assert.match(source, /decision\.tapTarget/);
  assert.doesNotMatch(source, /'720',\s*'2825'/);
});

test('AI Home fallback is followed only by read-only confirmation', () => {
  const source = functionSource(
    'async function confirmHomeReadOnly',
    'async function recoverHome',
  );
  assert.match(source, /readTagHomeHierarchy/);
  assert.doesNotMatch(source, /stabilizeHomeFeed|safeAccountDrawerDismissTarget/);
  assert.doesNotMatch(source, /'input'/);
});

test('Home tag entry recognizes the documented bottom marker', () => {
  const source = functionSource(
    'async function findTagWithoutOpening',
    'async function assertTagModuleVisible',
  );
  assert.match(source, /flow === 'HOME_TAG'/);
  assert.match(source, /More Content is Coming!/);
  assert.match(source, /explicitHomeBottom/);
  assert.match(source, /matchingTextBottom/);
});


test('quick miss performs a complete full scan in the same tag', () => {
  const source = functionSource(
    'async function scanTagModelNames',
    'function extractHierarchyXml',
  );
  assert.match(
    source,
    /scanMode: TAG_MODEL_SCAN_MODES\.FULL_FALLBACK,[\s\S]*allowEarlyPresentStop: false/,
  );
  assert.doesNotMatch(source, /recoverHome/);
});

test('tag module and opened tag are guarded before model scanning', () => {
  const moduleGuard = functionSource(
    'async function assertTagModuleVisible',
    'async function openTag',
  );
  const openGuard = functionSource(
    'async function openTag',
    'async function enterTagModule',
  );
  assert.match(moduleGuard, /inspectTagHomeHierarchy/);
  assert.match(moduleGuard, /inspectMoreStyleModuleHierarchy/);
  assert.match(moduleGuard, /moduleState\.stable/);
  assert.doesNotMatch(
    moduleGuard,
    /contentMarkers|seedance|painting|studio/,
  );
  assert.match(openGuard, /exactSectionTitleVisible/);
  assert.match(openGuard, /pageChanged/);
});

test('tag entry and AI clicks compare text without decorative emoji', () => {
  const matchingSource = functionSource(
    'function exactSectionTitleVisible',
    'function matchedExpectedModelNames',
  );
  const openSource = functionSource(
    'async function openTag',
    'async function enterTagModule',
  );
  assert.match(runner, /tag-title-text\.mjs/);
  assert.match(matchingSource, /exactTagTitleTextVisible/);
  assert.match(openSource, /tagTitleTextOnly/);
  assert.match(openSource, /visibleTitleText/);
});


test('tag AI actions are bounded, abortable, and use a strict image deadline', () => {
  const tapHelper = functionSource(
    'async function tagAiTap',
    'async function aiQuery',
  );
  const waitHelper = functionSource(
    'async function waitForTagLoadedImages',
    'function wakeAndBringToFront',
  );
  const tagActions = functionSource(
    'async function openTag',
    'async function runRegularTag',
  );
  assert.match(tapHelper, /runAbortableOperation/);
  assert.match(tapHelper, /TAG_HOME_RECOVERY_TIMEOUT_MS/);
  assert.match(waitHelper, /deadline - Date\.now\(\)/);
  assert.match(waitHelper, /Math\.min\(45_000/);
  assert.match(tagActions, /tagAiTap/);
  assert.match(tagActions, /waitForTagLoadedImages/);
});

test('More Style navigation is deterministic-first with the original AI fallback', () => {
  const source = functionSource(
    'async function enterTagModule',
    'async function runRegularTag',
  );
  assert.match(source, /tryDeterministicMoreStyleTab/);
  assert.match(source, /tagAiTap/);
  assert.match(source, /waitForHierarchyCondition/);
  assert.match(source, /2_500/);
  assert.match(source, /3_000/);
});

test('More Style tree reads and title taps stay bounded with AI fallback', () => {
  const deterministicSource = functionSource(
    'async function tryDeterministicMoreStyleTab',
    'function tagOpenGuardSatisfied',
  );
  assert.match(
    deterministicSource,
    /deadline: Date\.now\(\) \+ timeoutMs/,
  );
  assert.match(deterministicSource, /waitForHierarchyCondition/);

  const openSource = functionSource(
    'async function openTag',
    'async function enterTagModule',
  );
  assert.match(openSource, /isMoreStyleTagFlow/);
  assert.match(openSource, /uniqueExactPageTextTapTarget/);
  assert.match(openSource, /adbTap/);
  assert.match(openSource, /waitForHierarchyCondition/);
  assert.match(openSource, /tagAiTap/);
  assert.match(
    openSource,
    /else \{[\s\S]*?tagAiTap[\s\S]*?sleep\(4_000\)/,
  );
});

test('tag model reads skip AI only after exact present evidence is complete', () => {
  const observationSource = functionSource(
    'async function observeTagModelScreen',
    'async function scanTagModelNamesFull',
  );
  assert.match(runner, /more-style-safe-speed-policy\.mjs/);
  assert.match(observationSource, /tagModelTreeEvidenceComplete/);
  assert.match(observationSource, /HOME_CONTROL_TREE_EVIDENCE_COMPLETE/);
  assert.match(observationSource, /MORE_STYLE_CONTROL_TREE_EVIDENCE_COMPLETE/);
  assert.match(observationSource, /else if \(cachedVision\)/);
  assert.match(observationSource, /await aiQuery/);
});


test('quick return confirms page-top from two identical text reads', () => {
  const source = functionSource(
    'async function scanTagModelNamesFirstEight',
    'async function scanTagModelNames',
  );
  assert.match(source, /matchingReturnReadCount/);
  assert.match(source, /quickReturnBoundaryConfirmed/);
  assert.match(source, /TAG_BOUNDARY_MATCHING_SWIPE_READS/);
  assert.match(source, /tagScanSwipeLimit\(\)/);
});
