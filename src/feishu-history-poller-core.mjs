import fs from 'node:fs/promises';
import path from 'node:path';

export const HISTORY_POLL_INTERVAL_MS = 60 * 60 * 1000;
export const HISTORY_INITIAL_LOOKBACK_MS = 60 * 60 * 1000;
export const HISTORY_OVERLAP_MS = 60 * 1000;
export const HISTORY_POLL_STATE_SCHEMA_VERSION = '1.0';

function finiteNumber(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new TypeError(name + ' must be a number greater than or equal to ' + minimum);
  }
  return number;
}

function checkpointMilliseconds(state) {
  if (!state?.lastSuccessfulPollAt) return null;
  const value = Date.parse(state.lastSuccessfulPollAt);
  if (!Number.isFinite(value)) {
    throw new Error('history poll state contains an invalid lastSuccessfulPollAt');
  }
  return value;
}

export function resolveHistoryPollWindow(options = {}) {
  const nowMs = finiteNumber(options.nowMs ?? Date.now(), 'nowMs');
  const initialLookbackMs = finiteNumber(
    options.initialLookbackMs ?? HISTORY_INITIAL_LOOKBACK_MS,
    'initialLookbackMs',
    1,
  );
  const overlapMs = finiteNumber(
    options.overlapMs ?? HISTORY_OVERLAP_MS,
    'overlapMs',
  );
  const checkpointMs = checkpointMilliseconds(options.state);
  const endTimeSeconds = Math.floor(nowMs / 1000);
  const requestedStartMs = checkpointMs === null
    ? nowMs - initialLookbackMs
    : checkpointMs - overlapMs;
  const startTimeSeconds = Math.max(
    0,
    Math.min(endTimeSeconds, Math.floor(requestedStartMs / 1000)),
  );
  return {
    startTimeSeconds,
    endTimeSeconds,
    usedCheckpoint: checkpointMs !== null,
  };
}

function assertHistoryClient(client) {
  if (typeof client?.im?.v1?.message?.list !== 'function') {
    throw new TypeError('client.im.v1.message.list is required');
  }
}

function messageTime(message) {
  const value = Number(message?.create_time ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export async function fetchFeishuChatHistory(options = {}) {
  const client = options.client;
  assertHistoryClient(client);
  const chatId = String(options.chatId ?? '').trim();
  if (!chatId) throw new Error('chatId is required');
  const startTimeSeconds = Math.floor(finiteNumber(
    options.startTimeSeconds,
    'startTimeSeconds',
  ));
  const endTimeSeconds = Math.floor(finiteNumber(
    options.endTimeSeconds,
    'endTimeSeconds',
  ));
  const pageSize = Math.floor(finiteNumber(options.pageSize ?? 50, 'pageSize', 1));
  if (pageSize > 50) throw new RangeError('pageSize must not exceed 50');

  const messages = [];
  const pageTokens = new Set();
  let pageToken;

  while (true) {
    const params = {
      container_id_type: 'chat',
      container_id: chatId,
      start_time: String(startTimeSeconds),
      end_time: String(endTimeSeconds),
      sort_type: 'ByCreateTimeAsc',
      page_size: pageSize,
      with_sender_name: true,
      ...(pageToken ? { page_token: pageToken } : {}),
    };
    const response = await client.im.v1.message.list({ params });
    if (Number(response?.code ?? 0) !== 0) {
      throw new Error(
        'Feishu history API failed, code=' + response.code + ', msg=' + (response.msg ?? ''),
      );
    }
    const data = response?.data ?? {};
    if (!Array.isArray(data.items)) {
      if (data.items !== undefined) {
        throw new Error('Feishu history API returned invalid data.items');
      }
    } else {
      messages.push(...data.items);
    }
    if (!data.has_more) break;
    const nextPageToken = String(data.page_token ?? '').trim();
    if (!nextPageToken || pageTokens.has(nextPageToken)) {
      throw new Error('Feishu history API returned an invalid repeated page token');
    }
    pageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }

  const seenMessageIds = new Set();
  return messages
    .filter((message) => {
      const messageId = String(message?.message_id ?? '').trim();
      if (!messageId) return true;
      if (seenMessageIds.has(messageId)) return false;
      seenMessageIds.add(messageId);
      return true;
    })
    .sort((left, right) => {
      const timeDifference = messageTime(left) - messageTime(right);
      if (timeDifference !== 0) return timeDifference;
      return String(left?.message_id ?? '').localeCompare(String(right?.message_id ?? ''));
    });
}

export class FileHistoryPollStateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  async load() {
    try {
      const state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (state?.schemaVersion !== HISTORY_POLL_STATE_SCHEMA_VERSION) {
        throw new Error('unsupported history poll state schema');
      }
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = this.filePath + '.tmp-' + process.pid;
    await fs.writeFile(
      temporaryPath,
      JSON.stringify(state, null, 2) + '\n',
      'utf8',
    );
    await fs.rename(temporaryPath, this.filePath);
  }
}

export async function pollFeishuHistoryOnce(options = {}) {
  const chatId = String(options.chatId ?? '').trim();
  if (!chatId) throw new Error('chatId is required');
  if (!options.stateStore?.load || !options.stateStore?.save) {
    throw new TypeError('stateStore with load and save is required');
  }
  const nowMs = finiteNumber(options.now?.() ?? Date.now(), 'nowMs');
  const previousState = await options.stateStore.load();
  if (previousState?.chatId && previousState.chatId !== chatId) {
    throw new Error('history poll state belongs to a different chat');
  }
  const window = resolveHistoryPollWindow({
    nowMs,
    state: previousState,
    initialLookbackMs: options.initialLookbackMs,
    overlapMs: options.overlapMs,
  });
  const messages = await fetchFeishuChatHistory({
    client: options.client,
    chatId,
    startTimeSeconds: window.startTimeSeconds,
    endTimeSeconds: window.endTimeSeconds,
    pageSize: options.pageSize,
  });
  let handleResult;
  if (options.handleMessages !== undefined) {
    if (typeof options.handleMessages !== 'function') {
      throw new TypeError('handleMessages must be a function');
    }
    handleResult = await options.handleMessages(messages, {
      window,
      previousState,
    });
  }
  const nextState = {
    schemaVersion: HISTORY_POLL_STATE_SCHEMA_VERSION,
    chatId,
    lastSuccessfulPollAt: new Date(window.endTimeSeconds * 1000).toISOString(),
    lastMessageCount: messages.length,
    updatedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
  };
  await options.stateStore.save(nextState);
  return {
    window,
    messages,
    previousState,
    nextState,
    handleResult,
  };
}
