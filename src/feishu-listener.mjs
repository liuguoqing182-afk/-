import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import * as Lark from '@larksuiteoapi/node-sdk';

import {
  createMessageDeduplicator,
  routeFeishuHealthCheck,
  routeFeishuMessage,
} from './feishu-events.mjs';
import { seedMonitorData } from './monitor-data-seed.mjs';
import { ReleaseMonitor } from './release-monitor.mjs';
import { renderFeishuInspectionSummary } from './release-inspector.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

const appId = requiredEnvironment('FEISHU_APP_ID');
const appSecret = requiredEnvironment('FEISHU_APP_SECRET');
const releaseChatId = requiredEnvironment('FEISHU_CHAT_ID');
const testChatId = requiredEnvironment('FEISHU_TEST_CHAT_ID');
const uid = requiredEnvironment('AM_INSPECT_UID');
if (releaseChatId === testChatId) {
  throw new Error('FEISHU_CHAT_ID and FEISHU_TEST_CHAT_ID must be different');
}
const settleMs = Number(process.env.AM_PUBLISH_SETTLE_MS ?? 8000);
if (!Number.isFinite(settleMs) || settleMs < 0) {
  throw new Error('AM_PUBLISH_SETTLE_MS must be a non-negative number');
}

const baseConfig = { appId, appSecret };
const apiClient = new Lark.Client(baseConfig);
const wsClient = new Lark.WSClient({
  ...baseConfig,
  loggerLevel: Lark.LoggerLevel.info,
});
const releaseDataDir = path.resolve(process.env.AM_INSPECT_DATA_DIR ?? 'data');
const testDataDir = path.resolve(process.env.AM_INSPECT_TEST_DATA_DIR ?? 'data-test');
const monitor = new ReleaseMonitor({
  uid,
  dataDir: releaseDataDir,
});
const monitorReady = monitor.initialize();
const testMonitor = new ReleaseMonitor({
  uid,
  dataDir: testDataDir,
});
const testMonitorReady = seedMonitorData({
  sourceDataDir: releaseDataDir,
  targetDataDir: testDataDir,
}).then(({ seeded }) => {
  if (seeded) console.log('[inspection:test] seeded from release baseline');
  return testMonitor.initialize();
});
const isDuplicate = createMessageDeduplicator();
let queue = Promise.resolve();

async function sendText(receiveId, text) {
  await apiClient.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
}

async function safeSend(receiveId, text) {
  try {
    await sendText(receiveId, text);
  } catch (error) {
    console.error('[feishu] send failed:', error?.message ?? error);
  }
}

async function processPublishMessage(job, options = {}) {
  const activeMonitor = options.monitor ?? monitor;
  const activeMonitorReady = options.monitorReady ?? monitorReady;
  const isTest = options.isTest === true;
  await safeSend(
    job.chatId,
    isTest
      ? '已收到 AM 首屏测试通知，开始隔离巡检。'
      : '已收到 AM 首屏发布通知，开始巡检。',
  );
  try {
    await activeMonitorReady;
    if (settleMs > 0) await delay(settleMs);
    const { result, reportDir } = await activeMonitor.inspect(job.text, {
      messageId: job.messageId,
    });
    console.log(isTest ? '[inspection:test] report:' : '[inspection] report:', reportDir);
    const summary = renderFeishuInspectionSummary(result);
    await safeSend(job.chatId, isTest ? '【测试群隔离巡检】\n' + summary : summary);
  } catch (error) {
    console.error(isTest ? '[inspection:test] failed:' : '[inspection] failed:', error);
    await safeSend(
      job.chatId,
      (isTest ? 'AIMirror 首屏测试巡检执行失败 ❌\n原因：' : 'AIMirror 首屏配置巡检执行失败 ❌\n原因：') +
        (error?.message ?? error),
    );
  }
}

async function processHealthCheck(job) {
  try {
    await testMonitorReady;
    await sendText(
      job.chatId,
      [
        'AIMirror 首屏配置巡检机器人在线 ✅',
        '飞书消息接收：正常',
        '巡检基线：已加载',
        '群用途：测试群（不会触发正式发布巡检）',
      ].join('\n'),
    );
    console.log('[feishu] test health check replied:', job.messageId);
  } catch (error) {
    console.error('[feishu] test health check failed:', error?.message ?? error);
    await safeSend(job.chatId, 'AIMirror 首屏配置巡检自检失败 ❌\n原因：' + (error?.message ?? error));
  }
}

function enqueue(job, options) {
  queue = queue.then(
    () => processPublishMessage(job, options),
    () => processPublishMessage(job, options),
  );
}

const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    const publishMessage = routeFeishuMessage(data, { chatId: releaseChatId });
    if (publishMessage.accepted) {
      if (isDuplicate(publishMessage.messageId)) return;
      console.log('[feishu] AM publish message accepted:', publishMessage.messageId);
      enqueue(publishMessage);
      return;
    }

    const testPublishMessage = routeFeishuMessage(data, { chatId: testChatId });
    if (testPublishMessage.accepted) {
      // Test-group release notifications belong exclusively to the mobile App
      // screenshot pipeline. The history poller owns its durable deduplication
      // and execution; never run the backend configuration monitor here.
      console.log(
        '[feishu] AM test publish delegated to app screenshot poller:',
        testPublishMessage.messageId,
      );
      return;
    }

    const healthCheck = routeFeishuHealthCheck(data, { chatId: testChatId });
    if (healthCheck.accepted) {
      if (isDuplicate(healthCheck.messageId)) return;
      console.log('[feishu] test health check accepted:', healthCheck.messageId);
      await processHealthCheck(healthCheck);
      return;
    }

    const message = data?.event?.message ?? data?.message;
    if (message?.chat_id === releaseChatId || message?.chat_id === testChatId) {
      console.log('[feishu] configured-chat message ignored:', message.message_id, {
        publishReason: publishMessage.reason,
        testPublishReason: testPublishMessage.reason,
        healthReason: healthCheck.reason,
      });
    }
  },
});

monitorReady.then(
  ({
    created,
    baselinePath,
    knownDifferencesCreated,
    knownDifferencesPath,
    knownDifferenceSummary,
    environmentBackupCreated,
    environmentBackupPath,
    environmentBackupSummary,
  }) => {
    console.log('[inspection] PRO baseline ' + (created ? 'created' : 'loaded') + ':', baselinePath);
    console.log(
      '[inspection] known differences ' +
        (knownDifferencesCreated ? 'created' : 'loaded') + ':',
      knownDifferencesPath,
      knownDifferenceSummary,
    );
    console.log(
      '[inspection] DEV/PRO raw backup ' +
        (environmentBackupCreated ? 'created' : 'loaded') + ':',
      environmentBackupPath,
      environmentBackupSummary,
    );
  },
  (error) => console.error('[inspection] baseline initialization failed:', error),
);

testMonitorReady.then(
  ({ created, baselinePath, environmentBackupCreated, environmentBackupPath }) => {
    console.log(
      '[inspection:test] PRO baseline ' + (created ? 'created' : 'loaded') + ':',
      baselinePath,
    );
    console.log(
      '[inspection:test] DEV/PRO raw backup ' +
        (environmentBackupCreated ? 'created' : 'loaded') + ':',
      environmentBackupPath,
    );
  },
  (error) => console.error('[inspection:test] baseline initialization failed:', error),
);

console.log('[feishu] starting WebSocket listener:', {
  releaseChatId,
  testChatId,
});
wsClient.start({ eventDispatcher });
