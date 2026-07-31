import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import * as Lark from '@larksuiteoapi/node-sdk';

import {
  APP_SCREENSHOT_REPORT_TARGETS,
  normalizeAppScreenshotReportTarget,
} from './app-screenshot-report-target.mjs';
import { AppScreenshotTestPipeline } from './app-screenshot-test-pipeline.mjs';
import {
  findAIMirrorPublishMessages,
  isHistoryCandidateCreatedAtOrAfter,
} from './feishu-history-message-filter.mjs';
import {
  dispatchUniqueMessages,
  FileMessageIdDeduplicator,
} from './feishu-message-id-deduplicator.mjs';
import {
  FileHistoryPollStateStore,
  pollFeishuHistoryOnce,
} from './feishu-history-poller-core.mjs';
import {
  sendFeishuTextMessage,
} from './feishu-report-outbox.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be at least 1`);
  }
  return value;
}

const root = path.resolve(
  process.env.AM_APP_SCREENSHOT_PROJECT_ROOT ?? process.cwd(),
);
const appId = requiredEnvironment('FEISHU_APP_ID');
const appSecret = requiredEnvironment('FEISHU_APP_SECRET');
const formalChatId = requiredEnvironment('FEISHU_CHAT_ID');
const testChatId = requiredEnvironment('FEISHU_TEST_CHAT_ID');
if (formalChatId === testChatId) {
  throw new Error('FEISHU_CHAT_ID and FEISHU_TEST_CHAT_ID must be different');
}
const reportTarget = normalizeAppScreenshotReportTarget(
  process.env.AM_APP_SCREENSHOT_REPORT_TARGET,
);
const formalGroupOutputEnabled =
  reportTarget === APP_SCREENSHOT_REPORT_TARGETS.FORMAL_GROUP;
if (
  formalGroupOutputEnabled &&
  String(process.env.AM_APP_SCREENSHOT_FORMAL_SEND_ENABLED ?? '').trim() !== '1'
) {
  throw new Error(
    'Formal-group screenshot polling requires AM_APP_SCREENSHOT_FORMAL_SEND_ENABLED=1',
  );
}
if (
  formalGroupOutputEnabled &&
  String(
    process.env.AM_APP_SCREENSHOT_FORMAL_CHAT_ID_CONFIRMATION ?? '',
  ).trim() !== formalChatId
) {
  throw new Error(
    'Formal-group screenshot polling chat ID confirmation does not match FEISHU_CHAT_ID',
  );
}
const reportChatId = formalGroupOutputEnabled
  ? formalChatId
  : testChatId;
const modeLabel = formalGroupOutputEnabled ? 'formal' : 'test';
const intervalMs = positiveEnvironment(
  'AM_APP_SCREENSHOT_POLL_INTERVAL_MS',
  Number(
    process.env.AM_APP_SCREENSHOT_TEST_POLL_INTERVAL_MS ??
      (formalGroupOutputEnabled ? 30 * 60 * 1000 : 10_000),
  ),
);
const initialLookbackMs = positiveEnvironment(
  'AM_APP_SCREENSHOT_INITIAL_LOOKBACK_MS',
  Number(
    process.env.AM_APP_SCREENSHOT_TEST_INITIAL_LOOKBACK_MS ??
      (formalGroupOutputEnabled ? 60 * 60 * 1000 : 10 * 60 * 1000),
  ),
);
const requestTimeoutMs = positiveEnvironment(
  'AM_APP_SCREENSHOT_REQUEST_TIMEOUT_MS',
  30_000,
);
const acceptAfterMilliseconds = Date.now() - initialLookbackMs;
const statePath = path.resolve(
  process.env.AM_APP_SCREENSHOT_POLL_STATE_PATH ??
    path.join(
      'data-app-screenshot',
      formalGroupOutputEnabled
        ? 'formal-group-poller-state.json'
        : 'test-group-poller-state.json',
    ),
);
const messageIdPath = path.resolve(
  process.env.AM_APP_SCREENSHOT_MESSAGE_ID_PATH ??
    path.join(
      'data-app-screenshot',
      formalGroupOutputEnabled
        ? 'formal-group-processed-message-ids.json'
        : 'test-group-processed-message-ids.json',
    ),
);
const runOnce = process.argv.includes('--once');

