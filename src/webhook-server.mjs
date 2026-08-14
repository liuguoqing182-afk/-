import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PersistentWebhookQueue } from './persistent-webhook-queue.mjs';
import { ReleaseMonitor } from './release-monitor.mjs';
import { verifyWebhookSignature } from './webhook-auth.mjs';
import {
  normalizePublishedWebhookEvent,
  WebhookEventValidationError,
} from './webhook-event.mjs';
import {
  createFeishuTextSender,
  WebhookInspectionWorker,
} from './webhook-inspection-worker.mjs';

export const PUBLISHED_WEBHOOK_PATH =
  '/api/v1/webhooks/home-config-published';

class HttpRequestError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sendJson(response, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

async function readRawBody(request, maximumBytes) {
  let totalBytes = 0;
  let tooLarge = false;
  const chunks = [];
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maximumBytes) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  }
  if (tooLarge) {
    throw new HttpRequestError(413, 'payload_too_large', 'request body is too large');
  }
  return Buffer.concat(chunks);
}

function requireStrongSecret(secret) {
  const value = String(secret ?? '');
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('AM_WEBHOOK_SECRET must contain at least 32 bytes');
  }
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(name + ' must be a positive integer');
  }
  return number;
}

function nonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(name + ' must be a non-negative number');
  }
  return number;
}

