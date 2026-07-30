import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PersistentWebhookQueue } from '../src/persistent-webhook-queue.mjs';
import {
  createWebhookSignature,
  verifyWebhookSignature,
} from '../src/webhook-auth.mjs';
import {
  PUBLISHED_EVENT_TYPE,
  normalizePublishedWebhookEvent,
  WebhookEventValidationError,
} from '../src/webhook-event.mjs';
import {
  createWebhookServer,
  PUBLISHED_WEBHOOK_PATH,
} from '../src/webhook-server.mjs';

const secret = 'test-webhook-secret-with-at-least-32-bytes';
const fixedNow = Date.parse('2026-07-21T11:00:00.000Z');
const fixedTimestamp = String(Math.floor(fixedNow / 1000));

function event(overrides = {}) {
  return {
    event_type: PUBLISHED_EVENT_TYPE,
    event_id: 'evt-20260721-00000001',
    release_id: 'AM-20260721-001',
    published_at: '2026-07-21T19:00:00+08:00',
    operator: 'wuzhenzhen@riverolls.com',
    source_environment: 'DEV',
    target_environment: 'PRO',
    status: 'success',
    notification_text:
      'AIMirror首屏配置发布成功!\n操作人: wuzhenzhen@riverolls.com\n发布环境: 从DEV发布到PRO',
    ...overrides,
  };
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'am-webhook-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function request(port, { body, signature, timestamp = fixedTimestamp, deliveryId }) {
  return new Promise((resolve, reject) => {
    const rawBody = Buffer.from(body, 'utf8');
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      path: PUBLISHED_WEBHOOK_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': rawBody.length,
        'X-AM-Timestamp': timestamp,
        'X-AM-Delivery-ID': deliveryId,
        'X-AM-Signature': signature,
      },
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => {
        resolve({
          statusCode: incoming.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(rawBody);
  });
}

test('signs raw webhook payloads and rejects tampering or expired timestamps', () => {
  const rawBody = JSON.stringify(event());
  const deliveryId = event().event_id;
  const signature = createWebhookSignature({
    secret,
    timestamp: fixedTimestamp,
    deliveryId,
    rawBody,
  });
  assert.equal(signature.length, 64);
  assert.deepEqual(verifyWebhookSignature({
    secret,
    timestamp: fixedTimestamp,
    deliveryId,
    signature: 'sha256=' + signature,
    rawBody,
    nowMs: fixedNow,
  }), { valid: true, reason: null });
  assert.equal(verifyWebhookSignature({
    secret,
    timestamp: fixedTimestamp,
    deliveryId,
    signature: 'sha256=' + signature,
    rawBody: rawBody + ' ',
    nowMs: fixedNow,
  }).reason, 'SIGNATURE_MISMATCH');
  assert.equal(verifyWebhookSignature({
    secret,
    timestamp: String(Number(fixedTimestamp) - 301),
    deliveryId,
    signature: 'sha256=' + signature,
    rawBody,
    nowMs: fixedNow,
  }).reason, 'EXPIRED_TIMESTAMP');
});

test('normalizes only successful AIMirror DEV to PRO publication events', () => {
  assert.deepEqual(normalizePublishedWebhookEvent(event()), event());
  assert.throws(
    () => normalizePublishedWebhookEvent(event({ target_environment: 'PRE' })),
    WebhookEventValidationError,
  );
  assert.throws(
    () => normalizePublishedWebhookEvent(event({ notification_text: 'unrelated' })),
    WebhookEventValidationError,
  );
});

test('persists queued jobs and deduplicates them after a restart', async (t) => {
  const dataDir = await temporaryDirectory(t);
  const bodySha256 = 'a'.repeat(64);
  const firstQueue = new PersistentWebhookQueue({ dataDir });
  const initialized = await firstQueue.initialize();
  assert.equal(initialized.persistedJobs, 0);
  await fs.access(initialized.inspectionDataDir);
  const first = await firstQueue.enqueue({
    event: event(),
    deliveryId: event().event_id,
    timestamp: fixedTimestamp,
    bodySha256,
    receivedAt: new Date(fixedNow).toISOString(),
  });
  assert.equal(first.created, true);
  assert.equal((await firstQueue.listQueued()).length, 1);

  const restartedQueue = new PersistentWebhookQueue({ dataDir });
  await restartedQueue.initialize();
  const duplicate = await restartedQueue.enqueue({
    event: event(),
    deliveryId: event().event_id,
    timestamp: fixedTimestamp,
    bodySha256,
    receivedAt: new Date(fixedNow).toISOString(),
  });
  assert.equal(duplicate.duplicate, true);
  const conflict = await restartedQueue.enqueue({
    event: event(),
    deliveryId: event().event_id,
    timestamp: fixedTimestamp,
    bodySha256: 'b'.repeat(64),
    receivedAt: new Date(fixedNow).toISOString(),
  });
  assert.equal(conflict.conflict, true);
});

test('accepts, persists, deduplicates, and authenticates HTTP webhook requests', async (t) => {
  const dataDir = await temporaryDirectory(t);
  const { server, queueInfo } = await createWebhookServer({
    secret,
    dataDir,
    now: () => fixedNow,
    logger: { error() {} },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const payload = event();
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + createWebhookSignature({
    secret,
    timestamp: fixedTimestamp,
    deliveryId: payload.event_id,
    rawBody: body,
  });

  const accepted = await request(port, {
    body,
    signature,
    deliveryId: payload.event_id,
  });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.body.accepted, true);
  assert.equal(accepted.body.duplicate, false);
  assert.equal(accepted.body.status, 'queued');

  const duplicate = await request(port, {
    body,
    signature,
    deliveryId: payload.event_id,
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.duplicate, true);

  const rejected = await request(port, {
    body,
    signature: 'sha256=' + '0'.repeat(64),
    deliveryId: payload.event_id,
  });
  assert.equal(rejected.statusCode, 401);
  assert.equal(rejected.body.error, 'invalid_webhook_signature');

  const jobFiles = await fs.readdir(queueInfo.jobsDir);
  assert.equal(jobFiles.filter((name) => name.endsWith('.json')).length, 1);
});

