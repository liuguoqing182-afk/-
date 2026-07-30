import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import * as Lark from '@larksuiteoapi/node-sdk';

import { FeishuHistoryInspectionRunner } from './feishu-history-inspection-runner.mjs';
import { findAIMirrorPublishMessages } from './feishu-history-message-filter.mjs';
import {
  dispatchUniqueMessages,
  FileMessageIdDeduplicator,
} from './feishu-message-id-deduplicator.mjs';
import {
  assertTestReportDestination,
  deliverPendingFeishuReports,
  FileFeishuReportOutbox,
  renderTestGroupInspectionReport,
  sendFeishuTextMessage,
} from './feishu-report-outbox.mjs';
import { ReleaseMonitor } from './release-monitor.mjs';
import {
  FileHistoryPollStateStore,
  HISTORY_INITIAL_LOOKBACK_MS,
  HISTORY_OVERLAP_MS,
  HISTORY_POLL_INTERVAL_MS,
  pollFeishuHistoryOnce,
} from './feishu-history-poller-core.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

function nonNegativeEnvironment(name, fallback, minimum = 0) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(name + ' must be a number greater than or equal to ' + minimum);
  }
  return value;
}

const appId = requiredEnvironment('FEISHU_APP_ID');
const appSecret = requiredEnvironment('FEISHU_APP_SECRET');
const releaseChatId = requiredEnvironment('FEISHU_CHAT_ID');
const testReportChatId = assertTestReportDestination({
  releaseChatId,
  testChatId: requiredEnvironment('FEISHU_TEST_CHAT_ID'),
});
const uid = requiredEnvironment('AM_INSPECT_UID');
const intervalMs = nonNegativeEnvironment(
  'FEISHU_HISTORY_POLL_INTERVAL_MS',
  HISTORY_POLL_INTERVAL_MS,
  1,
);
const initialLookbackMs = nonNegativeEnvironment(
  'FEISHU_HISTORY_INITIAL_LOOKBACK_MS',
  HISTORY_INITIAL_LOOKBACK_MS,
  1,
);
const overlapMs = nonNegativeEnvironment(
  'FEISHU_HISTORY_OVERLAP_MS',
  HISTORY_OVERLAP_MS,
);
const settleMs = nonNegativeEnvironment('AM_PUBLISH_SETTLE_MS', 8000);
const inspectionDataDir = path.resolve(
  process.env.AM_INSPECT_DATA_DIR ?? 'data',
);
const statePath = path.resolve(
  process.env.FEISHU_HISTORY_POLL_STATE_PATH ??
    'data/feishu-history-poller-state.json',
);
const messageIdStatePath = path.resolve(
  process.env.FEISHU_HISTORY_MESSAGE_ID_STATE_PATH ??
    'data/feishu-history-processed-message-ids.json',
);
const reportOutboxPath = path.resolve(
  process.env.FEISHU_HISTORY_REPORT_OUTBOX_PATH ??
    'data/feishu-history-report-outbox.json',
);
const runOnce = process.argv.includes('--once');
const client = new Lark.Client({ appId, appSecret });
const stateStore = new FileHistoryPollStateStore(statePath);
const messageIdDeduplicator = new FileMessageIdDeduplicator(
  messageIdStatePath,
  { chatId: releaseChatId },
);
const reportOutbox = new FileFeishuReportOutbox(reportOutboxPath);
const monitor = new ReleaseMonitor({
  uid,
  dataDir: inspectionDataDir,
});
const inspectionRunner = new FeishuHistoryInspectionRunner({
  monitor,
  settleMs,
});
inspectionRunner.initialize().then(
  ({ created, baselinePath }) => console.log(
    '[inspection] PRO baseline ' + (created ? 'created' : 'loaded') + ':',
    baselinePath,
  ),
  (error) => console.error(
    '[inspection] baseline initialization failed:',
    error?.message ?? error,
  ),
);

async function deliverTestReports() {
  const delivery = await deliverPendingFeishuReports({
    outbox: reportOutbox,
    allowedReceiveId: testReportChatId,
    sendText: (receiveId, text) => sendFeishuTextMessage({
      client,
      receiveId,
      allowedReceiveId: testReportChatId,
      text,
    }),
  });
  for (const messageId of delivery.sent) {
    console.log('[feishu:report] test-group report sent:', messageId);
  }
  for (const failure of delivery.failed) {
    console.error('[feishu:report] test-group report pending:', failure);
  }
  return delivery;
}

async function poll() {
  await deliverTestReports();
  let candidateStats = {
    total: 0,
    processed: 0,
    duplicates: 0,
    missingMessageId: 0,
  };
  const result = await pollFeishuHistoryOnce({
    client,
    chatId: releaseChatId,
    stateStore,
    initialLookbackMs,
    overlapMs,
    handleMessages: async (messages) => {
      const candidates = findAIMirrorPublishMessages(messages);
      const dispatched = await dispatchUniqueMessages({
        messages: candidates,
        deduplicator: messageIdDeduplicator,
        handleMessage: async (candidate) => {
          const existingReport = await reportOutbox.get(candidate.messageId);
          if (existingReport) {
            console.log('[inspection] recovered persisted report:', {
              messageId: candidate.messageId,
              reportStatus: existingReport.status,
            });
            return;
          }
          const inspection = await inspectionRunner.inspect(candidate);
          const reportText = renderTestGroupInspectionReport(candidate, inspection);
          await reportOutbox.enqueue({
            messageId: candidate.messageId,
            receiveId: testReportChatId,
            text: reportText,
          });
          console.log('[inspection] history publish inspected:', {
            messageId: candidate.messageId,
            status: inspection.result.status,
            passed: inspection.result.passed,
            reportDir: inspection.reportDir,
          });
        },
      });
      candidateStats = {
        total: candidates.length,
        processed: dispatched.processed.length,
        duplicates: dispatched.duplicates.length,
        missingMessageId: dispatched.missingMessageId.length,
      };
      return candidateStats;
    },
  });
  console.log('[feishu:history] poll completed:', {
    startTime: new Date(result.window.startTimeSeconds * 1000).toISOString(),
    endTime: new Date(result.window.endTimeSeconds * 1000).toISOString(),
    messages: result.messages.length,
    publishCandidates: candidateStats.total,
    newPublishCandidates: candidateStats.processed,
    duplicatePublishCandidates: candidateStats.duplicates,
    statePath,
    messageIdStatePath,
    inspectionDataDir,
    reportOutboxPath,
  });
  await deliverTestReports();
  return result;
}

if (runOnce) {
  try {
    await poll();
  } catch (error) {
    console.error('[feishu:history] poll failed:', error?.message ?? error);
    process.exitCode = 1;
  }
} else {
  console.log('[feishu:history] poller started:', {
    intervalMs,
    initialLookbackMs,
    overlapMs,
    statePath,
    messageIdStatePath,
    testReportChatId,
    reportOutboxPath,
    inspectionDataDir,
  });
  while (true) {
    const startedAt = Date.now();
    try {
      await poll();
    } catch (error) {
      console.error('[feishu:history] poll failed:', error?.message ?? error);
    }
    const remainingMs = Math.max(0, intervalMs - (Date.now() - startedAt));
    await delay(remainingMs);
  }
}
