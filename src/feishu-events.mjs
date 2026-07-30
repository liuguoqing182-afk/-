function textFromPostNode(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  if (typeof node.content === 'string') return node.content;
  if (node.tag === 'at') return '@' + (node.user_name ?? node.name ?? '用户');
  return '';
}

function collectPostText(value, output) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPostText(item, output);
    return;
  }
  if (typeof value !== 'object') return;
  if (typeof value.title === 'string') output.push(value.title);
  const nodeText = textFromPostNode(value);
  if (nodeText) output.push(nodeText);
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === 'title' || key === 'text' || key === 'content') &&
      typeof child === 'string'
    ) continue;
    collectPostText(child, output);
  }
}

export function extractFeishuMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  let content;
  try {
    content = typeof message.content === 'string'
      ? JSON.parse(message.content)
      : message.content;
  } catch {
    return String(message.content ?? '');
  }
  if (typeof content?.text === 'string') return content.text.trim();
  const pieces = [];
  collectPostText(content, pieces);
  return pieces
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function routeFeishuMessage(data, options = {}) {
  const event = data?.event ?? data;
  const message = event?.message;
  if (!message) return { accepted: false, reason: 'NO_MESSAGE' };
  if (options.chatId && message.chat_id !== options.chatId) {
    return { accepted: false, reason: 'OTHER_CHAT' };
  }
  const text = extractFeishuMessageText(message);
  const notificationStart = text.search(/AIMirror首屏配置发布成功[!！]?/);
  if (notificationStart === -1) {
    return { accepted: false, reason: 'NOT_AM_PUBLISH', text };
  }
  return {
    accepted: true,
    chatId: message.chat_id,
    messageId: message.message_id,
    senderType: event.sender?.sender_type ?? null,
    text: text.slice(notificationStart).trim(),
  };
}

function removeLeadingMention(text) {
  return text.replace(/^@\S+\s*/u, '').trim();
}

export function routeFeishuHealthCheck(data, options = {}) {
  const event = data?.event ?? data;
  const message = event?.message;
  if (!message) return { accepted: false, reason: 'NO_MESSAGE' };
  if (options.chatId && message.chat_id !== options.chatId) {
    return { accepted: false, reason: 'OTHER_CHAT' };
  }

  const text = extractFeishuMessageText(message);
  if (!/^@\S+/u.test(text)) {
    return { accepted: false, reason: 'BOT_NOT_MENTIONED', text };
  }

  const command = removeLeadingMention(text);
  if (command && !/^(?:ping|status|状态|测试|自检|检查|在线|在吗)[?？!！。\s]*$/iu.test(command)) {
    return { accepted: false, reason: 'NOT_HEALTH_CHECK', text };
  }

  return {
    accepted: true,
    chatId: message.chat_id,
    messageId: message.message_id,
    senderType: event.sender?.sender_type ?? null,
    command,
  };
}

export function createMessageDeduplicator(limit = 1000) {
  const seen = new Set();
  return function isDuplicate(messageId) {
    if (!messageId) return false;
    if (seen.has(messageId)) return true;
    seen.add(messageId);
    if (seen.size > limit) seen.delete(seen.values().next().value);
    return false;
  };
}
