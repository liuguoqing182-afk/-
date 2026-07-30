import assert from 'node:assert/strict';
import test from 'node:test';

import { FeishuHistoryInspectionRunner } from '../src/feishu-history-inspection-runner.mjs';

const notificationText = `AIMirror首屏配置发布成功!
模版修改: 模型Vlog图片改变,
模型Vlog的封面图系列有改动,
模型Vlog有字段改动
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`;

test('parses a history candidate and starts the release monitor inspection', async () => {
  const calls = [];
  const delays = [];
  const monitor = {
    async initialize() {
      calls.push({ type: 'initialize' });
      return { created: false, baselinePath: 'data/pro-baseline.json' };
    },
    async inspect(text, metadata) {
      calls.push({ type: 'inspect', text, metadata });
      return {
        result: { status: 'PASSED', passed: true },
        reportDir: 'data/reports/report-1',
      };
    },
  };
  const runner = new FeishuHistoryInspectionRunner({
    monitor,
    settleMs: 8000,
    now: () => 1_780_000_020_000,
    delay: async (milliseconds) => delays.push(milliseconds),
  });

  const inspection = await runner.inspect({
    messageId: 'om_release',
    chatId: 'oc_release',
    createTime: '1780000015000',
    senderType: 'app',
    senderName: '发布机器人',
    notificationText,
  });

  assert.deepEqual(delays, [3000]);
  assert.deepEqual(calls.map(({ type }) => type), ['initialize', 'inspect']);
  assert.equal(calls[1].metadata.messageId, 'om_release');
  assert.equal(inspection.notification.fullyParsed, true);
  assert.equal(inspection.result.status, 'PASSED');
  assert.equal(inspection.reportDir, 'data/reports/report-1');
});

test('does not start the monitor when the notification is only partially parsed', async () => {
  let initialized = false;
  let inspected = false;
  const runner = new FeishuHistoryInspectionRunner({
    monitor: {
      async initialize() { initialized = true; },
      async inspect() { inspected = true; },
    },
    settleMs: 0,
  });

  await assert.rejects(
    runner.inspect({
      messageId: 'om_bad',
      notificationText: `AIMirror首屏配置发布成功!
未知配置发生改变
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`,
    }),
    /parsing failed.*无法解析/u,
  );
  assert.equal(initialized, false);
  assert.equal(inspected, false);
});

test('propagates monitor failures so the message ID can be retried', async () => {
  const runner = new FeishuHistoryInspectionRunner({
    monitor: {
      async initialize() { return {}; },
      async inspect() { throw new Error('AM config API unavailable'); },
    },
    settleMs: 0,
  });

  await assert.rejects(
    runner.inspect({
      messageId: 'om_retry',
      notificationText,
    }),
    /config API unavailable/u,
  );
});
