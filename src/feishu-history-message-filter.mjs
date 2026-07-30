import { extractFeishuMessageText } from './feishu-events.mjs';

const AIMIRROR_PUBLISH_TITLE =
  /^AIMirror\s*首屏配置发布成功[!！](?:\s|$)/u;

export function normalizeHistoryMessageText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\*\*/g, '').trimEnd())
    .filter((line) => !/^\s*-{3,}\s*$/u.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isAIMirrorPublishMessageText(value) {
  return AIMIRROR_PUBLISH_TITLE.test(normalizeHistoryMessageText(value));
}

export function isHistoryCandidateCreatedAtOrAfter(
  candidate,
  thresholdMilliseconds,
) {
  const threshold = Number(thresholdMilliseconds);
  const rawCreateTime = Number(candidate?.createTime);
  if (
    !Number.isFinite(threshold) ||
    !Number.isFinite(rawCreateTime) ||
    rawCreateTime <= 0
  ) {
    return false;
  }
  const createTimeMilliseconds =
    rawCreateTime < 10_000_000_000
      ? rawCreateTime * 1000
      : rawCreateTime;
  return createTimeMilliseconds >= threshold;
}

export function findAIMirrorPublishMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object' || message.deleted === true) {
      return [];
    }
    const messageId = String(message.message_id ?? '').trim();
    if (!messageId) return [];

    const extractedText = extractFeishuMessageText({
      content: message?.body?.content,
    });
    const notificationText = normalizeHistoryMessageText(extractedText);
    if (!isAIMirrorPublishMessageText(notificationText)) return [];

    return [{
      messageId,
      chatId: message.chat_id ?? null,
      createTime: message.create_time ?? null,
      messageType: message.msg_type ?? null,
      senderType: message.sender?.sender_type ?? null,
      senderName: message.sender?.sender_name ?? null,
      notificationText,
    }];
  });
}
