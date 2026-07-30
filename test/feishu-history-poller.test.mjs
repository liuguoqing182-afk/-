import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FileHistoryPollStateStore,
  fetchFeishuChatHistory,
  pollFeishuHistoryOnce,
  resolveHistoryPollWindow,
} from '../src/feishu-history-poller-core.mjs';

const fixedNow = Date.parse('2026-07-23T05:00:00.000Z');

test('first poll reads the previous hour and later polls overlap the checkpoint', () => {
  assert.deepEqual(resolveHistoryPollWindow({ nowMs: fixedNow }), {
    startTimeSeconds: Math.floor((fixedNow - 60 * 60 * 1000) / 1000),
    endTimeSeconds: Math.floor(fixedNow / 1000),
    usedCheckpoint: false,
  });

  assert.deepEqual(resolveHistoryPollWindow({
    nowMs: fixedNow,
    state: { lastSuccessfulPollAt: '2026-07-23T04:30:00.000Z' },
    overlapMs: 60 * 1000,
  }), {
    startTimeSeconds: Date.parse('2026-07-23T04:29:00.000Z') / 1000,
    endTimeSeconds: Math.floor(fixedNow / 1000),
    usedCheckpoint: true,
  });
});

test('fetches every history page, removes duplicate message IDs, and sorts messages', async () => {
  const calls = [];
  const pages = [
    {
      code: 0,
      data: {
        has_more: true,
        page_token: 'next-page',
        items: [
          { message_id: 'om_2', create_time: '2000' },
          { message_id: 'om_1', create_time: '1000' },
        ],
      },
    },
    {
      code: 0,
      data: {
        has_more: false,
        items: [
          { message_id: 'om_2', create_time: '2000' },
          { message_id: 'om_3', create_time: '3000' },
        ],
      },
    },
  ];
  const client = {
    im: { v1: { message: { list: async (payload) => {
      calls.push(payload);
      return pages[calls.length - 1];
    } } } },
  };

  const messages = await fetchFeishuChatHistory({
    client,
    chatId: 'oc_release',
    startTimeSeconds: 100,
    endTimeSeconds: 200,
  });

  assert.deepEqual(messages.map(({ message_id }) => message_id), ['om_1', 'om_2', 'om_3']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.container_id_type, 'chat');
  assert.equal(calls[0].params.container_id, 'oc_release');
  assert.equal(calls[0].params.with_sender_name, true);
  assert.equal(calls[0].params.page_token, undefined);
  assert.equal(calls[1].params.page_token, 'next-page');
});

test('persists a checkpoint only after a successful poll', async () => {
  let savedState;
  const stateStore = {
    async load() { return null; },
    async save(state) { savedState = state; },
  };
  const client = {
    im: { v1: { message: { list: async () => ({
      code: 0,
      data: {
        has_more: false,
        items: [{ message_id: 'om_release', create_time: String(fixedNow) }],
      },
    }) } } },
  };

  const result = await pollFeishuHistoryOnce({
    client,
    chatId: 'oc_release',
    stateStore,
    now: () => fixedNow,
  });

  assert.equal(result.messages.length, 1);
  assert.equal(savedState.chatId, 'oc_release');
  assert.equal(savedState.lastSuccessfulPollAt, '2026-07-23T05:00:00.000Z');
  assert.equal(savedState.lastMessageCount, 1);
});

test('does not advance the checkpoint when Feishu rejects the history request', async () => {
  let saved = false;
  const stateStore = {
    async load() { return null; },
    async save() { saved = true; },
  };
  const client = {
    im: { v1: { message: { list: async () => ({
      code: 230027,
      msg: 'Lack of necessary permissions',
    }) } } },
  };

  await assert.rejects(
    pollFeishuHistoryOnce({
      client,
      chatId: 'oc_release',
      stateStore,
      now: () => fixedNow,
    }),
    /230027/,
  );
  assert.equal(saved, false);
});

test('does not advance the checkpoint when message handling fails', async () => {
  let saved = false;
  const stateStore = {
    async load() { return null; },
    async save() { saved = true; },
  };
  const client = {
    im: { v1: { message: { list: async () => ({
      code: 0,
      data: {
        has_more: false,
        items: [{ message_id: 'om_release', create_time: String(fixedNow) }],
      },
    }) } } },
  };

  await assert.rejects(
    pollFeishuHistoryOnce({
      client,
      chatId: 'oc_release',
      stateStore,
      now: () => fixedNow,
      handleMessages: async () => { throw new Error('candidate handling failed'); },
    }),
    /candidate handling failed/u,
  );
  assert.equal(saved, false);
});

test('file state store survives a process restart', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'am-feishu-history-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'state.json');
  const first = new FileHistoryPollStateStore(filePath);
  const expected = {
    schemaVersion: '1.0',
    chatId: 'oc_release',
    lastSuccessfulPollAt: '2026-07-23T05:00:00.000Z',
  };

  await first.save(expected);

  const restarted = new FileHistoryPollStateStore(filePath);
  assert.deepEqual(await restarted.load(), expected);
});
