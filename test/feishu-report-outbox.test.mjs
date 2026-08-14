import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertTestReportDestination,
  deliverPendingFeishuReports,
  FileFeishuReportOutbox,
  renderTestGroupInspectionReport,
  sendFeishuTextMessage,
} from '../src/feishu-report-outbox.mjs';

async function temporaryOutbox(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'am-report-outbox-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'outbox.json');
}

test('refuses to use the formal release group as the test report destination', () => {
  assert.equal(assertTestReportDestination({
    releaseChatId: 'oc_release',
    testChatId: 'oc_test',
  }), 'oc_test');
  assert.throws(
    () => assertTestReportDestination({
      releaseChatId: 'oc_release',
      testChatId: 'oc_release',
    }),
    /must be different/u,
  );
});

test('renders an explicitly labeled test-group inspection report', () => {
  const text = renderTestGroupInspectionReport(
    { messageId: 'om_release' },
    {
      result: {
        status: 'PASSED',
        passed: true,
        notification: { operator: 'user@riverolls.com' },
        checks: {
          notificationParsed: true,
          baselineAvailable: true,
          declarationConsistent: true,
          resourcesPassed: true,
        },
        devProDiff: { summary: { totalChanges: 0 } },
        proReleaseDiff: { summary: { totalChanges: 1 } },
        notes: {
          unverifiedI18nDeclarations: 0,
          proMissingModelReferences: 0,
        },
      },
    },
  );

  assert.match(text, /^【测试群验证｜AIMirror 首屏配置巡检】/u);
  assert.match(text, /本阶段仅投递测试群/u);
  assert.match(text, /发布消息 ID：om_release/u);
  assert.match(text, /通过 ✅/u);
});

test('persists a report, sends it once, and remembers success after restart', async (context) => {
  const filePath = await temporaryOutbox(context);
  const outbox = new FileFeishuReportOutbox(filePath, { now: () => 1000 });
  await outbox.enqueue({
    messageId: 'om_1',
    receiveId: 'oc_test',
    text: 'report 1',
  });
  const sent = [];
  const firstDelivery = await deliverPendingFeishuReports({
    outbox,
    allowedReceiveId: 'oc_test',
    sendText: async (receiveId, text) => sent.push({ receiveId, text }),
  });

  assert.deepEqual(firstDelivery.sent, ['om_1']);
  assert.deepEqual(sent, [{ receiveId: 'oc_test', text: 'report 1' }]);

  const restarted = new FileFeishuReportOutbox(filePath, { now: () => 2000 });
  const secondDelivery = await deliverPendingFeishuReports({
    outbox: restarted,
    allowedReceiveId: 'oc_test',
    sendText: async () => assert.fail('sent report must not be repeated'),
  });
  assert.deepEqual(secondDelivery, { sent: [], failed: [] });
  assert.equal((await restarted.get('om_1')).status, 'SENT');
});

test('keeps a failed report pending and retries only delivery', async (context) => {
  const filePath = await temporaryOutbox(context);
  const outbox = new FileFeishuReportOutbox(filePath, { now: () => 1000 });
  await outbox.enqueue({
    messageId: 'om_retry',
    receiveId: 'oc_test',
    text: 'retry report',
  });

  const failed = await deliverPendingFeishuReports({
    outbox,
    allowedReceiveId: 'oc_test',
    sendText: async () => { throw new Error('Feishu unavailable'); },
  });
  assert.equal(failed.failed.length, 1);
  assert.equal((await outbox.get('om_retry')).status, 'PENDING');
  assert.equal((await outbox.get('om_retry')).attempts, 1);

  const sent = [];
  const retried = await deliverPendingFeishuReports({
    outbox,
    allowedReceiveId: 'oc_test',
    sendText: async (receiveId, text) => sent.push({ receiveId, text }),
  });
  assert.deepEqual(retried.sent, ['om_retry']);
  assert.equal((await outbox.get('om_retry')).status, 'SENT');
  assert.deepEqual(sent, [{ receiveId: 'oc_test', text: 'retry report' }]);
});

test('sends text through the Feishu bot API to the supplied chat only', async () => {
  const calls = [];
  const client = {
    im: { v1: { message: { create: async (payload) => {
      calls.push(payload);
      return { code: 0, data: { message_id: 'om_report' } };
    } } } },
  };

  await sendFeishuTextMessage({
    client,
    receiveId: 'oc_test',
    allowedReceiveId: 'oc_test',
    text: 'inspection report',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.receive_id_type, 'chat_id');
  assert.equal(calls[0].data.receive_id, 'oc_test');
  assert.deepEqual(JSON.parse(calls[0].data.content), {
    text: 'inspection report',
  });
});

test('refuses a direct text send outside the allowed test chat', async () => {
  let sendCalls = 0;
  const client = {
    im: { v1: { message: { create: async () => {
      sendCalls += 1;
      return { code: 0 };
    } } } },
  };

  await assert.rejects(
    sendFeishuTextMessage({
      client,
      receiveId: 'oc_release',
      allowedReceiveId: 'oc_test',
      text: 'must not send',
    }),
    /refusing to send report outside the allowed test chat/u,
  );
  assert.equal(sendCalls, 0);
});

test('refuses a persisted report that targets anything except the test group', async (context) => {
  const filePath = await temporaryOutbox(context);
  const outbox = new FileFeishuReportOutbox(filePath, { now: () => 1000 });
  await outbox.enqueue({
    messageId: 'om_wrong_chat',
    receiveId: 'oc_release',
    text: 'must not send',
  });
  let sendCalls = 0;

  const delivery = await deliverPendingFeishuReports({
    outbox,
    allowedReceiveId: 'oc_test',
    sendText: async () => { sendCalls += 1; },
  });

  assert.equal(sendCalls, 0);
  assert.equal(delivery.failed.length, 1);
  assert.match(delivery.failed[0].error, /not the allowed test chat/u);
  assert.equal((await outbox.get('om_wrong_chat')).status, 'PENDING');
});
