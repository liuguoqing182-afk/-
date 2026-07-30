import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  dispatchUniqueMessages,
  FileMessageIdDeduplicator,
} from '../src/feishu-message-id-deduplicator.mjs';

async function temporaryState(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'am-message-ids-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'message-ids.json');
}

test('deduplicates the same message ID in one batch and after restart', async (context) => {
  const filePath = await temporaryState(context);
  const firstProcess = new FileMessageIdDeduplicator(filePath, {
    chatId: 'oc_release',
  });
  const handled = [];
  const firstResult = await dispatchUniqueMessages({
    messages: [
      { messageId: 'om_1' },
      { messageId: 'om_1' },
      { messageId: 'om_2' },
    ],
    deduplicator: firstProcess,
    handleMessage: async ({ messageId }) => handled.push(messageId),
  });

  assert.deepEqual(handled, ['om_1', 'om_2']);
  assert.deepEqual(
    firstResult.duplicates.map(({ messageId }) => messageId),
    ['om_1'],
  );

  const restarted = new FileMessageIdDeduplicator(filePath, {
    chatId: 'oc_release',
  });
  const restartResult = await dispatchUniqueMessages({
    messages: [{ messageId: 'om_1' }, { messageId: 'om_3' }],
    deduplicator: restarted,
    handleMessage: async ({ messageId }) => handled.push(messageId),
  });

  assert.deepEqual(handled, ['om_1', 'om_2', 'om_3']);
  assert.deepEqual(
    restartResult.duplicates.map(({ messageId }) => messageId),
    ['om_1'],
  );
});

test('does not mark a message ID when candidate handling fails', async (context) => {
  const filePath = await temporaryState(context);
  const deduplicator = new FileMessageIdDeduplicator(filePath, {
    chatId: 'oc_release',
  });

  await assert.rejects(
    dispatchUniqueMessages({
      messages: [{ messageId: 'om_retry' }],
      deduplicator,
      handleMessage: async () => { throw new Error('inspection queue unavailable'); },
    }),
    /queue unavailable/u,
  );
  assert.equal(await deduplicator.has('om_retry'), false);
});

test('keeps only the configured number of recent processed IDs', async (context) => {
  const filePath = await temporaryState(context);
  const deduplicator = new FileMessageIdDeduplicator(filePath, {
    chatId: 'oc_release',
    limit: 2,
  });

  await deduplicator.markProcessed('om_1');
  await deduplicator.markProcessed('om_2');
  await deduplicator.markProcessed('om_3');

  assert.equal(await deduplicator.has('om_1'), false);
  assert.equal(await deduplicator.has('om_2'), true);
  assert.equal(await deduplicator.has('om_3'), true);
});

test('skips malformed candidates without a message ID', async (context) => {
  const filePath = await temporaryState(context);
  const deduplicator = new FileMessageIdDeduplicator(filePath, {
    chatId: 'oc_release',
  });
  const result = await dispatchUniqueMessages({
    messages: [{ messageId: null }],
    deduplicator,
    handleMessage: async () => assert.fail('handler must not run'),
  });

  assert.equal(result.missingMessageId.length, 1);
  assert.equal(result.processed.length, 0);
});
