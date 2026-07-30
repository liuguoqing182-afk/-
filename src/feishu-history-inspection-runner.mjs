import { setTimeout as delay } from 'node:timers/promises';

import { parseNotification } from './notification-parser.mjs';

function nonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(name + ' must be a non-negative number');
  }
  return number;
}

function feishuCreateTimeMilliseconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number < 1_000_000_000_000 ? number * 1000 : number;
}

function parseCandidateNotification(candidate) {
  const notificationText = String(candidate?.notificationText ?? '').trim();
  if (!notificationText) throw new Error('publish candidate notificationText is required');
  const notification = parseNotification(notificationText);
  if (!notification.valid || !notification.fullyParsed) {
    const issues = [
      ...(notification.errors ?? []),
      ...(notification.unparsedLines ?? []).map((line) => '无法解析：' + line),
    ];
    throw new Error('publish notification parsing failed: ' + issues.join('; '));
  }
  return { notificationText, notification };
}

export class FeishuHistoryInspectionRunner {
  constructor(options = {}) {
    if (typeof options.monitor?.initialize !== 'function') {
      throw new TypeError('monitor.initialize is required');
    }
    if (typeof options.monitor?.inspect !== 'function') {
      throw new TypeError('monitor.inspect is required');
    }
    this.monitor = options.monitor;
    this.settleMs = nonNegativeNumber(options.settleMs ?? 8000, 'settleMs');
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? delay;
    this.readyPromise = null;
  }

  initialize() {
    if (!this.readyPromise) {
      this.readyPromise = Promise.resolve()
        .then(() => this.monitor.initialize())
        .catch((error) => {
          this.readyPromise = null;
          throw error;
        });
    }
    return this.readyPromise;
  }

  async inspect(candidate) {
    const messageId = String(candidate?.messageId ?? '').trim();
    if (!messageId) throw new Error('publish candidate messageId is required');
    const { notificationText, notification } = parseCandidateNotification(candidate);

    await this.initialize();
    const createTimeMs = feishuCreateTimeMilliseconds(candidate.createTime);
    const messageAgeMs = createTimeMs === null
      ? 0
      : Math.max(0, nonNegativeNumber(this.now(), 'now') - createTimeMs);
    const remainingSettleMs = Math.max(0, this.settleMs - messageAgeMs);
    if (remainingSettleMs > 0) await this.delay(remainingSettleMs);

    const inspection = await this.monitor.inspect(notificationText, {
      messageId,
      chatId: candidate.chatId ?? null,
      createTime: candidate.createTime ?? null,
      senderType: candidate.senderType ?? null,
      senderName: candidate.senderName ?? null,
    });
    if (!inspection?.result) {
      throw new Error('release monitor returned no inspection result');
    }
    if (inspection.result.status === 'PARSE_FAILED') {
      throw new Error('release monitor rejected a pre-validated notification');
    }
    return {
      notification,
      result: inspection.result,
      reportDir: inspection.reportDir ?? null,
    };
  }
}
