import fs from 'node:fs/promises';
import path from 'node:path';

import { fetchHomeSnapshot, findMissingModelReferences } from './am-home-client.mjs';
import { diffDevPro } from './config-diff.mjs';
import {
  createEnvironmentBackup,
  summarizeEnvironmentBackup,
} from './environment-backup.mjs';
import { captureKnownDifferences } from './known-difference-baseline.mjs';
import { inspectRelease } from './release-inspector.mjs';

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + '.tmp-' + process.pid;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temporaryPath, filePath);
}

function jobName(messageId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeId = String(messageId ?? 'manual').replace(/[^a-zA-Z0-9_-]/g, '_');
  return timestamp + '-' + safeId;
}

export class ReleaseMonitor {
  constructor(options = {}) {
    this.uid = String(options.uid ?? '').trim();
    if (!this.uid) throw new Error('AM_INSPECT_UID is required');
    this.dataDir = path.resolve(options.dataDir ?? 'data');
    this.baselinePath = path.join(this.dataDir, 'pro-baseline.json');
    this.knownDifferencesPath = path.join(this.dataDir, 'known-differences.json');
    this.environmentBackupPath = path.join(
      this.dataDir,
      'current-environment-backup.json',
    );
    this.environmentBackupDir = path.join(this.dataDir, 'backups');
    this.fetchSnapshotImpl = options.fetchSnapshotImpl ?? fetchHomeSnapshot;
    this.fetchOptions = options.fetchOptions ?? {};
    this.resourceCheckOptions = options.resourceCheckOptions;
    this.baseline = null;
    this.knownDifferences = null;
    this.environmentBackup = null;
    this.environmentBackupArchivePath = null;
  }

  async initialize() {
    const currentResults = new Map();
    const getCurrent = (environment) => {
      if (!currentResults.has(environment)) {
        currentResults.set(
          environment,
          this.fetchSnapshotImpl(environment, {
            ...this.fetchOptions,
            uid: this.uid,
          }),
        );
      }
      return currentResults.get(environment);
    };

    this.baseline = await readJson(this.baselinePath);
    let created = false;
    if (!this.baseline) {
      const current = await getCurrent('PRO');
      this.baseline = current.snapshot;
      await writeJsonAtomic(this.baselinePath, this.baseline);
      created = true;
    }

    this.knownDifferences = await readJson(this.knownDifferencesPath);
    let knownDifferencesCreated = false;
    if (!this.knownDifferences) {
      const [devResult, proResult] = await Promise.all([
        getCurrent('DEV'),
        getCurrent('PRO'),
      ]);
      const proMissingModelReferences = proResult.missingModelReferences ??
        findMissingModelReferences(proResult.snapshot);
      this.knownDifferences = captureKnownDifferences({
        devProDiff: diffDevPro({
          dev: devResult.snapshot,
          pro: proResult.snapshot,
        }),
        proMissingModelReferences,
      });
      await writeJsonAtomic(this.knownDifferencesPath, this.knownDifferences);
      knownDifferencesCreated = true;
    }

    this.environmentBackup = await readJson(this.environmentBackupPath);
    let environmentBackupCreated = false;
    if (!this.environmentBackup) {
      const [devResult, proResult] = await Promise.all([
        getCurrent('DEV'),
        getCurrent('PRO'),
      ]);
      const archivePath = path.join(
        this.environmentBackupDir,
        jobName('initial') + '.json',
      );
      const backup = createEnvironmentBackup({
        devResult,
        proResult,
        reason: 'initial',
      });
      backup.archivePath = path.relative(this.dataDir, archivePath);
      await Promise.all([
        writeJsonAtomic(archivePath, backup),
        writeJsonAtomic(this.environmentBackupPath, backup),
      ]);
      this.environmentBackup = backup;
      this.environmentBackupArchivePath = archivePath;
      environmentBackupCreated = true;
    } else {
      if (!this.environmentBackup.archivePath) {
        throw new Error('current environment backup is missing archivePath');
      }
      this.environmentBackupArchivePath = path.resolve(
        this.dataDir,
        this.environmentBackup.archivePath,
      );
    }
    return {
      created,
      baselinePath: this.baselinePath,
      knownDifferencesCreated,
      knownDifferencesPath: this.knownDifferencesPath,
      knownDifferenceSummary: this.knownDifferences.summary,
      environmentBackupCreated,
      environmentBackupPath: this.environmentBackupArchivePath,
      environmentBackupSummary: summarizeEnvironmentBackup(
        this.environmentBackup,
      ),
    };
  }

  async inspect(notificationText, metadata = {}) {
    if (!this.baseline || !this.knownDifferences || !this.environmentBackup) {
      await this.initialize();
    }
    const result = await inspectRelease({
      notificationText,
      beforePro: this.baseline,
      uid: this.uid,
      fetchSnapshotImpl: this.fetchSnapshotImpl,
      fetchOptions: this.fetchOptions,
      resourceCheckOptions: this.resourceCheckOptions,
      knownDifferences: this.knownDifferences,
    });
    if (!result.current?.proSnapshot) return { result, reportDir: null };

    const jobId = jobName(metadata.messageId);
    const reportDir = path.join(this.dataDir, 'reports', jobId);
    await fs.mkdir(reportDir, { recursive: true });
    const beforeBackup = this.environmentBackup;
    const beforeArchivePath = this.environmentBackupArchivePath;
    const afterArchivePath = path.join(
      this.environmentBackupDir,
      jobId + '-release.json',
    );
    const afterBackup = createEnvironmentBackup({
      devResult: result.current.devEnvironment,
      proResult: result.current.proEnvironment,
      reason: 'release',
      metadata: { messageId: metadata.messageId ?? null },
    });
    afterBackup.archivePath = path.relative(this.dataDir, afterArchivePath);
    const backupManifest = {
      backupType: 'AM_RELEASE_BACKUP_PAIR',
      messageId: metadata.messageId ?? null,
      before: {
        archivePath: path.relative(this.dataDir, beforeArchivePath),
        summary: summarizeEnvironmentBackup(beforeBackup),
      },
      after: {
        archivePath: afterBackup.archivePath,
        summary: summarizeEnvironmentBackup(afterBackup),
      },
    };
    const persistedResult = structuredClone(result);
    delete persistedResult.current;
    await Promise.all([
      fs.writeFile(
        path.join(reportDir, 'notification.txt'),
        String(notificationText).trim() + '\n',
        'utf8',
      ),
      writeJsonAtomic(path.join(reportDir, 'inspection.json'), persistedResult),
      writeJsonAtomic(path.join(reportDir, 'dev-snapshot.json'), result.current.devSnapshot),
      writeJsonAtomic(path.join(reportDir, 'pro-snapshot.json'), result.current.proSnapshot),
      writeJsonAtomic(
        path.join(reportDir, 'environment-backups.json'),
        backupManifest,
      ),
      writeJsonAtomic(afterArchivePath, afterBackup),
      writeJsonAtomic(this.environmentBackupPath, afterBackup),
    ]);
    this.environmentBackup = afterBackup;
    this.environmentBackupArchivePath = afterArchivePath;
    this.baseline = result.current.proSnapshot;
    await writeJsonAtomic(this.baselinePath, this.baseline);
    return { result, reportDir };
  }
}
