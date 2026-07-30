import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PersistentWebhookQueue } from '../src/persistent-webhook-queue.mjs';
import { WebhookInspectionWorker } from '../src/webhook-inspection-worker.mjs';

const fixedNow = Date.parse('2026-07-22T04:00:00.000Z');

function event() {
  return {
    event_type: 'am.home_config.published.v1',
    event_id: 'evt-20260722-worker-0001',
    release_id: 'AM-20260722-worker-0001',
    published_at: '2026-07-22T12:00:00+08:00',
    operator: 'wuzhenzhen@riverolls.com',
    source_environment: 'DEV',
    target_environment: 'PRO',
    status: 'success',
    notification_text:
      'AIMirror首屏配置发布成功!\n操作人: wuzhenzhen@riverolls.com\n发布环境: 从DEV发布到PRO',
  };
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'am-worker-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function queuedJob(t) {
  const queue = new PersistentWebhookQueue({ dataDir: await temporaryDirectory(t) });
  await queue.enqueue({
    event: event(),
    deliveryId: event().event_id,
    timestamp: String(Math.floor(fixedNow / 1000)),
    bodySha256: 'a'.repeat(64),
    receivedAt: new Date(fixedNow).toISOString(),
  });
  return queue;
}

function workerOptions(queue, overrides = {}) {
  return {
    queue,
    monitor: {
      async initialize() {},
      async inspect() {
        return { result: { status: 'PASSED' }, reportDir: 'report-dir' };
      },
    },
    async sendText() {},
    chatId: 'oc_test_chat',
    renderSummary: () => 'AIMirror 首屏配置巡检：通过',
    settleMs: 0,
    pollIntervalMs: 10,
    retryBaseMs: 1000,
    now: () => fixedNow,
    logger: { log() {}, error() {} },
    ...overrides,
  };
}

test('inspects a queued event, sends one report, and does not repeat duplicates', async (t) => {
  const queue = await queuedJob(t);
  const inspections = [];
  const reports = [];
  const worker = new WebhookInspectionWorker(workerOptions(queue, {
    monitor: {
      async initialize() {},
      async inspect(text, metadata) {
        inspections.push({ text, metadata });
        return { result: { status: 'PASSED' }, reportDir: 'report-dir' };
      },
    },
    async sendText(chatId, text) {
      reports.push({ chatId, text });
    },
  }));

  assert.equal(await worker.runOnce(), 1);
  const completed = await queue.get(event().event_id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.attempts, 1);
  assert.equal(completed.reportAttempts, 1);
  assert.equal(inspections.length, 1);
  assert.equal(inspections[0].metadata.messageId, event().event_id);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].chatId, 'oc_test_chat');
  assert.match(reports[0].text, /主动 Webhook 巡检/);
  assert.match(reports[0].text, new RegExp(event().event_id));

  const duplicate = await queue.enqueue({
    event: event(),
    deliveryId: event().event_id,
    timestamp: String(Math.floor(fixedNow / 1000)),
    bodySha256: 'a'.repeat(64),
    receivedAt: new Date(fixedNow).toISOString(),
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(await worker.runOnce(), 0);
  assert.equal(inspections.length, 1);
  assert.equal(reports.length, 1);
});

test('retries inspection without sending an early report', async (t) => {
  const queue = await queuedJob(t);
  let now = fixedNow;
  let inspections = 0;
  let reports = 0;
  const worker = new WebhookInspectionWorker(workerOptions(queue, {
    now: () => now,
    monitor: {
      async initialize() {},
      async inspect() {
        inspections += 1;
        if (inspections === 1) throw new Error('temporary config API failure');
        return { result: { status: 'PASSED' }, reportDir: 'retry-report' };
      },
    },
    async sendText() {
      reports += 1;
    },
  }));

  await worker.runOnce();
  assert.equal((await queue.get(event().event_id)).status, 'INSPECTION_RETRY');
  assert.equal(reports, 0);
  now += 999;
  assert.equal(await worker.runOnce(), 0);
  now += 1;
  await worker.runOnce();
  assert.equal((await queue.get(event().event_id)).status, 'COMPLETED');
  assert.equal(inspections, 2);
  assert.equal(reports, 1);
});

test('retries only Feishu delivery after inspection has succeeded', async (t) => {
  const queue = await queuedJob(t);
  let now = fixedNow;
  let inspections = 0;
  let reportAttempts = 0;
  const worker = new WebhookInspectionWorker(workerOptions(queue, {
    now: () => now,
    monitor: {
      async initialize() {},
      async inspect() {
        inspections += 1;
        return { result: { status: 'PASSED' }, reportDir: 'stable-report' };
      },
    },
    async sendText() {
      reportAttempts += 1;
      if (reportAttempts === 1) throw new Error('temporary Feishu failure');
    },
  }));

  await worker.runOnce();
  assert.equal((await queue.get(event().event_id)).status, 'REPORT_RETRY');
  now += 1000;
  await worker.runOnce();
  const completed = await queue.get(event().event_id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(inspections, 1);
  assert.equal(reportAttempts, 2);
});

test('waits until ten minutes after publication before active inspection', async (t) => {
  const queue = await queuedJob(t);
  const waits = [];
  let inspections = 0;
  const worker = new WebhookInspectionWorker(workerOptions(queue, {
    settleMs: 600_000,
    async sleep(milliseconds) {
      waits.push(milliseconds);
    },
    monitor: {
      async initialize() {},
      async inspect() {
        inspections += 1;
        return { result: { status: 'PASSED' }, reportDir: 'delayed-report' };
      },
    },
  }));

  await worker.runOnce();
  assert.deepEqual(waits, [600_000]);
  assert.equal(inspections, 1);
  assert.equal((await queue.get(event().event_id)).status, 'COMPLETED');
});

test('recovers jobs interrupted during inspection after restart', async (t) => {
  const dataDir = await temporaryDirectory(t);
  const firstQueue = new PersistentWebhookQueue({ dataDir });
  await firstQueue.enqueue({
    event: event(),
    deliveryId: event().event_id,
    timestamp: String(Math.floor(fixedNow / 1000)),
    bodySha256: 'a'.repeat(64),
    receivedAt: new Date(fixedNow).toISOString(),
  });
  await firstQueue.claimInspection(event().event_id, new Date(fixedNow).toISOString());

  const restartedQueue = new PersistentWebhookQueue({ dataDir });
  await restartedQueue.initialize();
  const recovered = await restartedQueue.get(event().event_id);
  assert.equal(recovered.status, 'QUEUED');
  assert.equal(recovered.recoveredAfterRestart, true);
});
