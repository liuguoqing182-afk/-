import fs from 'node:fs/promises';
import path from 'node:path';

export const MESSAGE_ID_STATE_SCHEMA_VERSION = '1.0';
export const DEFAULT_MESSAGE_ID_LIMIT = 10000;

function requiredMessageId(value) {
  const messageId = String(value ?? '').trim();
  if (!messageId) throw new Error('messageId is required');
  return messageId;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError(name + ' must be a positive integer');
  }
  return number;
}

export class FileMessageIdDeduplicator {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.chatId = String(options.chatId ?? '').trim();
    if (!this.chatId) throw new Error('chatId is required');
    this.limit = positiveInteger(
      options.limit ?? DEFAULT_MESSAGE_ID_LIMIT,
      'limit',
    );
    this.messageIds = null;
  }

  async load() {
    if (this.messageIds !== null) return;
    let state;
    try {
      state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.messageIds = [];
        return;
      }
      throw error;
    }

    if (state?.schemaVersion !== MESSAGE_ID_STATE_SCHEMA_VERSION) {
      throw new Error('unsupported message ID state schema');
    }
    if (state.chatId !== this.chatId) {
      throw new Error('message ID state belongs to a different chat');
    }
    if (!Array.isArray(state.messageIds)) {
      throw new Error('message ID state contains invalid messageIds');
    }

    const uniqueIds = [];
    const seen = new Set();
    for (const value of state.messageIds) {
      const messageId = requiredMessageId(value);
      if (seen.has(messageId)) continue;
      seen.add(messageId);
      uniqueIds.push(messageId);
    }
    this.messageIds = uniqueIds.slice(-this.limit);
  }

  async has(messageId) {
    const normalizedId = requiredMessageId(messageId);
    await this.load();
    return this.messageIds.includes(normalizedId);
  }

  async markProcessed(messageId) {
    const normalizedId = requiredMessageId(messageId);
    await this.load();
    if (this.messageIds.includes(normalizedId)) return false;

    const nextMessageIds = [...this.messageIds, normalizedId].slice(-this.limit);
    const state = {
      schemaVersion: MESSAGE_ID_STATE_SCHEMA_VERSION,
      chatId: this.chatId,
      messageIds: nextMessageIds,
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = this.filePath + '.tmp-' + process.pid;
    await fs.writeFile(
      temporaryPath,
      JSON.stringify(state, null, 2) + '\n',
      'utf8',
    );
    await fs.rename(temporaryPath, this.filePath);
    this.messageIds = nextMessageIds;
    return true;
  }
}

export async function dispatchUniqueMessages(options = {}) {
  const messages = options.messages;
  if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
  if (
    typeof options.deduplicator?.has !== 'function' ||
    typeof options.deduplicator?.markProcessed !== 'function'
  ) {
    throw new TypeError('deduplicator with has and markProcessed is required');
  }
  if (typeof options.handleMessage !== 'function') {
    throw new TypeError('handleMessage is required');
  }

  const processed = [];
  const duplicates = [];
  const missingMessageId = [];
  for (const message of messages) {
    const messageId = String(message?.messageId ?? '').trim();
    if (!messageId) {
      missingMessageId.push(message);
      continue;
    }
    if (await options.deduplicator.has(messageId)) {
      duplicates.push(message);
      continue;
    }

    await options.handleMessage(message);
    await options.deduplicator.markProcessed(messageId);
    processed.push(message);
  }
  return { processed, duplicates, missingMessageId };
}
