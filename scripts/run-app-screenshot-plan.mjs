import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  createExclusiveOperationGate,
  runAbortableOperation,
} from '../src/abortable-operation.mjs';
import {
  BUSINESS_VERDICTS,
  judgeAddedModelTitle,
  judgeModelSearchEvidence,
  normalizeModelSearchEvidence,
  verdictLabel,
} from '../src/model-search-verdict.mjs';
import {
  MODEL_SEARCH_ATTEMPT_TIMEOUT_MS,
  MODEL_SEARCH_BACK_PRESS_COUNT,
  MODEL_SEARCH_EXECUTION_ATTEMPT_MAX,
  MODEL_SEARCH_NO_RESULT_CONFIRMATION_READS,
  MODEL_SEARCH_OPERATION_TIMEOUT_MS,
  MODEL_SEARCH_POLL_INTERVAL_MS,
  MODEL_SEARCH_RESULT_TIMEOUT_MS,
  classifyModelSearchObservation,
  deterministicModelSearchTargets,
  encodeAdbInputText,
  encodeAdbUnicodeInput,
  isExplicitModelSearchNoResult,
  parsePhysicalScreenSize,
  requiresAdbUnicodeInput,
  resolveModelSearchAtDeadline,
  shouldRestartModelSearchAppBeforeAttempt,
  shouldRetryModelSearchBusinessFailure,
} from '../src/deterministic-model-search.mjs';
import {
  evaluateTagModelAssertions,
  normalizeVisibleModelName,
  uniqueVisibleModelNames,
} from '../src/tag-model-verdict.mjs';
import {
  MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS,
  TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES,
  createTagNameCollectionRetryState,
  currentScreenVisionAttemptMaxForTag,
  hasAbsentTagModelAssertion,
  markTagNameCollectionRetryUsed,
  shouldRetryMissingAddedTagModels,
  shouldRetryTagNameCollectionIncomplete,
} from '../src/tag-name-collection-retry-policy.mjs';
import {
  APP_SCREENSHOT_REPORT_TARGETS,
  normalizeAppScreenshotReportTarget,
} from '../src/app-screenshot-report-target.mjs';
import {
  TAG_BOUNDARY_MATCHING_SWIPE_READS,
  TAG_MODEL_QUICK_BACKWARD_SWIPES,
  TAG_MODEL_QUICK_FORWARD_SWIPES,
  TAG_MODEL_QUICK_VISIBLE_LIMIT,
  TAG_MODEL_SCAN_MODES,
  tagModelScanModeForTask,
} from '../src/tag-model-scan-policy.mjs';
import {
  compactVisionResponse,
  parseVisibleModelNames,
} from '../src/tag-model-name-parser.mjs';
import {
  SCAN_TERMINATIONS,
  pageTextContentSignature,
  pageTextSignature,
  scanScrollablePage,
  uniqueExactPageTextTapTarget,
  visiblePageText,
} from '../src/scrollable-page-scanner.mjs';
import {
  exactTagTitleTextVisible,
  tagTitleTextOnly,
} from '../src/tag-title-text.mjs';
import {
  HOME_TAG_VISUAL_TITLES_KEY,
  exactVisualHomeTagTitle,
  homeTagTitleHasDecorativeSymbols,
  safeVisualHomeTagTapTarget,
} from '../src/home-tag-visual-reader.mjs';
import {
  inspectMoreStyleModuleHierarchy,
} from '../src/more-style-module-state.mjs';
import {
  isMoreStyleTagFlow,
  tagModelTreeEvidenceComplete,
} from '../src/more-style-safe-speed-policy.mjs';
import {
  TAG_HOME_ACTIONS,
  TAG_HOME_RECOVERY_TIMEOUT_MS,
  inspectTagHomeHierarchy,
  safeAccountDrawerDismissTarget,
  tagHomeActionForHierarchy,
} from '../src/tag-home-state.mjs';

const DEFAULT_DEVICE_ID = 'R38M805JQHM';
const DEFAULT_PACKAGE = 'com.ai.polyverse.mirror';
const DEFAULT_RUNNER_ROOT =
  'D:\\Users\\lgq\\自动化\\eagleclaw\\mcp-servers\\eagleclaw-Aimirror';
