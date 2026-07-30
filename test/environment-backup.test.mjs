import assert from 'node:assert/strict';
import test from 'node:test';

import { standardizeConfigSnapshot } from '../src/config-standardizer.mjs';
import {
  createEnvironmentBackup,
  summarizeEnvironmentBackup,
} from '../src/environment-backup.mjs';

function result(environment) {
  const config = {
    model_url: 'https://example.test/models.json',
    tabs: [],
    intro_list: [],
  };
  const models = [{ model_id: 1, model_name: environment + ' Model' }];
  return {
    environment,
    queriedAt: '2026-07-21T00:00:00.000Z',
    request: { configUrl: 'https://example.test/config/v4' },
    config,
    models,
    snapshot: standardizeConfigSnapshot({ config, models, environment }),
    missingModelReferences: { count: 0, uniqueModelIds: [], references: [] },
  };
}

test('stores complete DEV and PRO raw responses with stable snapshots', () => {
  const devResult = result('DEV');
  const proResult = result('PRO');
  const backup = createEnvironmentBackup({
    devResult,
    proResult,
    reason: 'initial',
    capturedAt: '2026-07-21T01:00:00.000Z',
  });

  assert.equal(backup.backupType, 'AM_DEV_PRO_CONFIG_BACKUP');
  assert.deepEqual(backup.environments.DEV.raw.config, devResult.config);
  assert.deepEqual(backup.environments.PRO.raw.models, proResult.models);
  assert.notEqual(backup.environments.DEV.raw.config, devResult.config);
  assert.deepEqual(summarizeEnvironmentBackup(backup), {
    capturedAt: '2026-07-21T01:00:00.000Z',
    reason: 'initial',
    dev: { groups: 0, models: 1, introPages: 0, missingModelReferences: 0 },
    pro: { groups: 0, models: 1, introPages: 0, missingModelReferences: 0 },
  });
});

test('rejects a backup without raw API responses', () => {
  const devResult = result('DEV');
  delete devResult.config;
  assert.throws(
    () => createEnvironmentBackup({ devResult, proResult: result('PRO') }),
    /DEV raw config and models are required/,
  );
});
