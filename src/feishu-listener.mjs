import * as Lark from '@larksuiteoapi/node-sdk';

import {
  createMessageDeduplicator,
  routeFeishuHealthCheck,
  routeFeishuMessage,
} from './feishu-events.mjs';
import { sendFeishuTextMessage } from './feishu-report-outbox.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

const appId = requiredEnvironment('FEISHU_APP_ID');
const appSecret = requiredEnvironment('FEISHU_APP_SECRET');
const testChatId = requiredEnvironment('FEISHU_TEST_CHAT_ID');

const baseConfig = { appId, appSecret };
const apiClient = new Lark.Client(baseConfig);
const wsClient = new Lark.WSClient({
  ...baseConfig,
  loggerLevel: Lark.LoggerLevel.info,
});
const isDuplicate = createMessageDeduplicator();

async function sendText(receiveId, text) {
  return sendFeishuTextMessage({
    client: apiClient,
    receiveId,
    allowedReceiveId: testChatId,
    text,
  });
}

async function safeSend(receiveId, text) {
  try {
    await sendText(receiveId, text);
  } catch (error) {
    console.error('[feishu:test] send failed:', error?.message ?? error);
  }
}

async function processHealthCheck(job) {
  try {
    await sendText(
      job.chatId,
      [
        'AIMirror 首屏配置巡检机器人在线 ✅',
        '飞书消息接收：正常',
        '群用途：测试群（不会处理正式群发布消息）',
      ].join('\n'),
    );
    console.log('[feishu:test] health check replied:', job.messageId);
  } catch (error) {
    console.error('[feishu:test] health check failed:', error?.message ?? error);
    await safeSend(
      job.chatId,
      'AIMirror 首屏配置巡检自检失败 ❌\n原因：' +
        (error?.message ?? error),
    );
  }
}

const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    const testPublishMessage = routeFeishuMessage(data, { chatId: testChatId });
    if (testPublishMessage.accepted) {
      // Test-group release notifications belong exclusively to the mobile App
      // screenshot pipeline. The history poller owns durable execution.
      console.log(
        '[feishu:test] AM test publish delegated to app screenshot poller:',
        testPublishMessage.messageId,
      );
      return;
    }

    const healthCheck = routeFeishuHealthCheck(data, { chatId: testChatId });
    if (healthCheck.accepted) {
      if (isDuplicate(healthCheck.messageId)) return;
      console.log('[feishu:test] health check accepted:', healthCheck.messageId);
      await processHealthCheck(healthCheck);
      return;
    }

    const message = data?.event?.message ?? data?.message;
    if (message?.chat_id === testChatId) {
      console.log('[feishu:test] configured-chat message ignored:', message.message_id, {
        testPublishReason: testPublishMessage.reason,
        healthReason: healthCheck.reason,
      });
    }
  },
});

console.log('[feishu:test] starting WebSocket listener:', { testChatId });
wsClient.start({ eventDispatcher });
