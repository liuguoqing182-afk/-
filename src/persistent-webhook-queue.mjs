import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + '.tmp-' + process.pid + '-' + crypto.randomUUID();
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temporaryPath, filePath);
}

function jobFileName(eventId) {
  return crypto.createHash('sha256').update(eventId, 'utf8').digest('hex') + '.json';
}

export class PersistentWebhookQueue {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir ?? 'data-webhook');
    this.queueDir = path.join(this.dataDir, 'queue');
    this.jobsDir = path.join(this.queueDir, 'jobs');
    this.inspectionDataDir = path.join(this.dataDir, 'inspection');
    this.jobs = new Map();
    this.initialized = false;
    this.operationTail = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return this.describe();
    await Promise.all([
      fs.mkdir(this.jobsDir, { recursive: true }),
      fs.mkdir(this.inspectionDataDir, { recursive: true }),
    ]);
    const entries = await fs.readdir(this.jobsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(this.jobsDir, entry.name);
      const job = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!job?.event?.event_id || !job?.delivery?.bodySha256) {
        throw new Error('invalid persisted webhook job: ' + filePath);
      }
      if (job.status === 'PROCESSING') {
        job.status = 'QUEUED';
        job.updatedAt = new Date().toISOString();
        job.recoveredAfterRestart = true;
        await writeJsonAtomic(filePath, job);
      } else if (job.status === 'REPORTING') {
        job.status = 'REPORT_PENDING';
        job.updatedAt = new Date().toISOString();
        job.recoveredAfterRestart = true;
        await writeJsonAtomic(filePath, job);
      }
      this.jobs.set(job.event.event_id, { filePath, job });
    }
    this.initialized = true;
    return this.describe();
  }

  describe() {
    return {
      dataDir: this.dataDir,
      queueDir: this.queueDir,
      jobsDir: this.jobsDir,
      inspectionDataDir: this.inspectionDataDir,
      persistedJobs: this.jobs.size,
    };
  }

  async enqueue({ event, deliveryId, timestamp, bodySha256, receivedAt }) {
    await this.initialize();
    return this.#exclusive(async () => {
      const existing = this.jobs.get(event.event_id);
      if (existing) {
        return {
          created: false,
          duplicate: existing.job.delivery.bodySha256 === bodySha256,
          conflict: existing.job.delivery.bodySha256 !== bodySha256,
          job: structuredClone(existing.job),
        };
      }
      const now = receivedAt ?? new Date().toISOString();
      const job = {
        schemaVersion: '1.0',
        queueType: 'AM_HOME_CONFIG_WEBHOOK_JOB',
        jobId: 'am-webhook-' + bodySha256.slice(0, 24),
        status: 'QUEUED',
        attempts: 0,
        receivedAt: now,
        updatedAt: now,
        delivery: {
          id: deliveryId,
          timestamp: Number(timestamp),
          bodySha256,
        },
        event,
      };
      const filePath = path.join(this.jobsDir, jobFileName(event.event_id));
      await writeJsonAtomic(filePath, job);
      this.jobs.set(event.event_id, { filePath, job });
      return {
        created: true,
        duplicate: false,
        conflict: false,
        job: structuredClone(job),
      };
    });
  }

  async get(eventId) {
    await this.initialize();
    const entry = this.jobs.get(eventId);
    return entry ? structuredClone(entry.job) : null;
  }

  async listQueued() {
    await this.initialize();
    return [...this.jobs.values()]
      .map(({ job }) => job)
      .filter(({ status }) => status === 'QUEUED')
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .map((job) => structuredClone(job));
  }

  async listProcessable(nowMs = Date.now()) {
    await this.initialize();
    return [...this.jobs.values()]
      .map(({ job }) => job)
      .filter((job) => {
        if (job.status === 'QUEUED' || job.status === 'REPORT_PENDING') return true;
        if (job.status !== 'INSPECTION_RETRY' && job.status !== 'REPORT_RETRY') {
          return false;
        }
        return !job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= nowMs;
      })
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .map((job) => structuredClone(job));
  }

  async claimInspection(eventId, now = new Date().toISOString()) {
    return this.#update(eventId, (job) => {
      if (job.status !== 'QUEUED' && job.status !== 'INSPECTION_RETRY') {
        throw new Error('webhook job is not ready for inspection: ' + job.status);
      }
      job.status = 'PROCESSING';
      job.attempts = Number(job.attempts ?? 0) + 1;
      job.lastAttemptAt = now;
      delete job.nextAttemptAt;
      delete job.lastError;
      return job;
    }, now);
  }

  async markInspectionRetry(eventId, { error, nextAttemptAt, now } = {}) {
    const updatedAt = now ?? new Date().toISOString();
    return this.#update(eventId, (job) => {
      if (job.status !== 'PROCESSING') {
        throw new Error('webhook job is not being inspected: ' + job.status);
      }
      job.status = 'INSPECTION_RETRY';
      job.nextAttemptAt = nextAttemptAt;
      job.lastError = String(error ?? 'inspection failed');
      return job;
    }, updatedAt);
  }

  async markReportPending(eventId, {
    reportDir,
    reportText,
    inspectionFailed = false,
    inspectionError = null,
    now,
  } = {}) {
    const updatedAt = now ?? new Date().toISOString();
    return this.#update(eventId, (job) => {
      if (job.status !== 'PROCESSING') {
        throw new Error('webhook job is not being inspected: ' + job.status);
      }
      job.status = 'REPORT_PENDING';
      job.inspection = {
        completedAt: updatedAt,
        failed: inspectionFailed,
        error: inspectionError ? String(inspectionError) : null,
        reportDir: reportDir ?? null,
        reportText: String(reportText ?? ''),
      };
      job.reportAttempts = Number(job.reportAttempts ?? 0);
      delete job.nextAttemptAt;
      delete job.lastError;
      return job;
    }, updatedAt);
  }

  async claimReport(eventId, now = new Date().toISOString()) {
    return this.#update(eventId, (job) => {
      if (job.status !== 'REPORT_PENDING' && job.status !== 'REPORT_RETRY') {
        throw new Error('webhook job report is not ready: ' + job.status);
      }
      job.status = 'REPORTING';
      job.reportAttempts = Number(job.reportAttempts ?? 0) + 1;
      job.lastReportAttemptAt = now;
      delete job.nextAttemptAt;
      delete job.lastError;
      return job;
    }, now);
  }

  async markReportRetry(eventId, { error, nextAttemptAt, now } = {}) {
    const updatedAt = now ?? new Date().toISOString();
    return this.#update(eventId, (job) => {
      if (job.status !== 'REPORTING') {
        throw new Error('webhook job report is not being delivered: ' + job.status);
      }
      job.status = 'REPORT_RETRY';
      job.nextAttemptAt = nextAttemptAt;
      job.lastError = String(error ?? 'report delivery failed');
      return job;
    }, updatedAt);
  }

  async markReportDelivered(eventId, { messageId = null, now } = {}) {
    const deliveredAt = now ?? new Date().toISOString();
    return this.#update(eventId, (job) => {
      if (job.status !== 'REPORTING') {
        throw new Error('webhook job report is not being delivered: ' + job.status);
      }
      job.status = job.inspection?.failed ? 'FAILED' : 'COMPLETED';
      job.completedAt = deliveredAt;
      job.reportDelivery = {
        deliveredAt,
        messageId: messageId ? String(messageId) : null,
      };
      delete job.nextAttemptAt;
      delete job.lastError;
      return job;
    }, deliveredAt);
  }

  async markFailed(eventId, { phase, error, now } = {}) {
    const updatedAt = now ?? new Date().toISOString();
    return this.#update(eventId, (job) => {
      job.status = 'FAILED';
      job.failedAt = updatedAt;
      job.failurePhase = phase ?? 'unknown';
      job.lastError = String(error ?? 'webhook job failed');
      delete job.nextAttemptAt;
      return job;
    }, updatedAt);
  }

  async #update(eventId, updater, updatedAt) {
    await this.initialize();
    return this.#exclusive(async () => {
      const entry = this.jobs.get(eventId);
      if (!entry) throw new Error('webhook job not found: ' + eventId);
      const job = updater(structuredClone(entry.job));
      job.updatedAt = updatedAt ?? new Date().toISOString();
      await writeJsonAtomic(entry.filePath, job);
      this.jobs.set(eventId, { filePath: entry.filePath, job });
      return structuredClone(job);
    });
  }

  #exclusive(operation) {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.catch(() => undefined);
    return result;
  }
}