const HOME_TAG_ENTRY_SWIPE_SETTLE_MS = 1_500;
const TAG_VISUAL_READ_TIMEOUT_MS = 45_000;
const ADB_UNICODE_INPUT_METHOD = 'com.android.adbkeyboard/.AdbIME';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const separator = token.indexOf('=');
    if (separator >= 0) {
      values[token.slice(2, separator)] = token.slice(separator + 1);
      continue;
    }
    values[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function loadEnvText(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function loadEnvFiles(root) {
  for (const name of ['.env', '.env.local']) {
    try {
      loadEnvText(await fs.readFile(path.join(root, name), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function applyModelEnvironment() {
  process.env.MIDSCENE_MODEL_BASE_URL =
    process.env.MIDSCENE_MODEL_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    'https://api.siliconflow.cn/v1';
  process.env.MIDSCENE_MODEL_API_KEY =
    process.env.MIDSCENE_MODEL_API_KEY || process.env.OPENAI_API_KEY || '';
  process.env.MIDSCENE_MODEL_NAME =
    process.env.MIDSCENE_MODEL_NAME || 'Qwen/Qwen3-VL-8B-Instruct';
  process.env.MIDSCENE_MODEL_FAMILY =
    process.env.MIDSCENE_MODEL_FAMILY || 'qwen3-vl';
  process.env.MIDSCENE_USE_QWEN3_VL = '1';
  process.env.MIDSCENE_MODEL_REASONING_ENABLED =
    process.env.MIDSCENE_MODEL_REASONING_ENABLED || 'default';
  process.env.OPENAI_BASE_URL = process.env.MIDSCENE_MODEL_BASE_URL;

  // This runner never creates a Feishu notifier. Keep the variables disabled as
  // an additional guard in case a dependency starts reading them later.
  process.env.FEISHU_NOTIFY_ENABLED = '0';
  process.env.FEISHU_CHAT_ID = '';
}

function adb(deviceId, args, options = {}) {
  return execFileSync(
    process.env.ADB || 'adb',
    ['-s', deviceId, ...args.map(String)],
    {
      timeout: options.timeout ?? 20_000,
      encoding: options.binary ? null : 'utf8',
      maxBuffer: 30 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeName(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function timestamp() {
  return new Date().toISOString();
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(temporaryPath, filePath);
}

function log(message) {
  console.log(`${timestamp()} ${message}`);
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

const aiActionGate = createExclusiveOperationGate();
const aiReadGate = createExclusiveOperationGate();

async function aiAction(agent, prompt, timeoutMs = 180_000) {
  log(`AI_ACTION ${prompt.replace(/\s+/g, ' ').slice(0, 140)}`);
  return aiActionGate.run(() =>
    runAbortableOperation({
      label: 'aiAction',
      timeoutMs,
      onAbortRequested: () => log('AI_ACTION_ABORT_REQUESTED'),
      onAbortSettled: () => log('AI_ACTION_ABORT_SETTLED'),
      operation: (abortSignal) =>
        agent.aiAction(prompt, { abortSignal }),
    }),
  );
}

async function aiTap(agent, prompt, timeoutMs = 90_000) {
  log(`AI_TAP ${prompt.replace(/\s+/g, ' ').slice(0, 140)}`);
  return withTimeout(agent.aiTap(prompt), timeoutMs, 'aiTap');
}

async function tagAiTap(agent, prompt, timeoutMs = 90_000) {
  log(`TAG_AI_TAP ${prompt.replace(/\s+/g, ' ').slice(0, 140)}`);
  return aiActionGate.run(() =>
    runAbortableOperation({
      label: 'tagAiTap',
      timeoutMs: Math.min(timeoutMs, TAG_HOME_RECOVERY_TIMEOUT_MS),
      onAbortRequested: () => log('TAG_AI_TAP_ABORT_REQUESTED'),
      onAbortSettled: () => log('TAG_AI_TAP_ABORT_SETTLED'),
      operation: (abortSignal) =>
        agent.aiTap(prompt, { abortSignal }),
    }),
  );
}

async function aiQuery(agent, demand, timeoutMs = 60_000) {
  log(`AI_QUERY ${Object.keys(demand).join(',')}`);
  return aiReadGate.run(() =>
    runAbortableOperation({
      label: 'aiQuery',
      timeoutMs,
      onAbortRequested: () => log('AI_QUERY_ABORT_REQUESTED'),
      onAbortSettled: () => log('AI_QUERY_ABORT_SETTLED'),
      operation: (abortSignal) =>
        agent.aiQuery(demand, { abortSignal }),
    }),
  );
}

async function tagAiLocate(
  agent,
  prompt,
  timeoutMs = TAG_VISUAL_READ_TIMEOUT_MS,
) {
  log(`TAG_AI_LOCATE ${prompt.replace(/\s+/g, ' ').slice(0, 140)}`);
  return aiReadGate.run(() =>
    runAbortableOperation({
      label: 'tagAiLocate',
      timeoutMs: Math.min(timeoutMs, TAG_HOME_RECOVERY_TIMEOUT_MS),
      onAbortRequested: () => log('TAG_AI_LOCATE_ABORT_REQUESTED'),
      onAbortSettled: () => log('TAG_AI_LOCATE_ABORT_SETTLED'),
      operation: (abortSignal) =>
        agent.aiLocate(prompt, { abortSignal }),
    }),
  );
}

async function waitForLoadedImages(agent, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await withTimeout(
        agent.aiAssert(
          'The current AIMirror content area is visible and its main card or result images are rendered. It is not only a blank skeleton, gray placeholder, or loading spinner. Judge only whether screenshot content is visibly loaded; do not judge whether the release configuration is correct.',
        ),
        45_000,
        'image readiness check',
      );
      return;
    } catch (error) {
      lastError = error;
      await sleep(10_000);
    }
  }
  throw new Error(
    `images not loaded within 120 seconds: ${
      lastError?.message || 'readiness check timed out'
    }`,
  );
}

async function waitForTagLoadedImages(
  agent,
  timeoutMs = TAG_HOME_RECOVERY_TIMEOUT_MS,
) {
  const boundedTimeoutMs = Math.min(
    timeoutMs,
    TAG_HOME_RECOVERY_TIMEOUT_MS,
  );
  const deadline = Date.now() + boundedTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const assertionTimeoutMs = Math.max(
      1,
      Math.min(45_000, deadline - Date.now()),
    );
    try {
      await withTimeout(
        agent.aiAssert(
          'The current AIMirror tag content is visible and its model-card images are rendered. It is not only a blank skeleton, gray placeholder, or loading spinner. Judge only image readiness.',
        ),
        assertionTimeoutMs,
        'tag image readiness check',
      );
      return;
    } catch (error) {
      lastError = error;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(10_000, remainingMs));
    }
  }
  throw new Error(
    `tag images not loaded within ${boundedTimeoutMs}ms: ${
      lastError?.message || 'readiness check timed out'
    }`,
  );
}

function wakeAndBringToFront(deviceId, packageName) {
  try {
    adb(deviceId, ['shell', 'input', 'keyevent', 'WAKEUP']);
  } catch {}
  try {
    adb(deviceId, ['shell', 'wm', 'dismiss-keyguard']);
  } catch {}
  adb(
    deviceId,
    [
      'shell',
      'monkey',
      '-p',
      packageName,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ],
    { timeout: 5_000 },
  );
}

function tagHomeRemainingMs(deadline) {
  return Math.max(0, deadline - Date.now());
}

function assertTagHomeTimeRemaining(deadline, stage) {
  const remainingMs = tagHomeRemainingMs(deadline);
  if (remainingMs <= 0) {
    throw new Error(
      `tag Home recovery timed out after ${TAG_HOME_RECOVERY_TIMEOUT_MS}ms during ${stage}`,
    );
  }
  return remainingMs;
}

async function waitWithinTagHomeDeadline(deadline, delayMs, stage) {
  const remainingMs = assertTagHomeTimeRemaining(deadline, stage);
  await sleep(Math.min(delayMs, remainingMs));
  assertTagHomeTimeRemaining(deadline, stage);
}

async function readTagHomeHierarchy(deviceId, deadline) {
  assertTagHomeTimeRemaining(deadline, 'UI hierarchy read');
  return readPageHierarchy(deviceId, { deadline });
}

function logTagHomeState(prefix, hierarchy) {
  const state = inspectTagHomeHierarchy(hierarchy);
  log(
    `${prefix} | homeVisible=${state.homeTab.visible} | homeSelected=${state.homeTab.selected} | homeContent=${state.homeContentVisible} | drawer=${state.accountDrawerVisible}`,
  );
  return state;
}

async function dismissAccountDrawer(deviceId, hierarchy, deadline) {
  log('HOME_RECOVERY account drawer detected; trying Android BACK first');
  adb(deviceId, ['shell', 'input', 'keyevent', 'BACK']);
  await waitWithinTagHomeDeadline(
    deadline,
    2_000,
    'account drawer BACK dismissal',
  );

  let afterDismiss = await readTagHomeHierarchy(deviceId, deadline);
  let state = logTagHomeState(
    'HOME_RECOVERY after account drawer BACK',
    afterDismiss,
  );
  if (!state.accountDrawerVisible) return afterDismiss;

  const safeTarget = safeAccountDrawerDismissTarget(afterDismiss);
  if (!safeTarget) {
    throw new Error(
      'account drawer remained open after BACK and no safe blank tap target was available',
    );
  }
  log(
    `HOME_RECOVERY account drawer BACK ineffective; tapping safe blank (${safeTarget.x},${safeTarget.y})`,
  );
  adb(deviceId, [
    'shell',
    'input',
    'tap',
    String(safeTarget.x),
    String(safeTarget.y),
  ]);
  await waitWithinTagHomeDeadline(
    deadline,
    2_000,
    'account drawer safe-blank dismissal',
  );
  afterDismiss = await readTagHomeHierarchy(deviceId, deadline);
  state = logTagHomeState(
    'HOME_RECOVERY after safe-blank drawer dismissal',
    afterDismiss,
  );
  if (state.accountDrawerVisible) {
    throw new Error(
      'account drawer remained open after BACK and safe-blank dismissal',
    );
  }
  return afterDismiss;
}

async function stabilizeHomeFeed(deviceId, deadline) {
  for (let step = 1; step <= 6; step += 1) {
    let hierarchy = await readTagHomeHierarchy(deviceId, deadline);
    let decision = tagHomeActionForHierarchy(hierarchy);
    logTagHomeState(
      `HOME_RECOVERY deterministic step=${step}/6 action=${decision.action}`,
      hierarchy,
    );

    if (decision.action === TAG_HOME_ACTIONS.DONE) {
      log(`HOME_RECOVERY stable Home feed confirmed on step ${step}`);
      return hierarchy;
    }

    if (decision.action === TAG_HOME_ACTIONS.DISMISS_ACCOUNT_DRAWER) {
      hierarchy = await dismissAccountDrawer(deviceId, hierarchy, deadline);
      decision = tagHomeActionForHierarchy(hierarchy);
      if (decision.action === TAG_HOME_ACTIONS.DONE) {
        log(
          `HOME_RECOVERY stable Home feed confirmed after drawer dismissal on step ${step}`,
        );
        return hierarchy;
      }
      continue;
    }

    if (
      decision.action === TAG_HOME_ACTIONS.TAP_HOME &&
      decision.tapTarget
    ) {
      adb(deviceId, [
        'shell',
        'input',
        'tap',
        String(decision.tapTarget.x),
        String(decision.tapTarget.y),
      ]);
      log(
        `HOME_RECOVERY tapped unselected Home tab at (${decision.tapTarget.x},${decision.tapTarget.y})`,
      );
      await waitWithinTagHomeDeadline(
        deadline,
        2_000,
        'unselected Home tab tap',
      );
      continue;
    }

    adb(deviceId, ['shell', 'input', 'keyevent', 'BACK']);
    log('HOME_RECOVERY pressed BACK to leave a non-Home page');
    await waitWithinTagHomeDeadline(
      deadline,
      2_000,
      'non-Home BACK recovery',
    );
  }
  throw new Error(
    'main Home feed was not restored after six deterministic state checks',
  );
}

async function confirmHomeReadOnly(deviceId, deadline) {
  let lastState = null;
  while (tagHomeRemainingMs(deadline) > 0) {
    const hierarchy = await readTagHomeHierarchy(deviceId, deadline);
    lastState = logTagHomeState(
      'HOME_RECOVERY read-only AI confirmation',
      hierarchy,
    );
    if (lastState.stable) return hierarchy;
    const remainingMs = tagHomeRemainingMs(deadline);
    if (remainingMs <= 1_000) break;
    await waitWithinTagHomeDeadline(
      deadline,
      Math.min(1_000, remainingMs),
      'read-only AI confirmation wait',
    );
  }
  throw new Error(
    `AI completed but Home read-only confirmation failed: homeSelected=${
      lastState?.homeTab?.selected ?? false
    }, homeContent=${lastState?.homeContentVisible ?? false}, drawer=${
      lastState?.accountDrawerVisible ?? false
    }`,
  );
}

async function recoverHome(agent, deviceId, packageName) {
  const deadline = Date.now() + TAG_HOME_RECOVERY_TIMEOUT_MS;
  wakeAndBringToFront(deviceId, packageName);
  await waitWithinTagHomeDeadline(deadline, 7_000, 'App foreground wait');

  try {
    await stabilizeHomeFeed(deviceId, deadline);
    log('HOME_RECOVERY deterministic-first succeeded; AI fallback skipped');
    return;
  } catch (error) {
    log(
      `HOME_RECOVERY deterministic-first failed; using AI fallback | ${
        error?.message || String(error)
      }`,
    );
  }

  const remainingMs = assertTagHomeTimeRemaining(deadline, 'AI fallback');
  const confirmationReserveMs = Math.min(
    10_000,
    Math.floor(remainingMs / 2),
  );
  const aiTimeoutMs = Math.max(1, remainingMs - confirmationReserveMs);
  await aiAction(
    agent,
    `Bring AIMirror to its main Home feed.
Dismiss any startup permission dialog, What's New carousel, task popup, or full-screen overlay using the visible close/back/Skip/Got it/Review Later control as appropriate.
If the right-side account panel showing Credit Details, User ID, Share App, or Feedback is open, press BACK first. Do not tap through the panel onto a Home content card.
If a non-home AIMirror page is open, use the visible back control until the bottom navigation is available, then tap Home only when Home is not already selected.
Stop only when Home is selected, Inspiration or Home content is visible, and no account panel covers the page.
Do not open a model card or start rendering.`,
    aiTimeoutMs,
  );
  await confirmHomeReadOnly(deviceId, deadline);
  log('HOME_RECOVERY AI fallback completed and Home was read-only confirmed');
}

async function capture(deviceId, filePath) {
  const data = adb(deviceId, ['exec-out', 'screencap', '-p'], {
    timeout: 20_000,
    binary: true,
  });
  await fs.writeFile(filePath, data);
}

async function verticalSwipe(deviceId) {
  adb(
    deviceId,
    ['shell', 'input', 'swipe', '720', '2300', '720', '720', '700'],
    { timeout: 10_000 },
  );
  await sleep(2_500);
}

async function reverseVerticalSwipe(deviceId) {
  adb(
    deviceId,
    ['shell', 'input', 'swipe', '720', '720', '720', '2300', '700'],
    { timeout: 10_000 },
  );
  await sleep(2_500);
}

async function tagVerticalSwipe(deviceId, settleMs = 2_000) {
  adb(
    deviceId,
    ['shell', 'input', 'swipe', '720', '2300', '720', '720', '700'],
    { timeout: 10_000 },
  );
  await sleep(settleMs);
}

async function tagReverseVerticalSwipe(deviceId) {
  adb(
    deviceId,
    ['shell', 'input', 'swipe', '720', '720', '720', '2300', '700'],
    { timeout: 10_000 },
  );
  await sleep(2_000);
}

function tagScanSwipeLimit() {
  const configured = Number(process.env.AM_TAG_SCAN_MAX_SWIPES_PER_DIRECTION);
  return Number.isInteger(configured) && configured > 0 ? configured : 30;
}

function exactSectionTitleVisible(hierarchy, objectName) {
  return exactTagTitleTextVisible(hierarchy, objectName);
}

function matchedExpectedModelNames(assertions, candidateNames) {
  const candidates = new Set(
    candidateNames.map(normalizeVisibleModelName).filter(Boolean),
  );
  return assertions
    .filter(
      (assertion) =>
        assertion.name &&
        candidates.has(normalizeVisibleModelName(assertion.name)),
    )
    .map((assertion) => assertion.name);
}

async function observeTagModelScreen(
  task,
  context,
  location,
  visionCache,
  knownModelNames = [],
) {
  const hierarchy = await readPageHierarchy(context.deviceId);
  const hierarchySignature = pageTextSignature(hierarchy);
  const uiTexts = visiblePageText(hierarchy);
  const xmlMatchedModelNames = matchedExpectedModelNames(
    task.modelAssertions,
    uiTexts,
  );
  let visionModelNames = [];
  let visionError = null;
  let visionRawResponse = null;
  let visionReused = false;
  let visionSkippedReason = null;
  const cachedVision = hierarchySignature
    ? visionCache.get(hierarchySignature)
    : null;
  if (
    tagModelTreeEvidenceComplete(
      task,
      knownModelNames,
      xmlMatchedModelNames,
    )
  ) {
    visionSkippedReason =
      task.flow === 'HOME_TAG'
        ? 'HOME_CONTROL_TREE_EVIDENCE_COMPLETE'
        : 'MORE_STYLE_CONTROL_TREE_EVIDENCE_COMPLETE';
    log(
      `TAG_MODEL_TREE_COMPLETE ${task.module} | ${task.objectName} | skip-ai`,
    );
  } else if (cachedVision) {
    visionModelNames = cachedVision.visionModelNames;
    visionError = cachedVision.visionError;
    visionRawResponse = cachedVision.visionRawResponse;
    visionReused = true;
  } else {
    const visionAttemptMax = currentScreenVisionAttemptMaxForTag({
      modelAssertions: task.modelAssertions,
    });
    for (
      let visionAttempt = 1;
      visionAttempt <= visionAttemptMax;
      visionAttempt += 1
    ) {
      try {
        const response = await aiQuery(context.agent, {
          visibleModelTitlesText:
            'Inspect only the model cards currently visible inside this AIMirror tag page. Return every exact printed model-card title, ordered top-to-bottom then left-to-right, as one plain string separated by ||. Include titles outside the release expectation. Exclude page titles, tab titles, buttons, and navigation text. Return an empty string if no model-card title is readable.',
        });
        visionRawResponse = compactVisionResponse(response);
        visionModelNames = parseVisibleModelNames(response);
        visionError = null;
        log(
          `TAG_MODEL_VISION_RAW ${task.module} | ${task.objectName} | ${visionRawResponse}`,
        );
        break;
      } catch (error) {
        visionError = error?.message || String(error);
        log(
          `TAG_MODEL_VISION_UNAVAILABLE ${task.module} | ${task.objectName} | attempt=${visionAttempt}/${visionAttemptMax} | ${visionError}`,
        );
        if (visionAttempt < visionAttemptMax) {
          log(
            `TAG_MODEL_VISION_RETRY ${task.module} | ${task.objectName} | current-screen retry=${visionAttempt + 1}/${visionAttemptMax}`,
          );
        }
      }
    }
    if (hierarchySignature) {
      visionCache.set(hierarchySignature, {
        visionModelNames,
        visionError,
        visionRawResponse,
      });
    }
  }
  const actualModelNames = uniqueVisibleModelNames([
    ...visionModelNames,
    ...xmlMatchedModelNames,
  ]);
  const signature = [
    pageTextContentSignature(hierarchy),
    ...actualModelNames.map(normalizeVisibleModelName),
  ]
    .filter(Boolean)
    .join('\n');
  const visibleModelNames = matchedExpectedModelNames(
    task.modelAssertions,
    actualModelNames,
  );
  return {
    location,
    hierarchy,
    signature,
    actualModelNames,
    visibleModelNames,
    visionModelNames,
    xmlMatchedModelNames,
    visionError,
    visionRawResponse,
    visionReused,
    visionSkippedReason,
  };
}

async function scanTagModelNamesFull(task, context, options = {}) {
  const scanMode = options.scanMode ?? TAG_MODEL_SCAN_MODES.FULL;
  const allowEarlyPresentStop = options.allowEarlyPresentStop ?? true;
  const actualNamesByNormalized = new Map();
  const foundNamesByNormalized = new Map();
  const observations = [];
  const visionCache = new Map();
  const scanWarnings = [];

  const collectNames = (target, values) => {
    const added = [];
    for (const name of values ?? []) {
      const normalized = normalizeVisibleModelName(name);
      if (!normalized || target.has(normalized)) continue;
      target.set(normalized, name);
      added.push(name);
    }
    return added;
  };

  const recordObservation = async (observation, location) => {
    const newActualModelNames = collectNames(
      actualNamesByNormalized,
      observation.actualModelNames,
    );
    const newMatchedExpectedModelNames = collectNames(
      foundNamesByNormalized,
      observation.visibleModelNames,
    );
    observations.push({
      location,
      actualModelNames: observation.actualModelNames,
      matchedExpectedModelNames: observation.visibleModelNames,
      newActualModelNames,
      newMatchedExpectedModelNames,
      visionModelNames: observation.visionModelNames,
      xmlMatchedModelNames: observation.xmlMatchedModelNames,
      visionError: observation.visionError,
      visionRawResponse: observation.visionRawResponse,
      visionReused: observation.visionReused,
      visionSkippedReason: observation.visionSkippedReason,
    });
    if (context.recordTagScanProgress) {
      await context.recordTagScanProgress({
        updatedAt: timestamp(),
        scanMode,
        observationCount: observations.length,
        actualModelNames: [...actualNamesByNormalized.values()],
        foundModelNames: [...foundNamesByNormalized.values()],
        lastObservation: observations.at(-1),
      });
    }
    return { newActualModelNames, newMatchedExpectedModelNames };
  };

  const allResolvablePresentModelsFound = () => {
    const assertions = task.modelAssertions ?? [];
    const presentAssertions = assertions.filter(
      (assertion) => assertion.name && assertion.expectedState === 'PRESENT',
    );
    const hasNamedAbsentAssertion = assertions.some(
      (assertion) => assertion.name && assertion.expectedState === 'ABSENT',
    );
    return (
      presentAssertions.length > 0 &&
      !hasNamedAbsentAssertion &&
      presentAssertions.every((assertion) =>
        foundNamesByNormalized.has(normalizeVisibleModelName(assertion.name)),
      )
    );
  };

  const traversal = await scanScrollablePage({
    observe: (location) =>
      observeTagModelScreen(
        task,
        context,
        { roundTrip: 1, ...location },
        visionCache,
        [...actualNamesByNormalized.values()],
      ),
    swipeForward: () => tagVerticalSwipe(context.deviceId),
    swipeBackward: () => tagReverseVerticalSwipe(context.deviceId),
    maxSwipesPerDirection: tagScanSwipeLimit(),
    boundaryUnchangedThreshold: 3,
    boundaryMatchingSwipeReadsThreshold:
      TAG_BOUNDARY_MATCHING_SWIPE_READS,
    onObservation: async (observation, location) => {
      const discovered = await recordObservation(observation, {
        roundTrip: 1,
        ...location,
      });
      if (location.direction !== 'initial') {
        log(
          `TAG_MODEL_SCAN ${task.module} | ${task.objectName} | round-trip=1 | direction=${location.direction} | swipe=${location.swipeIndex}/${tagScanSwipeLimit()} | matching-text=${location.matchingSwipeReadCount}/${TAG_BOUNDARY_MATCHING_SWIPE_READS} | actual=${JSON.stringify(discovered.newActualModelNames)} | matched=${JSON.stringify(discovered.newMatchedExpectedModelNames)}`,
        );
      }
    },
    stopWhen: () => allowEarlyPresentStop && allResolvablePresentModelsFound(),
    onBoundary: async (_observation, result) => {
      log(
        `TAG_MODEL_BOUNDARY ${task.module} | ${task.objectName} | boundary=${result.boundary}`,
      );
    },
  });

  const stoppedEarlyAllPresent =
    traversal.termination === SCAN_TERMINATIONS.STOPPED;
  if (stoppedEarlyAllPresent) {
    log(
      `TAG_MODEL_ALL_EXPECTED_FOUND ${task.module} | ${task.objectName} | direction=${traversal.stoppedAt.direction} | swipe=${traversal.stoppedAt.swipeIndex}`,
    );
  }
  if (traversal.termination === SCAN_TERMINATIONS.SCAN_LIMIT_REACHED) {
    const failedBoundary = traversal.boundaryResults.at(-1);
    const warning = `${failedBoundary.direction} 连续滑动${failedBoundary.swipes}次仍无法确认${failedBoundary.boundary}`;
    scanWarnings.push(warning);
    log(
      `TAG_MODEL_BOUNDARY_UNCONFIRMED ${task.module} | ${task.objectName} | ${warning}`,
    );
  }

  const actualModelNames = [...actualNamesByNormalized.values()];
  const visionWarnings = observations
    .filter((observation) => observation.visionError)
    .map(
      (observation) =>
        `${observation.location.direction}: ${observation.visionError}`,
    );
  const actualNameCollectionWarnings = uniqueVisibleModelNames([
    ...visionWarnings,
    ...scanWarnings,
  ]);
  const fullTagTraversalCompleted =
    traversal.termination === SCAN_TERMINATIONS.COMPLETED_ROUND_TRIP &&
    traversal.boundaryResults.length === 2 &&
    traversal.boundaryResults.every((item) => item.boundaryConfirmed);
  const allPresentModelsHaveDirectEvidence =
    fullTagTraversalCompleted && allResolvablePresentModelsFound();
  const assertionDecisionComplete =
    actualModelNames.length > 0 &&
    (stoppedEarlyAllPresent ||
      allPresentModelsHaveDirectEvidence ||
      (fullTagTraversalCompleted && visionWarnings.length === 0));
  const incompleteReasons = [];
  if (actualModelNames.length === 0) {
    incompleteReasons.push('所有页面的模型卡片名称采集结果均为空');
  }
  if (!stoppedEarlyAllPresent && !fullTagTraversalCompleted) {
    incompleteReasons.push('单次分步到底/回顶扫描未完整确认');
  }
  if (!stoppedEarlyAllPresent && visionWarnings.length > 0) {
    incompleteReasons.push(`视觉名称识别失败${visionWarnings.length}次`);
  }
  const verdict = evaluateTagModelAssertions(
    task.modelAssertions,
    actualModelNames,
    {
      actualNameCollectionComplete: assertionDecisionComplete,
      collectionFailureReason: `${incompleteReasons.join('；')}，无法可靠判断名称是否缺失`,
    },
  );
  return {
    ...verdict,
    evidence: {
      evidenceType: 'TAG_MODEL_NAME_SCAN',
      scanMode,
      scanRoundTripsCompleted: fullTagTraversalCompleted ? 1 : 0,
      scanGroupsCompleted: fullTagTraversalCompleted ? 1 : 0,
      boundaryRule: '每次分步滑动后读取文字；同方向连续2次滑动后的文字相同即确认边界',
      maxSwipesPerDirection: tagScanSwipeLimit(),
      stoppedEarlyAllPresent,
      fullTagTraversalCompleted,
      boundaryResults: traversal.boundaryResults,
      expectedModels: task.modelAssertions,
      actualModelNames,
      foundModelNames: verdict.found.map((item) => item.name),
      missingModels: verdict.missing,
      unexpectedlyPresentModels: verdict.unexpectedlyPresent,
      unresolvedModels: verdict.unresolved,
      unassertedActualModelNames: verdict.unassertedActualModelNames,
      comparisons: verdict.comparisons,
      actualNameCollectionComplete: assertionDecisionComplete,
      actualNameCollectionWarnings,
      observations,
    },
  };
}


async function scanTagModelNamesFirstEight(task, context) {
  const actualNamesByNormalized = new Map();
  const observations = [];
  const visionCache = new Map();
  let quickReturnSwipeCount = 0;
  let quickReturnBoundaryConfirmed = false;

  const collectFirstEight = (values) => {
    const added = [];
    for (const name of values ?? []) {
      if (actualNamesByNormalized.size >= TAG_MODEL_QUICK_VISIBLE_LIMIT) break;
      const normalized = normalizeVisibleModelName(name);
      if (!normalized || actualNamesByNormalized.has(normalized)) continue;
      actualNamesByNormalized.set(normalized, name);
      added.push(name);
    }
    return added;
  };

  for (
    let swipeIndex = 0;
    swipeIndex <= TAG_MODEL_QUICK_FORWARD_SWIPES;
    swipeIndex += 1
  ) {
    if (swipeIndex > 0) await tagVerticalSwipe(context.deviceId);
    const location = {
      scanMode: TAG_MODEL_SCAN_MODES.FIRST_EIGHT,
      direction: swipeIndex === 0 ? 'initial' : 'finger-bottom-to-top',
      swipeIndex,
    };
    const observation = await observeTagModelScreen(
      task,
      context,
      location,
      visionCache,
      [...actualNamesByNormalized.values()],
    );
    const newActualModelNames = collectFirstEight(
      observation.actualModelNames,
    );
    observations.push({
      location,
      actualModelNames: observation.actualModelNames,
      visionModelNames: observation.visionModelNames,
      xmlMatchedModelNames: observation.xmlMatchedModelNames,
      visionError: observation.visionError,
      visionRawResponse: observation.visionRawResponse,
      visionSkippedReason: observation.visionSkippedReason,
      newActualModelNames,
    });
    log(
      `TAG_MODEL_QUICK_SCAN ${task.module} | ${task.objectName} | direction=${location.direction} | swipe=${swipeIndex}/${TAG_MODEL_QUICK_FORWARD_SWIPES} | first-eight=${JSON.stringify([...actualNamesByNormalized.values()])}`,
    );
    if (context.recordTagScanProgress) {
      await context.recordTagScanProgress({
        updatedAt: timestamp(),
        scanMode: TAG_MODEL_SCAN_MODES.FIRST_EIGHT,
        observationCount: observations.length,
        actualModelNames: [...actualNamesByNormalized.values()],
        lastObservation: observations.at(-1),
      });
    }
  }

  let previousReturnSignature = '';
  let matchingReturnReadCount = 0;
  for (
    let swipeIndex = 1;
    swipeIndex <= tagScanSwipeLimit();
    swipeIndex += 1
  ) {
    await tagReverseVerticalSwipe(context.deviceId);
    const location = {
      scanMode: TAG_MODEL_SCAN_MODES.FIRST_EIGHT,
      direction: 'finger-top-to-bottom',
      swipeIndex,
    };
    const observation = await observeTagModelScreen(
      task,
      context,
      location,
      visionCache,
      [...actualNamesByNormalized.values()],
    );
    const signature = String(observation.signature ?? '');
    matchingReturnReadCount =
      signature &&
      previousReturnSignature &&
      signature === previousReturnSignature
        ? Math.max(2, matchingReturnReadCount + 1)
        : signature
          ? 1
          : 0;
    previousReturnSignature = signature;
    quickReturnSwipeCount = swipeIndex;
    observations.push({
      location,
      returnOnly: true,
      actualModelNames: observation.actualModelNames,
      visionModelNames: observation.visionModelNames,
      xmlMatchedModelNames: observation.xmlMatchedModelNames,
      visionError: observation.visionError,
      visionRawResponse: observation.visionRawResponse,
      visionSkippedReason: observation.visionSkippedReason,
      matchingReturnReadCount,
      newActualModelNames: [],
    });
    log(
      `TAG_MODEL_QUICK_RETURN ${task.module} | ${task.objectName} | swipe=${swipeIndex}/${tagScanSwipeLimit()} | matching-text=${matchingReturnReadCount}/${TAG_BOUNDARY_MATCHING_SWIPE_READS}`,
    );
    if (context.recordTagScanProgress) {
      await context.recordTagScanProgress({
        updatedAt: timestamp(),
        scanMode: TAG_MODEL_SCAN_MODES.FIRST_EIGHT,
        observationCount: observations.length,
        actualModelNames: [...actualNamesByNormalized.values()],
        lastObservation: observations.at(-1),
      });
    }
    if (
      swipeIndex >= TAG_MODEL_QUICK_BACKWARD_SWIPES &&
      matchingReturnReadCount >= TAG_BOUNDARY_MATCHING_SWIPE_READS
    ) {
      quickReturnBoundaryConfirmed = true;
      break;
    }
  }
  if (!quickReturnBoundaryConfirmed) {
    throw new Error(
      `quick tag scan could not confirm page-top within ${tagScanSwipeLimit()} downward swipes`,
    );
  }

  const actualModelNames = [...actualNamesByNormalized.values()];
  const verdict = evaluateTagModelAssertions(
    task.modelAssertions,
    actualModelNames,
    { actualNameCollectionComplete: true },
  );
  const evidence = {
    evidenceType: 'TAG_MODEL_NAME_SCAN',
    scanMode: TAG_MODEL_SCAN_MODES.FIRST_EIGHT,
    quickVisibleModelLimit: TAG_MODEL_QUICK_VISIBLE_LIMIT,
    quickForwardSwipes: TAG_MODEL_QUICK_FORWARD_SWIPES,
    quickBackwardSwipes: quickReturnSwipeCount,
    quickReturnMinimumSwipes: TAG_MODEL_QUICK_BACKWARD_SWIPES,
    quickReturnBoundaryConfirmed,
    boundaryMatchingSwipeReads: TAG_BOUNDARY_MATCHING_SWIPE_READS,
    boundaryRule:
      '从标签顶部读取初始屏，手指向上滑2次并保留去重后的前8个模型；返回时至少向下滑2次，并继续读取，连续2次滑动后的文字相同才确认顶部',
    expectedModels: task.modelAssertions,
    actualModelNames,
    foundModelNames: verdict.found.map((item) => item.name),
    missingModels: verdict.missing,
    unexpectedlyPresentModels: verdict.unexpectedlyPresent,
    unresolvedModels: verdict.unresolved,
    unassertedActualModelNames: verdict.unassertedActualModelNames,
    comparisons: verdict.comparisons,
    actualNameCollectionComplete: true,
    actualNameCollectionWarnings: uniqueVisibleModelNames(
      observations
        .filter((observation) => observation.visionError)
        .map((observation) => observation.visionError),
    ),
    observations,
  };
  return {
    matched: verdict.businessVerdict === BUSINESS_VERDICTS.PASS,
    outcome: {
      ...verdict,
      evidence,
    },
  };
}

async function scanTagModelNames(task, context) {
  const scanMode = tagModelScanModeForTask(task);
  if (scanMode === TAG_MODEL_SCAN_MODES.FULL) {
    log(
      `TAG_MODEL_SCAN_MODE ${task.module} | ${task.objectName} | FULL | reason=more-than-four-added-or-has-deletion`,
    );
    return scanTagModelNamesFull(task, context, {
      scanMode: TAG_MODEL_SCAN_MODES.FULL,
      allowEarlyPresentStop: false,
    });
  }

  const quickResult = await scanTagModelNamesFirstEight(task, context);
  if (quickResult.matched) {
    log(
      `TAG_MODEL_QUICK_VERDICT ${task.module} | ${task.objectName} | PASS | TAG_MODEL_NAMES_MATCH`,
    );
    return quickResult.outcome;
  }

  log(
    `TAG_MODEL_QUICK_VERDICT ${task.module} | ${task.objectName} | MISS | fallback=original-full-scan`,
  );
  const fullOutcome = await scanTagModelNamesFull(task, context, {
    scanMode: TAG_MODEL_SCAN_MODES.FULL_FALLBACK,
    allowEarlyPresentStop: false,
  });
  fullOutcome.evidence.quickScan = quickResult.outcome.evidence;
  fullOutcome.evidence.quickFallbackTriggered = true;
  return fullOutcome;
}

function extractHierarchyXml(value) {
  const text = String(value ?? '');
  const hierarchyStart = text.indexOf('<hierarchy');
  const hierarchyEnd = text.indexOf('</hierarchy>', hierarchyStart);
  if (hierarchyStart < 0 || hierarchyEnd < 0) return '';
  const declarationStart = text.lastIndexOf('<?xml', hierarchyStart);
  return text.slice(
    declarationStart >= 0 ? declarationStart : hierarchyStart,
    hierarchyEnd + '</hierarchy>'.length,
  );
}

async function readPageHierarchy(deviceId, options = {}) {
  const errors = [];
  const deadline = Number.isFinite(options.deadline)
    ? options.deadline
    : null;
  const timeoutFor = (maximumMs, stage) => {
    if (deadline === null) return maximumMs;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`UI hierarchy deadline reached during ${stage}`);
    }
    return Math.max(1, Math.min(maximumMs, remainingMs));
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const direct = adb(
        deviceId,
        ['exec-out', 'uiautomator', 'dump', '/dev/tty'],
        { timeout: timeoutFor(15_000, 'direct dump') },
      );
      const hierarchy = extractHierarchyXml(direct);
      if (hierarchy) return hierarchy;
      errors.push('direct dump returned no hierarchy XML');
    } catch (error) {
      errors.push(error?.message || String(error));
      if (deadline !== null && Date.now() >= deadline) break;
    }

    const remotePath = `/sdcard/am-inspection-scan-${process.pid}.xml`;
    try {
      adb(
        deviceId,
        ['shell', 'uiautomator', 'dump', remotePath],
        { timeout: timeoutFor(15_000, 'file dump') },
      );
      const hierarchy = extractHierarchyXml(
        adb(deviceId, ['shell', 'cat', remotePath], {
          timeout: timeoutFor(10_000, 'file dump read'),
        }),
      );
      if (hierarchy) return hierarchy;
      errors.push('file dump returned no hierarchy XML');
    } catch (error) {
      errors.push(error?.message || String(error));
      if (deadline !== null && Date.now() >= deadline) break;
    }

    if (attempt < 3) {
      log(`UI_HIERARCHY_RETRY attempt=${attempt}/3`);
      const retryDelayMs =
        deadline === null ? 750 : Math.min(750, deadline - Date.now());
      if (retryDelayMs <= 0) break;
      await sleep(retryDelayMs);
    }
  }
  throw new Error(
    `UI hierarchy unavailable after 3 attempts: ${errors.at(-1) || 'unknown error'}`,
  );
}

function queryPayload(value) {
  if (!value || typeof value !== 'object') return {};
  if (value.modelSearch && typeof value.modelSearch === 'object') {
    return value.modelSearch;
  }
  return value;
}

function isAddedModelTitleTask(task) {
  const changeTypes = new Set(task?.changeTypes ?? []);
  return (
    changeTypes.has('MODEL_CATALOG_ADD') &&
    !changeTypes.has('MODEL_CATALOG_DELETE')
  );
}

async function queryAddedModelTitle(agent, timeoutMs = 60_000) {
  const extracted = queryPayload(
    await aiQuery(
      agent,
      {
        firstResultTitle:
          'Read only the exact visible model title on the first search-result card. Return an empty string when no result title is visible.',
      },
      timeoutMs,
    ),
  );
  const title = String(extracted.firstResultTitle ?? '').trim();
  log(`MODEL_TITLE_EVIDENCE title=${JSON.stringify(title)}`);
  return title;
}

async function waitForAddedModelTitleVerdict(
  task,
  context,
  timeoutMs = MODEL_SEARCH_RESULT_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastReadError = null;
  let readSucceeded = false;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    try {
      const firstResultTitle = await queryAddedModelTitle(
        context.agent,
        Math.min(60_000, remainingMs),
      );
      readSucceeded = true;
      if (firstResultTitle) {
        return judgeAddedModelTitle({
          modelName: task.objectName,
          firstResultTitle,
        });
      }
    } catch (error) {
      lastReadError = error;
      log(`MODEL_TITLE_READ_RETRY ${error?.message || error}`);
    }
    const waitMs = Math.min(
      MODEL_SEARCH_POLL_INTERVAL_MS,
      Math.max(0, deadline - Date.now()),
    );
    if (waitMs > 0) await sleep(waitMs);
  }

  throw new Error(
    `model search title was not completely readable within ${
      timeoutMs / 1000
    } seconds: ${
      lastReadError?.message ||
      (readSucceeded
        ? 'no first result title was visible'
        : 'AI returned no readable title response')
    }`,
  );
}

async function queryModelSearchEvidence(agent, timeoutMs = 60_000) {
  const extracted = queryPayload(
    await aiQuery(
      agent,
      {
        resultState:
          'Read the current search result only. Return exactly one of RESULTS, NO_RESULTS, LOADING, NETWORK_ERROR, APP_ERROR, or UNKNOWN. If any first result card is visible, return RESULTS even when unrelated No results text also appears elsewhere.',
        firstResultVisible:
          'Read the first result card only. Return true only when that card is visibly present.',
        firstResultTitle:
          'Read the first result card only. Return its exact visible model title, preserving spaces and capitalization. Return an empty string when unavailable.',
        firstResultImageState:
          'Read the image inside the first result card only. Return exactly one of LOADED, PLACEHOLDER, LOADING, MISSING, or UNKNOWN.',
        pageIssue:
          'Return the visible network/app error text, or an empty string when there is no error.',
      },
      timeoutMs,
    ),
  );

  const evidence = normalizeModelSearchEvidence({
    ...extracted,
    extractedAt: timestamp(),
  });
  log(
    `MODEL_EVIDENCE state=${evidence.resultState} visible=${evidence.firstResultVisible} title=${JSON.stringify(
      evidence.firstResultTitle,
    )} image=${evidence.firstResultImageState}`,
  );
  return evidence;
}

async function waitForModelSearchVerdict(
  task,
  context,
  timeoutMs = MODEL_SEARCH_RESULT_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastVerdict = null;
  let lastReadError = null;
  let consecutiveNoResultReadCount = 0;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    try {
      const evidence = await queryModelSearchEvidence(
        context.agent,
        Math.min(60_000, remainingMs),
      );
      lastVerdict = judgeModelSearchEvidence({
        modelName: task.objectName,
        expectedState: task.expectedState,
        evidence,
      });
      const explicitNoResult = isExplicitModelSearchNoResult(lastVerdict);
      consecutiveNoResultReadCount = explicitNoResult
        ? consecutiveNoResultReadCount + 1
        : 0;
      const classification = classifyModelSearchObservation(lastVerdict);
      if (classification.state === 'BUSINESS_COMPLETE') {
        if (
          explicitNoResult &&
          consecutiveNoResultReadCount <
            MODEL_SEARCH_NO_RESULT_CONFIRMATION_READS
        ) {
          log(
            'MODEL_NO_RESULT_CONFIRMATION ' +
              consecutiveNoResultReadCount +
              '/' +
              MODEL_SEARCH_NO_RESULT_CONFIRMATION_READS,
          );
        } else {
          return lastVerdict;
        }
      }
      if (classification.state === 'EXECUTION_INCOMPLETE') {
        lastReadError = new Error(classification.reason);
      }
    } catch (error) {
      lastReadError = error;
      log(`MODEL_RESULT_READ_RETRY ${error?.message || error}`);
    }
    const waitMs = Math.min(
      MODEL_SEARCH_POLL_INTERVAL_MS,
      Math.max(0, deadline - Date.now()),
    );
    if (waitMs > 0) await sleep(waitMs);
  }

  if (
    isExplicitModelSearchNoResult(lastVerdict) &&
    consecutiveNoResultReadCount < MODEL_SEARCH_NO_RESULT_CONFIRMATION_READS
  ) {
    throw new Error(
      'model search no-result state was not confirmed by ' +
        MODEL_SEARCH_NO_RESULT_CONFIRMATION_READS +
        ' consecutive reads',
    );
  }

  const deadlineResult = resolveModelSearchAtDeadline(lastVerdict);
  if (deadlineResult.state === 'BUSINESS_COMPLETE') {
    return deadlineResult.verdict;
  }
  throw new Error(
    `model search result was not completely readable within ${timeoutMs / 1000} seconds: ${
      lastReadError?.message ||
      deadlineResult.reason ||
      'first result card name/image unavailable'
    }`,
  );
}

function modelSearchOperationDeadline() {
  return Date.now() + MODEL_SEARCH_OPERATION_TIMEOUT_MS;
}

function assertModelSearchOperationTime(deadline, stage) {
  if (Date.now() > deadline) {
    throw new Error(
      `deterministic model search exceeded ${
        MODEL_SEARCH_OPERATION_TIMEOUT_MS / 1000
      } seconds at ${stage}`,
    );
  }
}

function adbTap(deviceId, point) {
  adb(
    deviceId,
    ['shell', 'input', 'tap', String(point.x), String(point.y)],
    { timeout: 3_000 },
  );
}

function clearModelSearchInput(deviceId) {
  const deleteKeys = [];
  for (let index = 0; index < 60; index += 1) {
    deleteKeys.push('67', '112');
  }
  adb(
    deviceId,
    ['shell', 'input', 'keyevent', '123', ...deleteKeys],
    { timeout: 5_000 },
  );
}

function currentInputMethod(deviceId) {
  return adb(
    deviceId,
    ['shell', 'settings', 'get', 'secure', 'default_input_method'],
    { timeout: 3_000 },
  ).trim();
}

function enabledInputMethods(deviceId) {
  return adb(deviceId, ['shell', 'ime', 'list', '-s'], {
    timeout: 3_000,
  })
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function setInputMethod(deviceId, inputMethod) {
  adb(deviceId, ['shell', 'ime', 'set', inputMethod], {
    timeout: 3_000,
  });
}

function restoreInputMethod(deviceId, originalInputMethod) {
  if (
    originalInputMethod &&
    originalInputMethod !== 'null' &&
    originalInputMethod !== ADB_UNICODE_INPUT_METHOD
  ) {
    setInputMethod(deviceId, originalInputMethod);
    return originalInputMethod;
  }
  adb(deviceId, ['shell', 'ime', 'reset'], { timeout: 3_000 });
  return 'system-default';
}

function inputModelSearchText(deviceId, modelName) {
  if (!requiresAdbUnicodeInput(modelName)) {
    adb(
      deviceId,
      ['shell', 'input', 'text', encodeAdbInputText(modelName)],
      { timeout: 5_000 },
    );
    return 'adb-text';
  }

  const originalInputMethod = currentInputMethod(deviceId);
  const inputMethods = enabledInputMethods(deviceId);
  if (!inputMethods.includes(ADB_UNICODE_INPUT_METHOD)) {
    throw new Error(
      `Unicode model search input method is not installed or enabled: ${ADB_UNICODE_INPUT_METHOD}`,
    );
  }

  let switched = false;
  try {
    setInputMethod(deviceId, ADB_UNICODE_INPUT_METHOD);
    switched = true;
    const clearOutput = adb(
      deviceId,
      ['shell', 'am', 'broadcast', '-a', 'ADB_CLEAR_TEXT'],
      { timeout: 5_000 },
    );
    if (!/Broadcast completed:/u.test(clearOutput)) {
      throw new Error(
        `Unicode model search clear broadcast did not complete: ${clearOutput.trim()}`,
      );
    }
    const output = adb(
      deviceId,
      [
        'shell',
        'am',
        'broadcast',
        '-a',
        'ADB_INPUT_B64',
        '--es',
        'msg',
        encodeAdbUnicodeInput(modelName),
      ],
      { timeout: 5_000 },
    );
    if (!/Broadcast completed:/u.test(output)) {
      throw new Error(
        `Unicode model search input broadcast did not complete: ${output.trim()}`,
      );
    }
    log(
      `MODEL_SEARCH_UNICODE_INPUT_SET query=${JSON.stringify(modelName)}`,
    );
    return 'adb-unicode-ime';
  } finally {
    if (switched) {
      const restored = restoreInputMethod(deviceId, originalInputMethod);
      log(`MODEL_SEARCH_INPUT_METHOD_RESTORED ${restored}`);
    }
  }
}

async function normalizeModelSearchPage(
  deviceId,
  packageName,
  deadline,
  attempt,
) {
  wakeAndBringToFront(deviceId, packageName);
  await sleep(800);
  if (attempt === 2) {
    for (let index = 0; index < MODEL_SEARCH_BACK_PRESS_COUNT; index += 1) {
      adb(
        deviceId,
        ['shell', 'input', 'keyevent', 'BACK'],
        { timeout: 3_000 },
      );
      await sleep(200);
    }
    wakeAndBringToFront(deviceId, packageName);
    await sleep(800);
    log(
      `MODEL_SEARCH_SECOND_ATTEMPT_PAGE_RESET backs=${MODEL_SEARCH_BACK_PRESS_COUNT}`,
    );
  }
  assertModelSearchOperationTime(deadline, 'page normalization');
}

async function restartAppForThirdModelSearchAttempt(
  deviceId,
  packageName,
) {
  adb(deviceId, ['shell', 'am', 'force-stop', packageName], {
    timeout: 5_000,
  });
  log(
    `MODEL_SEARCH_APP_RESTART attempt=${MODEL_SEARCH_EXECUTION_ATTEMPT_MAX} force-stopped ${packageName}`,
  );
  await sleep(800);
  wakeAndBringToFront(deviceId, packageName);
  log(
    `MODEL_SEARCH_APP_RESTART attempt=${MODEL_SEARCH_EXECUTION_ATTEMPT_MAX} relaunched ${packageName}; next=FIRST_ATTEMPT_FLOW`,
  );
  await sleep(10_000);
}

async function performModelSearch(task, context) {
  const { deviceId, packageName, attempt } = context;
  const deadline = modelSearchOperationDeadline();
  await normalizeModelSearchPage(deviceId, packageName, deadline, attempt);

  const screenSize = parsePhysicalScreenSize(
    adb(deviceId, ['shell', 'wm', 'size'], { timeout: 3_000 }),
  );
  const targets = deterministicModelSearchTargets(screenSize);
  adbTap(deviceId, targets.homeSearch);
  log('MODEL_SEARCH_OPENED deterministic');
  await sleep(600);
  assertModelSearchOperationTime(deadline, 'open search');

  adbTap(deviceId, targets.searchInput);
  clearModelSearchInput(deviceId);
  const inputMode = inputModelSearchText(deviceId, task.objectName);
  log(
    `MODEL_SEARCH_INPUT_SET deterministic mode=${inputMode} query=${JSON.stringify(
      task.objectName,
    )}`,
  );
  await sleep(300);
  assertModelSearchOperationTime(deadline, 'input model name');

  adbTap(deviceId, targets.submitSearch);
  log(
    `MODEL_SEARCH_SUBMITTED deterministic query=${JSON.stringify(
      task.objectName,
    )}`,
  );
  await sleep(500);
  assertModelSearchOperationTime(deadline, 'submit search');
}

async function runModelSearch(task, context) {
  const { captureCheckpoint } = context;
  const attemptDeadline = Date.now() + MODEL_SEARCH_ATTEMPT_TIMEOUT_MS;
  await performModelSearch(task, context);
  const resultTimeoutMs = Math.min(
    MODEL_SEARCH_RESULT_TIMEOUT_MS,
    attemptDeadline - Date.now(),
  );
  if (resultTimeoutMs <= 0) {
    throw new Error(
      `model search attempt timed out after ${MODEL_SEARCH_ATTEMPT_TIMEOUT_MS}ms`,
    );
  }
  const verdict = isAddedModelTitleTask(task)
    ? await waitForAddedModelTitleVerdict(task, context, resultTimeoutMs)
    : await waitForModelSearchVerdict(task, context, resultTimeoutMs);
  await captureCheckpoint(1);
  log(
    `MODEL_VERDICT ${task.objectName} | ${verdict.businessVerdict} | ${verdict.verdictReasonCode}`,
  );
  return verdict;
}

function visualHomeTagReadEnabled(task) {
  return (
    task?.flow === 'HOME_TAG' &&
    homeTagTitleHasDecorativeSymbols(task?.objectName)
  );
}

async function readVisualHomeTagLocation(agent, task) {
  if (!visualHomeTagReadEnabled(task)) return null;

  let response;
  try {
    response = await aiQuery(
      agent,
      {
        [HOME_TAG_VISUAL_TITLES_KEY]:
          'Inspect only the visible section-title rows on the current AIMirror Home feed. Return every exact printed section title from top to bottom as one plain string separated by ||. Keep any printed leading decorative icon and trailing arrow. Exclude model-card names, navigation tabs, buttons, account text, and status text. Return an empty string if no section title is readable. This is read-only: do not click, tap, or scroll.',
      },
      TAG_VISUAL_READ_TIMEOUT_MS,
    );
  } catch (error) {
    log(
      `TAG_ENTRY_VISUAL_READ_UNAVAILABLE ${task.module} | ${task.objectName} | ${
        error?.message || String(error)
      }`,
    );
    return null;
  }

  const rawResponse = compactVisionResponse(response);
  const matchedTitle = exactVisualHomeTagTitle(
    response,
    task.objectName,
  );
  log(
    `TAG_ENTRY_VISUAL_READ ${task.module} | ${task.objectName} | matched=${
      matchedTitle ? 'yes' : 'no'
    } | raw=${rawResponse}`,
  );
  if (!matchedTitle) return null;

  let locateResult;
  try {
    locateResult = await tagAiLocate(
      agent,
      `Locate the exact visible Home section title text ${matchedTitle}. It is a section-title row, not a model card, navigation tab, button, or account item. Read and locate only; do not click, tap, or scroll.`,
      TAG_VISUAL_READ_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(
      `AI read exact tag title ${matchedTitle} but could not locate it safely: ${
        error?.message || String(error)
      }`,
    );
  }

  const tapTarget = safeVisualHomeTagTapTarget(locateResult);
  if (!tapTarget) {
    throw new Error(
      `AI read exact tag title ${matchedTitle} but returned an unsafe title location`,
    );
  }
  log(
    `TAG_ENTRY_VISUAL_LOCATION ${task.module} | ${task.objectName} | text=${matchedTitle} | (${tapTarget.x},${tapTarget.y})`,
  );
  return {
    source: 'ai-visual-text',
    matchedTitle,
    tapTarget,
  };
}

async function visibleTagEntryMatch(agent, observation, task) {
  if (exactSectionTitleVisible(observation.hierarchy, task.objectName)) {
    return {
      source: 'control-tree',
      matchedTitle: task.objectName,
      tapTarget: null,
    };
  }
  return readVisualHomeTagLocation(agent, task);
}

async function findTagWithoutOpening(agent, deviceId, task) {
  const { module, objectName, flow } = task;
  const observe = async () => {
    const hierarchy = await readPageHierarchy(deviceId);
    return {
      hierarchy,
      signature: pageTextContentSignature(hierarchy),
    };
  };
  let observation = await observe();
  let entryMatch = await visibleTagEntryMatch(agent, observation, task);
  if (entryMatch) {
    log(
      `TAG_ENTRY_FOUND ${module} | ${objectName} | direction=initial-top | swipe=0 | via=${entryMatch.source}`,
    );
    await waitForTagLoadedImages(agent, TAG_HOME_RECOVERY_TIMEOUT_MS);
    return {
      lastObservation: observation,
      visualTapTarget: entryMatch.tapTarget,
      visualMatchedTitle: entryMatch.matchedTitle,
      stoppedAt: {
        direction: 'initial-top',
        swipeIndex: 0,
      },
    };
  }

  let previousSwipeSignature = '';
  let matchingSwipeReadCount = 0;
  for (
    let swipeIndex = 1;
    swipeIndex <= tagScanSwipeLimit();
    swipeIndex += 1
  ) {
    // Gesture direction is named from the finger movement: finger up reveals
    // content farther down the tag list.
    await tagVerticalSwipe(
      deviceId,
      flow === 'HOME_TAG'
        ? HOME_TAG_ENTRY_SWIPE_SETTLE_MS
        : undefined,
    );
    observation = await observe();
    const signature = String(observation.signature ?? '');
    matchingSwipeReadCount =
      signature &&
      previousSwipeSignature &&
      signature === previousSwipeSignature
        ? Math.max(2, matchingSwipeReadCount + 1)
        : signature
          ? 1
          : 0;
    previousSwipeSignature = signature;

    log(
      `TAG_ENTRY_SCAN ${module} | ${objectName} | direction=finger-up | swipe=${swipeIndex}/${tagScanSwipeLimit()} | matching-text=${matchingSwipeReadCount}/${TAG_BOUNDARY_MATCHING_SWIPE_READS}`,
    );

    entryMatch = await visibleTagEntryMatch(agent, observation, task);
    if (entryMatch) {
      log(
        `TAG_ENTRY_FOUND ${module} | ${objectName} | direction=finger-up | swipe=${swipeIndex} | via=${entryMatch.source}`,
      );
      await waitForTagLoadedImages(agent, TAG_HOME_RECOVERY_TIMEOUT_MS);
      return {
        lastObservation: observation,
        visualTapTarget: entryMatch.tapTarget,
        visualMatchedTitle: entryMatch.matchedTitle,
        stoppedAt: {
          direction: 'finger-up',
          swipeIndex,
        },
      };
    }

    const explicitHomeBottom =
      flow === 'HOME_TAG' &&
      exactSectionTitleVisible(
        observation.hierarchy,
        'More Content is Coming!',
      );
    const matchingTextBottom =
      matchingSwipeReadCount >= TAG_BOUNDARY_MATCHING_SWIPE_READS;
    if (explicitHomeBottom || matchingTextBottom) {
      log(
        `TAG_ENTRY_BOUNDARY ${module} | ${objectName} | page-bottom | reason=${
          explicitHomeBottom ? 'home-bottom-marker' : 'matching-text'
        }`,
      );
      throw new Error(
        `section title "${objectName}" not found from restarted page-top through confirmed page-bottom`,
      );
    }
  }

  throw new Error(
    `section title "${objectName}" not found and page-bottom was not confirmed within ${tagScanSwipeLimit()} finger-up swipes from restarted page-top`,
  );
}

function isTagFlow(flow) {
  return flow === 'HOME_TAG' || flow === 'VIDEO_TAG' || flow === 'FILTER_TAG';
}

async function restartAppForTagAttempt(deviceId, packageName) {
  adb(deviceId, ['shell', 'am', 'force-stop', packageName], {
    timeout: 5_000,
  });
  log(`TAG_APP_RESTART force-stopped ${packageName}`);
  await sleep(800);
  // recoverHome launches the stopped package and confirms Home from the
  // control tree. A fresh launch resets every tag list to its page-top.
}

async function restartAppForReleaseInspection(
  deviceId,
  packageName,
  firstTaskFlow,
) {
  adb(deviceId, ['shell', 'am', 'force-stop', packageName], {
    timeout: 5_000,
  });
  log(`RELEASE_INSPECTION_APP_RESTART force-stopped ${packageName}`);
  await sleep(800);
  wakeAndBringToFront(deviceId, packageName);
  log(`RELEASE_INSPECTION_APP_RESTART relaunched ${packageName}`);
  await sleep(firstTaskFlow === 'MODEL_SEARCH' ? 10_000 : 4_000);
}

async function assertTagModuleVisible(deviceId, flow) {
  const hierarchy = await readPageHierarchy(deviceId);
  if (flow === 'HOME_TAG') {
    const homeState = inspectTagHomeHierarchy(hierarchy);
    if (!homeState.stable) {
      throw new Error(
        `tag module guard failed: expected stable HOME_TAG, homeSelected=${homeState.homeTab.selected}, homeContent=${homeState.homeContentVisible}, drawer=${homeState.accountDrawerVisible}`,
      );
    }
    return hierarchy;
  }

  const moduleState = inspectMoreStyleModuleHierarchy(hierarchy, flow);
  if (!moduleState.stable) {
    throw new Error(
      `tag module guard failed: expected ${flow}, effectsVisible=${moduleState.effectsTab.visible}, effectsSelected=${moduleState.effectsTab.selected}, ${moduleState.expectedTopTab}Visible=${moduleState.topTab.visible}, ${moduleState.expectedTopTab}Selected=${moduleState.topTab.selected}`,
    );
  }
  return hierarchy;
}

async function waitForHierarchyCondition(
  deviceId,
  timeoutMs,
  condition,
  label,
) {
  const deadline = Date.now() + timeoutMs;
  let lastHierarchy = '';
  while (Date.now() < deadline) {
    try {
      lastHierarchy = await readPageHierarchy(deviceId, { deadline });
      if (condition(lastHierarchy)) {
        log(`MORE_STYLE_WAIT_READY ${label}`);
        return lastHierarchy;
      }
    } catch (error) {
      if (Date.now() >= deadline) break;
      log(
        `MORE_STYLE_WAIT_READ_RETRY ${label} | ${error?.message || String(error)}`,
      );
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(250, remainingMs));
  }
  log(`MORE_STYLE_WAIT_FALLBACK ${label} | max=${timeoutMs}ms`);
  return null;
}

function moreStyleEffectsReady(hierarchy, flow) {
  const state = inspectMoreStyleModuleHierarchy(hierarchy, flow);
  return state.effectsTab.selected && state.topTab.visible;
}

function moreStyleModuleReady(hierarchy, flow) {
  return inspectMoreStyleModuleHierarchy(hierarchy, flow).stable;
}

async function tryDeterministicMoreStyleTab(
  deviceId,
  flow,
  tabKey,
  timeoutMs,
) {
  let hierarchy;
  try {
    hierarchy = await readPageHierarchy(deviceId, {
      deadline: Date.now() + timeoutMs,
    });
  } catch (error) {
    log(
      `MORE_STYLE_TREE_TAP_UNAVAILABLE ${tabKey} | ${error?.message || String(error)}`,
    );
    return false;
  }
  const state = inspectMoreStyleModuleHierarchy(hierarchy, flow);
  const ready =
    tabKey === 'effects'
      ? moreStyleEffectsReady(hierarchy, flow)
      : moreStyleModuleReady(hierarchy, flow);
  if (ready) {
    log(`MORE_STYLE_TREE_TAP_SKIPPED ${tabKey} | already-ready`);
    return true;
  }

  const target =
    tabKey === 'effects'
      ? state.effectsTab.tapTarget
      : state.topTab.tapTarget;
  if (!target) {
    log(`MORE_STYLE_TREE_TAP_UNAVAILABLE ${tabKey} | no-unique-target`);
    return false;
  }
  adbTap(deviceId, target);
  log(
    `MORE_STYLE_TREE_TAP ${tabKey} | (${target.x},${target.y})`,
  );
  const confirmed = await waitForHierarchyCondition(
    deviceId,
    timeoutMs,
    (candidate) =>
      tabKey === 'effects'
        ? moreStyleEffectsReady(candidate, flow)
        : moreStyleModuleReady(candidate, flow),
    `${flow}:${tabKey}`,
  );
  return Boolean(confirmed);
}

function tagOpenGuardSatisfied(hierarchy, objectName, beforeSignature) {
  return (
    exactSectionTitleVisible(hierarchy, objectName) &&
    Boolean(beforeSignature) &&
    pageTextSignature(hierarchy) !== beforeSignature
  );
}

async function openTag(
  agent,
  deviceId,
  task,
  beforeHierarchy,
  visualTapTarget = null,
) {
  const { flow, objectName } = task;
  const visibleTitleText = tagTitleTextOnly(objectName) || objectName;
  const beforeSignature = pageTextSignature(beforeHierarchy);
  if (isMoreStyleTagFlow(flow)) {
    const target = uniqueExactPageTextTapTarget(
      beforeHierarchy,
      objectName,
    );
    let opened = false;
    if (target) {
      adbTap(deviceId, target);
      log(
        `MORE_STYLE_TREE_TAP tag-title="${objectName}" | (${target.x},${target.y})`,
      );
      opened = Boolean(
        await waitForHierarchyCondition(
          deviceId,
          4_000,
          (hierarchy) =>
            tagOpenGuardSatisfied(
              hierarchy,
              objectName,
              beforeSignature,
            ),
          `${flow}:tag-open:${objectName}`,
        ),
      );
    } else {
      log(
        `MORE_STYLE_TREE_TAP_UNAVAILABLE tag-title="${objectName}" | fallback=ai`,
      );
    }
    if (!opened) {
      await tagAiTap(
        agent,
        `Tap the exact section title "${visibleTitleText}" that is currently visible. Do not tap a model card.`,
      );
      await waitForHierarchyCondition(
        deviceId,
        4_000,
        (hierarchy) =>
          tagOpenGuardSatisfied(
            hierarchy,
            objectName,
            beforeSignature,
          ),
        `${flow}:tag-open-ai:${objectName}`,
      );
    }
  } else if (visualTapTarget) {
    adbTap(deviceId, visualTapTarget);
    log(
      `HOME_TAG_VISUAL_TEXT_TAP tag-title=${objectName} | (${visualTapTarget.x},${visualTapTarget.y})`,
    );
    await sleep(4_000);
  } else {
    await tagAiTap(
      agent,
      `Tap the exact section title "${visibleTitleText}" that is currently visible. Do not tap a model card.`,
    );
    await sleep(4_000);
  }
  await waitForTagLoadedImages(agent, TAG_HOME_RECOVERY_TIMEOUT_MS);

  const afterHierarchy = await readPageHierarchy(deviceId);
  let titleStillVisible = exactSectionTitleVisible(
    afterHierarchy,
    objectName,
  );
  if (
    !titleStillVisible &&
    flow === 'HOME_TAG' &&
    visualTapTarget &&
    homeTagTitleHasDecorativeSymbols(objectName)
  ) {
    try {
      const response = await aiQuery(
        agent,
        {
          [HOME_TAG_VISUAL_TITLES_KEY]:
            'Read only the exact visible title of the currently opened AIMirror tag page. Keep any printed leading decorative icon and trailing arrow. Exclude model-card names, navigation tabs, buttons, account text, and status text. Return the title as plain text, or an empty string if it is not readable. Do not click, tap, or scroll.',
        },
        TAG_VISUAL_READ_TIMEOUT_MS,
      );
      const matchedTitle = exactVisualHomeTagTitle(
        response,
        objectName,
      );
      titleStillVisible = Boolean(matchedTitle);
      log(
        `HOME_TAG_VISUAL_OPEN_GUARD ${objectName} | matched=${
          matchedTitle ? 'yes' : 'no'
        } | raw=${compactVisionResponse(response)}`,
      );
    } catch (error) {
      log(
        `HOME_TAG_VISUAL_OPEN_GUARD_UNAVAILABLE ${objectName} | ${
          error?.message || String(error)
        }`,
      );
    }
  }
  const pageChanged =
    Boolean(beforeSignature) &&
    pageTextSignature(afterHierarchy) !== beforeSignature;
  if (!titleStillVisible || !pageChanged) {
    throw new Error(
      `tag open guard failed for "${objectName}": titleVisible=${titleStillVisible}, pageChanged=${pageChanged}`,
    );
  }
  return afterHierarchy;
}

async function enterTagModule(agent, deviceId, flow) {
  if (flow !== 'VIDEO_TAG' && flow !== 'FILTER_TAG') return;
  const tabName = flow === 'VIDEO_TAG' ? 'Video' : 'Filter';
  const effectsReady = await tryDeterministicMoreStyleTab(
    deviceId,
    flow,
    'effects',
    2_500,
  );
  if (!effectsReady) {
    await tagAiTap(
      agent,
      'Tap Effects in the AIMirror bottom navigation. Do not open a content card.',
    );
    await waitForHierarchyCondition(
      deviceId,
      2_500,
      (hierarchy) => moreStyleEffectsReady(hierarchy, flow),
      `${flow}:effects-ai`,
    );
  }

  const moduleReady = await tryDeterministicMoreStyleTab(
    deviceId,
    flow,
    'top-tab',
    3_000,
  );
  if (!moduleReady) {
    await tagAiTap(
      agent,
      `Tap the "${tabName}" tab at the top of the Effects page. Stop on the section list and do not open a content card.`,
    );
    await waitForHierarchyCondition(
      deviceId,
      3_000,
      (hierarchy) => moreStyleModuleReady(hierarchy, flow),
      `${flow}:top-tab-ai`,
    );
  }
}

async function runRegularTag(task, context) {
  const { agent, deviceId, captureCheckpoint } = context;
  await enterTagModule(agent, deviceId, task.flow);
  await assertTagModuleVisible(deviceId, task.flow);

  const tagLocation = await findTagWithoutOpening(agent, deviceId, task);
  await captureCheckpoint(1);

  await openTag(
    agent,
    deviceId,
    task,
    tagLocation.lastObservation.hierarchy,
    tagLocation.visualTapTarget,
  );
  await captureCheckpoint(2);

  if (task.tagModelVerdictEnabled) {
    // Model-name traversal is evidence collection only. The documented tag
    // screenshots remain exactly 1/2 before opening and 2/2 after opening.
    return scanTagModelNames(task, context);
  }
  return null;
}

async function runHomeNew(task, context) {
  const { agent, deviceId, captureCheckpoint } = context;
  await aiAction(
    agent,
    `On the AIMirror Home feed, locate the Inspiration section.
Under Inspiration, find the first card on the left that has a visible "New" marker and open that card.
Stop on the opened New content page.
Do not count or capture the Home entry card.`,
  );
  await sleep(4_000);
  await waitForLoadedImages(agent);

  for (let sequence = 1; sequence <= 4; sequence += 1) {
    await verticalSwipe(deviceId);
    await waitForLoadedImages(agent);
    await captureCheckpoint(sequence);
  }
  return [];
}

async function executeTask(task, context) {
  if (task.flow === 'MODEL_SEARCH') {
    return runModelSearch(task, context);
  }

  if (isTagFlow(task.flow)) {
    await restartAppForTagAttempt(
      context.deviceId,
      context.packageName,
    );
  }

  await recoverHome(
    context.agent,
    context.deviceId,
    context.packageName,
  );

  if (task.flow === 'HOME_NEW') {
    await runHomeNew(task, context);
  } else {
    const tagOutcome = await runRegularTag(task, context);
    if (tagOutcome) return tagOutcome;
  }
  return {
    businessVerdict: BUSINESS_VERDICTS.NOT_EVALUATED,
    verdictReasonCode: 'SCREENSHOT_ONLY_MODULE',
    verdictReason: '该配置模块当前只截图，不进行自动业务判断',
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.plan) throw new Error('--plan <screenshot-plan.json> is required');
if (!args.output) throw new Error('--output <release-output-dir> is required');

const runnerRoot = path.resolve(args['runner-root'] || DEFAULT_RUNNER_ROOT);
await loadEnvFiles(runnerRoot);
applyModelEnvironment();
if (!process.env.MIDSCENE_MODEL_API_KEY) {
  throw new Error('MIDSCENE_MODEL_API_KEY/OPENAI_API_KEY is not configured');
}

const planPath = path.resolve(args.plan);
const outputDir = path.resolve(args.output);
const deviceId = args['device-id'] || process.env.AM_DEVICE_ID || DEFAULT_DEVICE_ID;
const packageName = args.package || process.env.AM_PACKAGE_NAME || DEFAULT_PACKAGE;

const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
const reportTarget = normalizeAppScreenshotReportTarget(
  plan.policy?.reportTarget,
);
const formalGroupOutputEnabled =
  reportTarget === APP_SCREENSHOT_REPORT_TARGETS.FORMAL_GROUP;
if (
  plan.policy?.formalGroupOutputEnabled !== formalGroupOutputEnabled
) {
  throw new Error(
    'Screenshot plan report target does not match formal-group output policy',
  );
}

await fs.mkdir(outputDir, { recursive: true });
const attemptsDir = path.join(outputDir, 'attempts');
const rawDir = path.join(outputDir, 'raw-screenshots');
await fs.mkdir(attemptsDir, { recursive: true });
await fs.mkdir(rawDir, { recursive: true });

const runnerRequire = createRequire(path.join(runnerRoot, 'package.json'));
const midsceneEntry = runnerRequire.resolve('@midscene/android');
const { agentFromAdbDevice } = await import(
  pathToFileURL(midsceneEntry).href
);

const executionPath = path.join(outputDir, 'execution.json');
const execution = {
  executionType: 'AM_RELEASE_APP_SCREENSHOT_EXECUTION_V2',
  messageId: plan.messageId,
  planPath,
  startedAt: timestamp(),
  completedAt: null,
  deviceId,
  packageName,
  formalGroupOutputEnabled,
  formalGroupSendBlockedByUser: !formalGroupOutputEnabled,
  formalGroupSendRequiresExplicitUserConfirmation: true,
  formalGroupSendConfirmed: formalGroupOutputEnabled,
  reportTarget,
  expectedTaskCount: plan.totals.taskCount,
  expectedScreenshotCount: plan.totals.screenshotCount,
  taskResults: [],
};
await writeJsonAtomic(executionPath, execution);

let agent;
try {
  agent = await agentFromAdbDevice(deviceId, {
    autoDismissKeyboard: false,
  });
  await restartAppForReleaseInspection(
    deviceId,
    packageName,
    plan.tasks[0]?.flow,
  );

  for (let taskIndex = 0; taskIndex < plan.tasks.length; taskIndex += 1) {
    const task = plan.tasks[taskIndex];
    const taskPrefix = `${String(taskIndex + 1).padStart(2, '0')}_${safeName(
      task.module,
    )}_${safeName(task.objectName)}`;
    const result = {
      taskId: task.taskId,
      module: task.module,
      objectName: task.objectName,
      flow: task.flow,
      screenshotTotal: task.screenshotTotal,
      expectedState: task.expectedState ?? null,
      modelAssertions: task.modelAssertions ?? [],
      executionState: 'SCREENSHOT_IN_PROGRESS',
      businessVerdict:
        task.businessVerdictEnabled || task.tagModelVerdictEnabled
          ? 'PENDING'
          : BUSINESS_VERDICTS.NOT_EVALUATED,
      verdictReasonCode: null,
      verdictReason: null,
      evidence: null,
      attempts: [],
      screenshots: [],
      finalError: null,
    };
    execution.taskResults.push(result);
    await writeJsonAtomic(executionPath, execution);

    log(
      `TASK_START ${taskIndex + 1}/${plan.tasks.length} ${task.module} | ${
        task.objectName
      } | expected=${task.screenshotTotal}`,
    );

    const tagNameCollectionRetryState =
      createTagNameCollectionRetryState();
    const taskHasAbsentModelAssertion = hasAbsentTagModelAssertion(
      task.modelAssertions,
    );
    let taskAttemptMax = MODEL_SEARCH_EXECUTION_ATTEMPT_MAX;
    const reserveIndependentTagRetry = (failureType, attempt) => {
      markTagNameCollectionRetryUsed({
        retryState: tagNameCollectionRetryState,
        failureType,
      });
      if (taskHasAbsentModelAssertion && attempt >= taskAttemptMax) {
        taskAttemptMax = attempt + 1;
      }
    };

    for (
      let attempt = 1;
      attempt <= taskAttemptMax;
      attempt += 1
    ) {
      const attemptDir = path.join(
        attemptsDir,
        taskPrefix,
        `attempt-${attempt}`,
      );
      await fs.mkdir(attemptDir, { recursive: true });
      const attemptRecord = {
        attempt,
        startedAt: timestamp(),
        completedAt: null,
        state: 'RUNNING',
        businessVerdict: null,
        verdictReasonCode: null,
        verdictReason: null,
        evidence: null,
        screenshots: [],
        error: null,
      };
      result.attempts.push(attemptRecord);

      const captureCheckpoint = async (sequence) => {
        const fileName = `${taskPrefix}_${sequence}of${task.screenshotTotal}.png`;
        const filePath = path.join(attemptDir, fileName);
        await capture(deviceId, filePath);
        attemptRecord.screenshots.push({
          sequence,
          total: task.screenshotTotal,
          label: `${task.module}｜${task.objectName}｜${sequence}/${task.screenshotTotal}截图`,
          path: filePath,
        });
        await writeJsonAtomic(executionPath, execution);
      };

      const recordTagScanProgress = async (progress) => {
        attemptRecord.tagScanProgress = progress;
        await writeJsonAtomic(executionPath, execution);
      };

      try {
        if (
          shouldRestartModelSearchAppBeforeAttempt({
            flow: task.flow,
            attempt,
          })
        ) {
          await restartAppForThirdModelSearchAttempt(
            deviceId,
            packageName,
          );
        }

        const taskOutcome = await executeTask(task, {
          attempt,
          agent,
          deviceId,
          packageName,
          captureCheckpoint,
          recordTagScanProgress,
        });
        attemptRecord.businessVerdict = taskOutcome.businessVerdict;
        attemptRecord.verdictReasonCode = taskOutcome.verdictReasonCode;
        attemptRecord.verdictReason = taskOutcome.verdictReason;
        attemptRecord.evidence = taskOutcome.evidence ?? null;

        const missingAddedModels =
          taskOutcome.evidence?.missingModels ?? [];
        if (
          shouldRetryMissingAddedTagModels({
            module: task.module,
            businessVerdict: taskOutcome.businessVerdict,
            verdictReasonCode: taskOutcome.verdictReasonCode,
            missingModels: missingAddedModels,
            attempt,
            modelAssertions: task.modelAssertions,
            retryState: tagNameCollectionRetryState,
          })
        ) {
          reserveIndependentTagRetry(
            TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.MISSING_ADDED_MODEL,
            attempt,
          );
          log(
            `TAG_ADDED_MODEL_RECHECK_WAIT ${task.module} | ${task.objectName} | delay=${MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS}ms`,
          );
          await sleep(MISSING_ADDED_TAG_MODEL_RETRY_DELAY_MS);
          throw new Error(
            `Added tag model missing requires one delayed app-restart recheck: ${task.module} | ${task.objectName} | ` +
              missingAddedModels
                .map((model) => `${model.name}(${model.id})`)
                .join(', '),
          );
        }

        if (
          shouldRetryTagNameCollectionIncomplete({
            module: task.module,
            businessVerdict: taskOutcome.businessVerdict,
            verdictReasonCode: taskOutcome.verdictReasonCode,
            attempt,
            modelAssertions: task.modelAssertions,
            retryState: tagNameCollectionRetryState,
          })
        ) {
          reserveIndependentTagRetry(
            TAG_NAME_COLLECTION_RETRY_FAILURE_TYPES.INCOMPLETE,
            attempt,
          );
          throw new Error(
            `Tag name collection incomplete requires one retry: ${task.module} | ${task.objectName} | ` +
              (taskOutcome.verdictReason ??
                'tag model name collection was incomplete'),
          );
        }

        if (
          shouldRetryModelSearchBusinessFailure({
            flow: task.flow,
            businessVerdict: taskOutcome.businessVerdict,
            attempt,
          })
        ) {
          throw new Error(
            'model search business failure requires retry: ' +
              (taskOutcome.verdictReasonCode ?? 'MODEL_SEARCH_FAILED') +
              ' | ' +
              (taskOutcome.verdictReason ?? 'model search did not pass'),
          );
        }

        if (attemptRecord.screenshots.length < task.screenshotTotal) {
          throw new Error(
            `captured ${attemptRecord.screenshots.length}/${task.screenshotTotal} minimum required screenshots`,
          );
        }

        const verdictSuffix =
          task.businessVerdictEnabled || task.tagModelVerdictEnabled
            ? `｜${verdictLabel(taskOutcome.businessVerdict)}`
            : '';
        const actualScreenshotTotal = attemptRecord.screenshots.length;
        result.screenshotTotal = actualScreenshotTotal;
        for (const screenshot of attemptRecord.screenshots) {
          const destination = path.join(rawDir, path.basename(screenshot.path));
          await fs.copyFile(screenshot.path, destination);
          result.screenshots.push({
            ...screenshot,
            total: actualScreenshotTotal,
            label: `${task.module}｜${task.objectName}｜${screenshot.sequence}/${actualScreenshotTotal}截图${verdictSuffix}`,
            path: destination,
          });
        }

        attemptRecord.state = 'SCREENSHOTS_CAPTURED';
        attemptRecord.completedAt = timestamp();
        result.executionState = 'SCREENSHOTS_CAPTURED';
        result.businessVerdict = taskOutcome.businessVerdict;
        result.verdictReasonCode = taskOutcome.verdictReasonCode;
        result.verdictReason = taskOutcome.verdictReason;
        result.evidence = taskOutcome.evidence ?? null;
        log(
          `TASK_CAPTURED ${taskIndex + 1}/${plan.tasks.length} ${
            task.module
          } | ${task.objectName} | attempt=${attempt} | verdict=${
            taskOutcome.businessVerdict
          }`,
        );
        break;
      } catch (error) {
        attemptRecord.state = 'SCREENSHOT_ATTEMPT_INCOMPLETE';
        attemptRecord.completedAt = timestamp();
        attemptRecord.error = error?.message || String(error);
        log(
          `TASK_RETRY ${taskIndex + 1}/${plan.tasks.length} ${task.module} | ${
            task.objectName
          } | attempt=${attempt}/${taskAttemptMax} | ${attemptRecord.error.slice(0, 220)}`,
        );

        const failurePath = path.join(attemptDir, 'failure.png');
        try {
          await capture(deviceId, failurePath);
          attemptRecord.failureScreenshot = failurePath;
        } catch {}

        if (attempt === taskAttemptMax) {
          result.executionState = 'SCREENSHOT_INCOMPLETE';
          result.finalError = attemptRecord.error;
          result.businessVerdict = BUSINESS_VERDICTS.ERROR;
          result.verdictReasonCode = 'AUTOMATION_EXECUTION_ERROR';
          result.verdictReason = attemptRecord.error;
          const lastCount = attemptRecord.screenshots.length;
          if (attemptRecord.failureScreenshot) {
            const destination = path.join(
              rawDir,
              `${taskPrefix}_${lastCount}of${task.screenshotTotal}_incomplete.png`,
            );
            await fs.copyFile(attemptRecord.failureScreenshot, destination);
            result.screenshots = [
              {
                sequence: lastCount,
                total: task.screenshotTotal,
                label: `${task.module}｜${task.objectName}｜${lastCount}/${task.screenshotTotal}截图｜截图未完成`,
                path: destination,
                incomplete: true,
              },
            ];
          }
          log(
            `TASK_INCOMPLETE ${taskIndex + 1}/${plan.tasks.length} ${
              task.module
            } | ${task.objectName}`,
          );
        }
      }

      await writeJsonAtomic(executionPath, execution);
    }
  }
} finally {
  execution.completedAt = timestamp();
  execution.summary = {
    taskCount: execution.taskResults.length,
    screenshotCapturedTaskCount: execution.taskResults.filter(
      (result) => result.executionState === 'SCREENSHOTS_CAPTURED',
    ).length,
    screenshotIncompleteTaskCount: execution.taskResults.filter(
      (result) => result.executionState === 'SCREENSHOT_INCOMPLETE',
    ).length,
    reportScreenshotCount: execution.taskResults.reduce(
      (sum, result) => sum + result.screenshots.length,
      0,
    ),
    businessPassTaskCount: execution.taskResults.filter(
      (result) => result.businessVerdict === BUSINESS_VERDICTS.PASS,
    ).length,
    businessFailTaskCount: execution.taskResults.filter(
      (result) => result.businessVerdict === BUSINESS_VERDICTS.FAIL,
    ).length,
    businessErrorTaskCount: execution.taskResults.filter(
      (result) => result.businessVerdict === BUSINESS_VERDICTS.ERROR,
    ).length,
    businessNotEvaluatedTaskCount: execution.taskResults.filter(
      (result) =>
        result.businessVerdict === BUSINESS_VERDICTS.NOT_EVALUATED,
    ).length,
  };
  await writeJsonAtomic(executionPath, execution);
  if (agent?.destroy) {
    try {
      await withTimeout(agent.destroy(), 15_000, 'agent destroy');
    } catch {}
  }
}

log(`EXECUTION_DONE ${JSON.stringify(execution.summary)}`);
