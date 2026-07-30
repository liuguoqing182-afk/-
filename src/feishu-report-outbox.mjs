import fs from 'node:fs/promises';
import path from 'node:path';

import { renderFeishuInspectionSummary } from './release-inspector.mjs';

export const REPORT_OUTBOX_SCHEMA_VERSION = '1.0';

function requiredString(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(name + ' is required');
  return text;
}

function errorMessage(error) {
  return String(error?.message ?? error ?? 'unknown error');
}

export function assertTestReportDestination(options = {}) {
  const releaseChatId = requiredString(options.releaseChatId, 'releaseChatId');
  const testChatId = requiredString(options.testChatId, 'testChatId');
  if (releaseChatId === testChatId) {
    throw new Error('test report chat must be different from the release chat');
  }
  return testChatId;
}

export function renderTestGroupInspectionReport(candidate, inspection) {
  const messageId = requiredString(candidate?.messageId, 'candidate.messageId');
  if (!inspection?.result) throw new Error('inspection.result is required');
  return [
    '【测试群验证｜AIMirror 首屏配置巡检】',
    '说明：由正式发布群消息触发，本阶段仅投递测试群。',
    '发布消息 ID：' + messageId,
    '',
    renderFeishuInspectionSummary(inspection.result),
  ].join('\n');
}

export class FileFeishuReportOutbox {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.now = options.now ?? Date.now;
    this.reports = null;
  }

  async load() {
    if (this.reports !== null) return;
    let state;
    try {
      state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.reports = [];
        return;
      }
      throw error;
    }
    if (state?.schemaVersion !== REPORT_OUTBOX_SCHEMA_VERSION) {
      throw new Error('unsupported report outbox schema');
    }
    if (!Array.isArray(state.reports)) {
      throw new Error('report outbox contains invalid reports');
    }
    this.reports = state.reports;
  }

  async save(nextReports) {
    const nowIso = new Date(this.now()).toISOString();
    const state = {
      schemaVersion: REPORT_OUTBOX_SCHEMA_VERSION,
      updatedAt: nowIso,
      reports: nextReports,
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = this.filePath + '.tmp-' + process.pid;
    await fs.writeFile(
      temporaryPath,
      JSON.stringify(state, null, 2) + '\n',
      'utf8',
    );
    await fs.rename(temporaryPath, this.filePath);
    this.reports = nextReports;
  }

  async get(messageId) {
    const normalizedId = requiredString(messageId, 'messageId');
    await this.load();
    return this.reports.find((report) => report.messageId === normalizedId) ?? null;
  }

  async enqueue(input = {}) {
    const messageId = requiredString(input.messageId, 'messageId');
    const receiveId = requiredString(input.receiveId, 'receiveId');
    const text = requiredString(input.text, 'text');
    await this.load();
    const existing = this.reports.find((report) => report.messageId === messageId);
    if (existing) {
      if (existing.receiveId !== receiveId) {
        throw new Error('report message ID already belongs to another destination');
      }
      return { created: false, report: existing };
    }

    const nowIso = new Date(this.now()).toISOString();
    const report = {
      messageId,
      receiveId,
      text,
      status: 'PENDING',
      attempts: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastError: null,
      sentAt: null,
    };
    await this.save([...this.reports, report]);
    return { created: true, report };
  }

  async listPending() {
    await this.load();
    return this.reports.filter((report) => report.status === 'PENDING');
  }

  async markSent(messageId) {
    const normalizedId = requiredString(messageId, 'messageId');
    await this.load();
    const nowIso = new Date(this.now()).toISOString();
    let found = false;
    const nextReports = this.reports.map((report) => {
      if (report.messageId !== normalizedId) return report;
      found = true;
      return {
        ...report,
        status: 'SENT',
        attempts: Number(report.attempts ?? 0) + 1,
        updatedAt: nowIso,
        lastError: null,
        sentAt: nowIso,
      };
    });
    if (!found) throw new Error('report not found: ' + normalizedId);
    await this.save(nextReports);
  }

  async markFailed(messageId, error) {
    const normalizedId = requiredString(messageId, 'messageId');
    await this.load();
    const nowIso = new Date(this.now()).toISOString();
    let found = false;
    const nextReports = this.reports.map((report) => {
      if (report.messageId !== normalizedId) return report;
      found = true;
      return {
        ...report,
        status: 'PENDING',
        attempts: Number(report.attempts ?? 0) + 1,
        updatedAt: nowIso,
        lastError: errorMessage(error),
      };
    });
    if (!found) throw new Error('report not found: ' + normalizedId);
    await this.save(nextReports);
  }
}

export async function sendFeishuTextMessage(options = {}) {
  if (typeof options.client?.im?.v1?.message?.create !== 'function') {
    throw new TypeError('client.im.v1.message.create is required');
  }
  const receiveId = requiredString(options.receiveId, 'receiveId');
  const allowedReceiveId = requiredString(
    options.allowedReceiveId,
    'allowedReceiveId',
  );
  if (receiveId !== allowedReceiveId) {
    throw new Error('refusing to send report outside the allowed test chat');
  }
  const text = requiredString(options.text, 'text');
  const response = await options.client.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
  if (Number(response?.code ?? 0) !== 0) {
    throw new Error(
      'Feishu message send failed, code=' + response.code +
        ', msg=' + (response.msg ?? ''),
    );
  }
  return response;
}

export async function deliverPendingFeishuReports(options = {}) {
  if (typeof options.outbox?.listPending !== 'function') {
    throw new TypeError('outbox is required');
  }
  if (typeof options.sendText !== 'function') {
    throw new TypeError('sendText is required');
  }
  const allowedReceiveId = requiredString(
    options.allowedReceiveId,
    'allowedReceiveId',
  );
  const sent = [];
  const failed = [];
  for (const report of await options.outbox.listPending()) {
    try {
      if (report.receiveId !== allowedReceiveId) {
        throw new Error('report destination is not the allowed test chat');
      }
      await options.sendText(report.receiveId, report.text);
      await options.outbox.markSent(report.messageId);
      sent.push(report.messageId);
    } catch (error) {
      await options.outbox.markFailed(report.messageId, error);
      failed.push({ messageId: report.messageId, error: errorMessage(error) });
    }
  }
  return { sent, failed };
}
