import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { standardizeConfigSnapshot } from '../src/config-standardizer.mjs';
import { ReleaseMonitor } from '../src/release-monitor.mjs';

function environmentResult(environment) {
  const config = {
    model_url: 'https://example.test/models.json',
    tabs: [],
    ai_video_tabs: [],
    ai_filter_tabs: [],
    ai_editor_tabs: [],
    intro_list: [],
  };
  const models = [];
  return {
    environment,
    queriedAt: new Date().toISOString(),
    request: {
      configUrl: 'https://example.test/config/v4',
      modelUrl: config.model_url,
    },
    config,
    models,
    snapshot: standardizeConfigSnapshot({ config, models, environment }),
    missingModelReferences: { count: 0, uniqueModelIds: [], references: [] },
  };
}

test('archives initial and release-time DEV/PRO raw backups', async (context) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'am-monitor-backup-'));
  context.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const monitor = new ReleaseMonitor({
    uid: 'uid-test',
    dataDir,
    fetchSnapshotImpl: async (environment) => environmentResult(environment),
  });

  const initialized = await monitor.initialize();
  assert.equal(initialized.environmentBackupCreated, true);
  assert.equal((await fs.stat(initialized.environmentBackupPath)).isFile(), true);

  const notification = `AIMirror首屏配置发布成功!
模版修改:
新首页配置:
操作人: test@example.com
发布环境: 从DEV发布到PRO`;
  const { result, reportDir } = await monitor.inspect(notification, {
    messageId: 'om_test',
  });

  assert.equal(result.passed, true);
  const manifest = JSON.parse(await fs.readFile(
    path.join(reportDir, 'environment-backups.json'),
    'utf8',
  ));
  assert.equal(manifest.backupType, 'AM_RELEASE_BACKUP_PAIR');
  assert.notEqual(manifest.before.archivePath, manifest.after.archivePath);
  for (const archivePath of [
    manifest.before.archivePath,
    manifest.after.archivePath,
  ]) {
    assert.equal((await fs.stat(path.join(dataDir, archivePath))).isFile(), true);
  }
  const current = JSON.parse(await fs.readFile(
    path.join(dataDir, 'current-environment-backup.json'),
    'utf8',
  ));
  assert.equal(current.reason, 'release');
  assert.equal(current.metadata.messageId, 'om_test');
});
