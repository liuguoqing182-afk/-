// Explicit live integration runner; excluded from node --test discovery.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createWebhookSignature } from '../src/webhook-auth.mjs';

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

const webhookUrl = requiredEnvironment('AM_INSPECTION_WEBHOOK_URL');
const secret = requiredEnvironment('AM_INSPECTION_WEBHOOK_SECRET');
const dataDir = path.resolve(
  process.env.AM_WEBHOOK_DATA_DIR ?? 'data-webhook',
);
const suffix = new Date().toISOString().replace(/\D/g, '').slice(0, 14) +
  '-' + crypto.randomBytes(4).toString('hex');
const eventId = 'evt-integration-' + suffix;
const badEventId = 'evt-bad-signature-' + suffix;

function event(id) {
  return {
    event_type: 'am.home_config.published.v1',
    event_id: id,
    release_id: 'AM-integration-' + suffix,
    published_at: new Date().toISOString(),
    operator: 'wuzhenzhen@riverolls.com',
    source_environment: 'DEV',
    target_environment: 'PRO',
    status: 'success',
    notification_text: [
      'AIMirror首屏配置发布成功!',
      '操作人: wuzhenzhen@riverolls.com',
      '发布环境: 从DEV发布到PRO',
    ].join('\n'),
    sections: {
      操作人: 'wuzhenzhen@riverolls.com',
      发布环境: '从DEV发布到PRO',
    },
  };
}

async function deliver(payload, signatureOverride) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signatureOverride ?? 'sha256=' + createWebhookSignature({
    secret,
    timestamp,
    deliveryId: payload.event_id,
    rawBody,
  });
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AM-Timestamp': timestamp,
      'X-AM-Delivery-ID': payload.event_id,
      'X-AM-Signature': signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(20_000),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function jobPath(id) {
  const name = crypto.createHash('sha256').update(id, 'utf8').digest('hex');
  return path.join(dataDir, 'queue', 'jobs', name + '.json');
}

async function waitForTerminalJob(id) {
  const filePath = jobPath(id);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const job = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return job;
    await delay(2000);
  }
  throw new Error('Timed out waiting for webhook job ' + id);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const payload = event(eventId);
const first = await deliver(payload);
const duplicate = await deliver(payload);
const badSignature = await deliver(
  event(badEventId),
  'sha256=' + '0'.repeat(64),
);
if (first.status !== 202) throw new Error('first delivery did not return 202');
if (duplicate.status !== 200 || duplicate.body.duplicate !== true) {
  throw new Error('duplicate delivery was not deduplicated');
}
if (badSignature.status !== 401) throw new Error('bad signature was not rejected');

const job = await waitForTerminalJob(eventId);
const badSignaturePersisted = await exists(jobPath(badEventId));
if (badSignaturePersisted) throw new Error('bad signature event was persisted');

console.log(JSON.stringify({
  eventId,
  firstHttp: first.status,
  duplicateHttp: duplicate.status,
  duplicate: duplicate.body.duplicate,
  badSignatureHttp: badSignature.status,
  badSignaturePersisted,
  finalStatus: job.status,
  inspectionAttempts: job.attempts,
  reportAttempts: job.reportAttempts,
  feishuMessageId: job.reportDelivery?.messageId ?? null,
  reportDir: job.inspection?.reportDir ?? null,
  reportContainsPassed: job.inspection?.reportText?.includes('通过') ?? false,
}, null, 2));