const client = new Lark.Client({ appId, appSecret });
if (client.httpInstance?.defaults) {
  client.httpInstance.defaults.timeout = requestTimeoutMs;
}
const stateStore = new FileHistoryPollStateStore(statePath);
const deduplicator = new FileMessageIdDeduplicator(messageIdPath, {
  chatId: reportChatId,
});
const pipeline = new AppScreenshotTestPipeline({
  root,
  reportTarget,
});

async function safeFailureMessage(candidate, error) {
  const message = [
    formalGroupOutputEnabled
      ? '【AIMirror 首屏配置发布自动化检测】截图流程未完成'
      : '【AIMirror 自动截图测试】截图流程未完成',
    `message_id: ${candidate.messageId}`,
    `原因: ${error?.message ?? error}`,
  ].join('\n');
  try {
    await sendFeishuTextMessage({
      client,
      receiveId: reportChatId,
      allowedReceiveId: reportChatId,
      text: message,
    });
  } catch (sendError) {
    console.error(
      '[app-screenshot:' + modeLabel + '] failure notification failed:',
      sendError?.message ?? sendError,
    );
  }
}

async function poll() {
  let stats = {
    candidates: 0,
    processed: 0,
    duplicates: 0,
    missingMessageId: 0,
  };
  const result = await pollFeishuHistoryOnce({
    client,
    chatId: reportChatId,
    stateStore,
    initialLookbackMs,
    overlapMs: 60_000,
    handleMessages: async (messages) => {
      const candidates = findAIMirrorPublishMessages(messages).filter(
        (candidate) =>
          isHistoryCandidateCreatedAtOrAfter(
            candidate,
            acceptAfterMilliseconds,
          ),
      );
      const dispatched = await dispatchUniqueMessages({
        messages: candidates,
        deduplicator,
        handleMessage: async (candidate) => {
          try {
            const pipelineResult = await pipeline.run(candidate);
            console.log('[app-screenshot:' + modeLabel + '] pipeline completed:', {
              messageId: candidate.messageId,
              skipped: pipelineResult.skipped,
              reason: pipelineResult.reason,
              screenshotCount:
                pipelineResult.executionSummary?.reportScreenshotCount,
              deliveryMessageId: pipelineResult.deliveryMessageId,
              releaseDir: pipelineResult.releaseDir,
            });
          } catch (error) {
            console.error(
              '[app-screenshot:' + modeLabel + '] pipeline failed:',
              candidate.messageId,
              error,
            );
            await safeFailureMessage(candidate, error);
            throw error;
          }
        },
      });
      stats = {
        candidates: candidates.length,
        processed: dispatched.processed.length,
        duplicates: dispatched.duplicates.length,
        missingMessageId: dispatched.missingMessageId.length,
      };
      return stats;
    },
  });
  console.log('[app-screenshot:' + modeLabel + '] poll completed:', {
    messages: result.messages.length,
    ...stats,
    statePath,
    messageIdPath,
  });
}

async function runPollSafely() {
  try {
    await poll();
  } catch (error) {
    console.error(
      '[app-screenshot:' + modeLabel + '] poll failed:',
      error?.stack ?? error,
    );
  }
}

console.log('[app-screenshot:' + modeLabel + '] poller started:', {
  reportTarget,
  intervalMs,
  initialLookbackMs,
  requestTimeoutMs,
  acceptAfter: new Date(acceptAfterMilliseconds).toISOString(),
  statePath,
  messageIdPath,
  root,
});

if (runOnce) {
  await runPollSafely();
} else {
  while (true) {
    const startedAt = Date.now();
    await runPollSafely();
    await delay(Math.max(0, intervalMs - (Date.now() - startedAt)));
  }
}
