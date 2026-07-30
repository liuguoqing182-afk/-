import * as Lark from '@larksuiteoapi/node-sdk';

import { findAIMirrorPublishMessages } from '../src/feishu-history-message-filter.mjs';
import { fetchFeishuChatHistory } from '../src/feishu-history-poller-core.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

const hours = Number(process.argv[2] ?? 24);
if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
  throw new Error('hours must be greater than 0 and no more than 168');
}

const client = new Lark.Client({
  appId: requiredEnvironment('FEISHU_APP_ID'),
  appSecret: requiredEnvironment('FEISHU_APP_SECRET'),
});
const chatId = requiredEnvironment('FEISHU_CHAT_ID');
const now = Date.now();
const messages = await fetchFeishuChatHistory({
  client,
  chatId,
  startTimeSeconds: Math.floor((now - hours * 60 * 60 * 1000) / 1000),
  endTimeSeconds: Math.floor(now / 1000),
});
const candidates = findAIMirrorPublishMessages(messages);

console.log(JSON.stringify({
  lookbackHours: hours,
  messageCount: messages.length,
  publishCandidates: candidates.map(({
    messageId,
    createTime,
    messageType,
    senderType,
    senderName,
  }) => ({ messageId, createTime, messageType, senderType, senderName })),
}, null, 2));
