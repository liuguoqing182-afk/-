import { setTimeout as delay } from 'node:timers/promises';

import * as Lark from '@larksuiteoapi/node-sdk';

import { renderFeishuInspectionSummary } from './release-inspector.mjs';

function nonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(name + ' must be a non-negative number');
  }
  return number;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(name + ' must be a positive integer');
  }
  return number;
}

function errorMessage(error) {
  return String(error?.message ?? error ?? 'unknown error');
}

function retryAt(nowMs, baseDelayMs, attempt) {
  return new Date(nowMs + baseDelayMs * (2 ** Math.max(0, attempt - 1))).toISOString();
}

function reportHeader(event) {
  return [
    '【主动 Webhook 巡检】',
    '事件 ID：' + event.event_id,
    '发布 ID：' + event.release_id,
    '操作人：' + event.operator,
    '发布方向：' + event.source_environment + ' → ' + event.target_environment,
    '',
  ].join('\n');
}

export function createFeishuTextSender({ appId, appSecret }) {
  const client = new Lark.Client({ appId, appSecret });
  return async (chatId, text) => {
    const response = await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
    return { messageId: response?.data?.message_id ?? null };
  };
}

export class WebhookInspectionWorker {
  constructor(options = {}) {
    if (!options.queue) throw new Error('queue is required');
    if (!options.monitor) throw new Error('monitor is required');
    if (typeof options.sendText !== 'function') throw new Error('sendText is required');
    this.chatId = String(options.chatId ?? '').trim();
    if (!this.chatId) throw new Error('chatId is required');
    this.queue = options.queue;
    this.monitor = options.monitor;
    this.sendText = options.sendText;
    this.renderSummary = options.renderSummary ?? renderFeishuInspectionSummary;
    this.logger = options.logger ?? console;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
    this.settleMs = nonNegativeNumber(options.settleMs ?? 600_000, 'settleMs');
    this.pollIntervalMs = positiveInteger(
      options.pollIntervalMs ?? 1000,
      'pollIntervalMs',
    );
    this.maxInspectionAttempts = positiveInteger(
      options.maxInspectionAttempts ?? 3,
      'maxInspectionAttempts',
    );
    this.maxReportAttempts = positiveInteger(
      options.maxReportAttempts ?? 5,
      'maxReportAttempts',
    );
    this.retryBaseMs = positiveInteger(options.retryBaseMs ?? 1000, 'retryBaseMs');
    this.ready = null;
    this.inFlight = null;
    this.timer = null;
  }

  async initialize() {
    if (!this.ready) {
      this.ready = Promise.all([
        this.queue.initialize(),
        this.monitor.initialize(),
      ]);
    }
    await this.ready;
  }

  async runOnce() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.#drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async start() {
    await this.initialize();
    await this.runOnce();
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.runOnce().catch((error) => {
          this.logger.error('[webhook:worker] poll failed:', errorMessage(error));
        });
      }, this.pollIntervalMs);
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight;
  }

  async #drain() {
    await this.initialize();
    const jobs = await this.queue.listProcessable(this.now());
    for (const job of jobs) {
      await this.#process(job);
    }
    return jobs.length;
  }

  async #process(job) {
    if (job.status === 'REPORT_PENDING' || job.status === 'REPORT_RETRY') {
      await this.#deliverReport(job);
      return;
    }

    const attemptStartedAt = new Date(this.now()).toISOString();
    const claimed = await this.queue.claimInspection(
      job.event.event_id,
      attemptStartedAt,
    );
    try {
      const publishedAtMs = Date.parse(claimed.event.published_at);
      const remainingSettleMs = Math.max(
        0,
        publishedAtMs + this.settleMs - this.now(),
      );
      if (remainingSettleMs > 0) await this.sleep(remainingSettleMs);
      const { result, reportDir } = await this.monitor.inspect(
        claimed.event.notification_text,
        { messageId: claimed.event.event_id },
      );
      const reportText = reportHeader(claimed.event) + this.renderSummary(result);
      const pending = await this.queue.markReportPending(claimed.event.event_id, {
        reportDir,
        reportText,
        now: new Date(this.now()).toISOString(),
      });
      await this.#deliverReport(pending);
    } catch (error) {
      const message = errorMessage(error);
      if (claimed.attempts < this.maxInspectionAttempts) {
        await this.queue.markInspectionRetry(claimed.event.event_id, {
          error: message,
          nextAttemptAt: retryAt(
            this.now(),
            this.retryBaseMs,
            claimed.attempts,
          ),
          now: new Date(this.now()).toISOString(),
        });
        this.logger.error(
          '[webhook:worker] inspection retry scheduled:',
          claimed.event.event_id,
          message,
        );
        return;
      }
      const pending = await this.queue.markReportPending(claimed.event.event_id, {
        reportText:
          reportHeader(claimed.event) +
          'AIMirror 首屏配置巡检执行失败 ❌\n原因：' + message,
        inspectionFailed: true,
        inspectionError: message,
        now: new Date(this.now()).toISOString(),
      });
      await this.#deliverReport(pending);
    }
  }

  async #deliverReport(job) {
    const claimed = await this.queue.claimReport(
      job.event.event_id,
      new Date(this.now()).toISOString(),
    );
    try {
      const delivery = await this.sendText(
        this.chatId,
        claimed.inspection.reportText,
      );
      await this.queue.markReportDelivered(claimed.event.event_id, {
        messageId: delivery?.messageId ?? null,
        now: new Date(this.now()).toISOString(),
      });
      this.logger.log(
        '[webhook:worker] report delivered:',
        claimed.event.event_id,
        claimed.inspection.reportDir,
      );
    } catch (error) {
      const message = errorMessage(error);
      if (claimed.reportAttempts < this.maxReportAttempts) {
        await this.queue.markReportRetry(claimed.event.event_id, {
          error: message,
          nextAttemptAt: retryAt(
            this.now(),
            this.retryBaseMs,
            claimed.reportAttempts,
          ),
          now: new Date(this.now()).toISOString(),
        });
        this.logger.error(
          '[webhook:worker] report retry scheduled:',
          claimed.event.event_id,
          message,
        );
        return;
      }
      await this.queue.markFailed(claimed.event.event_id, {
        phase: 'report',
        error: message,
        now: new Date(this.now()).toISOString(),
      });
      this.logger.error(
        '[webhook:worker] report delivery failed permanently:',
        claimed.event.event_id,
        message,
      );
    }
  }
}