export async function createWebhookServer(options = {}) {
  const secret = requireStrongSecret(options.secret);
  const maximumBodyBytes = positiveInteger(
    options.maximumBodyBytes ?? 1024 * 1024,
    'maximumBodyBytes',
  );
  const maximumSkewSeconds = nonNegativeNumber(
    options.maximumSkewSeconds ?? 300,
    'maximumSkewSeconds',
  );
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const queue = options.queue ?? new PersistentWebhookQueue({
    dataDir: options.dataDir ?? 'data-webhook',
  });
  const queueInfo = await queue.initialize();

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'am-config-inspector-webhook',
      });
      return;
    }
    if (request.method !== 'POST' ||
        requestUrl.pathname !== PUBLISHED_WEBHOOK_PATH) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }

    try {
      const contentType = String(request.headers['content-type'] ?? '')
        .toLowerCase();
      if (!contentType.startsWith('application/json')) {
        throw new HttpRequestError(
          415,
          'unsupported_media_type',
          'Content-Type must be application/json',
        );
      }
      const rawBody = await readRawBody(request, maximumBodyBytes);
      const timestamp = request.headers['x-am-timestamp'];
      const deliveryId = request.headers['x-am-delivery-id'];
      const signature = request.headers['x-am-signature'];
      const authentication = verifyWebhookSignature({
        secret,
        timestamp,
        deliveryId,
        signature,
        rawBody,
        nowMs: now(),
        maxSkewSeconds: maximumSkewSeconds,
      });
      if (!authentication.valid) {
        throw new HttpRequestError(
          401,
          'invalid_webhook_signature',
          'webhook authentication failed',
        );
      }

      let parsedBody;
      try {
        parsedBody = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new HttpRequestError(400, 'invalid_json', 'request body is not valid JSON');
      }
      let event;
      try {
        event = normalizePublishedWebhookEvent(parsedBody);
      } catch (error) {
        if (!(error instanceof WebhookEventValidationError)) throw error;
        throw new HttpRequestError(400, 'invalid_event', error.message);
      }
      if (deliveryId !== event.event_id) {
        throw new HttpRequestError(
          400,
          'delivery_event_mismatch',
          'X-AM-Delivery-ID must match event_id',
        );
      }
      const bodySha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
      const queued = await queue.enqueue({
        event,
        deliveryId,
        timestamp,
        bodySha256,
        receivedAt: new Date(now()).toISOString(),
      });
      if (queued.conflict) {
        throw new HttpRequestError(
          409,
          'event_id_conflict',
          'event_id was already used with different content',
        );
      }
      if (queued.duplicate) {
        sendJson(response, 200, {
          accepted: true,
          duplicate: true,
          event_id: event.event_id,
          job_id: queued.job.jobId,
          status: queued.job.status.toLowerCase(),
        });
        return;
      }
      sendJson(response, 202, {
        accepted: true,
        duplicate: false,
        event_id: event.event_id,
        job_id: queued.job.jobId,
        status: queued.job.status.toLowerCase(),
      });
    } catch (error) {
      if (error instanceof HttpRequestError) {
        sendJson(response, error.statusCode, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      logger.error('[webhook] request failed:', error?.message ?? error);
      sendJson(response, 503, {
        error: 'queue_unavailable',
        message: 'webhook event could not be persisted',
      });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 12_000;
  return { server, queue, queueInfo };
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}

function environmentFlag(name, defaultValue) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(name + ' must be true or false');
}

export async function startWebhookServerFromEnvironment() {
  const host = String(process.env.AM_WEBHOOK_HOST ?? '127.0.0.1').trim();
  const port = positiveInteger(process.env.AM_WEBHOOK_PORT ?? 8787, 'AM_WEBHOOK_PORT');
  const dataDir = path.resolve(
    process.env.AM_WEBHOOK_DATA_DIR ?? 'data-webhook',
  );
  const { server, queue, queueInfo } = await createWebhookServer({
    secret: requiredEnvironment('AM_WEBHOOK_SECRET'),
    dataDir,
    maximumBodyBytes: process.env.AM_WEBHOOK_MAX_BODY_BYTES ?? 1024 * 1024,
    maximumSkewSeconds: process.env.AM_WEBHOOK_MAX_SKEW_SECONDS ?? 300,
  });
  const workerEnabled = environmentFlag('AM_WEBHOOK_WORKER_ENABLED', true);
  const workerSettleMs = process.env.AM_WEBHOOK_SETTLE_MS ?? 600_000;
  let worker = null;
  if (workerEnabled) {
    const appId = requiredEnvironment('FEISHU_APP_ID');
    const appSecret = requiredEnvironment('FEISHU_APP_SECRET');
    const formalChatId = requiredEnvironment('FEISHU_CHAT_ID');
    const chatId = String(
      process.env.AM_WEBHOOK_FEISHU_CHAT_ID ??
      requiredEnvironment('FEISHU_TEST_CHAT_ID'),
    ).trim();
    if (chatId === formalChatId) {
      throw new Error(
        'Webhook text reports cannot target the formal group; only the approved APP screenshot report is allowed',
      );
    }
    worker = new WebhookInspectionWorker({
      queue,
      monitor: new ReleaseMonitor({
        uid: requiredEnvironment('AM_INSPECT_UID'),
        dataDir: queueInfo.inspectionDataDir,
      }),
      sendText: createFeishuTextSender({ appId, appSecret, formalChatId }),
      chatId,
      settleMs: workerSettleMs,
      pollIntervalMs: process.env.AM_WEBHOOK_POLL_INTERVAL_MS ?? 1000,
      maxInspectionAttempts: process.env.AM_WEBHOOK_INSPECTION_ATTEMPTS ?? 3,
      maxReportAttempts: process.env.AM_WEBHOOK_REPORT_ATTEMPTS ?? 5,
      retryBaseMs: process.env.AM_WEBHOOK_RETRY_BASE_MS ?? 1000,
    });
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    if (worker) await worker.start();
  } catch (error) {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    throw error;
  }
  console.log('[webhook] listening on http://' + host + ':' + port);
  console.log('[webhook] endpoint:', PUBLISHED_WEBHOOK_PATH);
  console.log('[webhook] queue:', queueInfo.jobsDir);
  console.log('[webhook] inspection data:', queueInfo.inspectionDataDir);
  console.log('[webhook] worker:', worker ? 'enabled' : 'disabled');
  if (worker) console.log('[webhook] publication settle ms:', Number(workerSettleMs));

  const shutdown = async (signal) => {
    console.log('[webhook] shutting down after ' + signal);
    if (worker) await worker.stop();
    server.close((error) => {
      if (error) {
        console.error('[webhook] shutdown failed:', error);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  return { server, queue, queueInfo, worker };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  startWebhookServerFromEnvironment().catch((error) => {
    console.error('[webhook] startup failed:', error?.message ?? error);
    process.exitCode = 1;
  });
}
