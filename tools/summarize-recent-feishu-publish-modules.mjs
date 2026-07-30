import * as Lark from '@larksuiteoapi/node-sdk';

import { findAIMirrorPublishMessages } from '../src/feishu-history-message-filter.mjs';
import { parseNotification } from '../src/notification-parser.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

const requestedCount = Number(process.argv[2] ?? 100);
if (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 1000) {
  throw new Error('message count must be an integer from 1 to 1000');
}

const client = new Lark.Client({
  appId: requiredEnvironment('FEISHU_APP_ID'),
  appSecret: requiredEnvironment('FEISHU_APP_SECRET'),
});
const chatId = requiredEnvironment('FEISHU_CHAT_ID');
const messages = [];
const messageIds = new Set();
const pageTokens = new Set();
let pageToken;

while (messages.length < requestedCount) {
  const response = await client.im.v1.message.list({
    params: {
      container_id_type: 'chat',
      container_id: chatId,
      sort_type: 'ByCreateTimeDesc',
      page_size: Math.min(50, requestedCount - messages.length),
      with_sender_name: true,
      ...(pageToken ? { page_token: pageToken } : {}),
    },
  });
  if (Number(response?.code ?? 0) !== 0) {
    throw new Error(
      'Feishu history API failed, code=' + response.code +
        ', msg=' + (response.msg ?? ''),
    );
  }
  for (const message of response?.data?.items ?? []) {
    const messageId = String(message?.message_id ?? '').trim();
    if (messageId && messageIds.has(messageId)) continue;
    if (messageId) messageIds.add(messageId);
    messages.push(message);
    if (messages.length >= requestedCount) break;
  }
  if (!response?.data?.has_more || messages.length >= requestedCount) break;
  const nextPageToken = String(response?.data?.page_token ?? '').trim();
  if (!nextPageToken || pageTokens.has(nextPageToken)) {
    throw new Error('Feishu history API returned an invalid repeated page token');
  }
  pageTokens.add(nextPageToken);
  pageToken = nextPageToken;
}

const candidates = findAIMirrorPublishMessages(messages);
const parsedNotifications = candidates.map((candidate) => ({
  candidate,
  notification: parseNotification(candidate.notificationText),
}));
const modules = new Map();
for (const { notification } of parsedNotifications) {
  for (const moduleName of notification.templateSections ?? []) {
    if (!modules.has(moduleName)) {
      modules.set(moduleName, {
        moduleName,
        publishMessages: 0,
        declaredChanges: 0,
        changeTypes: new Map(),
      });
    }
    const module = modules.get(moduleName);
    module.publishMessages += 1;
    const changes = (notification.declaredChanges ?? [])
      .filter((change) => change.template === moduleName);
    module.declaredChanges += changes.length;
    for (const change of changes) {
      module.changeTypes.set(
        change.type,
        (module.changeTypes.get(change.type) ?? 0) + 1,
      );
    }
  }
}

function localTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return new Date(number).toISOString();
}

console.log(JSON.stringify({
  requestedMessages: requestedCount,
  actualMessages: messages.length,
  newestMessageAt: localTime(messages[0]?.create_time),
  oldestMessageAt: localTime(messages.at(-1)?.create_time),
  publishNotifications: candidates.length,
  fullyParsedNotifications: parsedNotifications.filter(
    ({ notification }) => notification.valid && notification.fullyParsed,
  ).length,
  parseProblemMessageIds: parsedNotifications
    .filter(({ notification }) => !notification.valid || !notification.fullyParsed)
    .map(({ candidate }) => candidate.messageId),
  moduleCount: modules.size,
  modules: [...modules.values()].map((module) => ({
    moduleName: module.moduleName,
    publishMessages: module.publishMessages,
    declaredChanges: module.declaredChanges,
    changeTypes: Object.fromEntries(module.changeTypes),
  })),
}, null, 2));
