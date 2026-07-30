export const ENVIRONMENT_BACKUP_SCHEMA_VERSION = '1.0';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function environmentRecord(result, expectedEnvironment) {
  if (!isRecord(result) || !isRecord(result.snapshot)) {
    throw new TypeError(expectedEnvironment + ' result with snapshot is required');
  }
  if (!isRecord(result.config) || !Array.isArray(result.models)) {
    throw new TypeError(expectedEnvironment + ' raw config and models are required');
  }
  if (result.snapshot.environment !== expectedEnvironment) {
    throw new Error(expectedEnvironment + ' snapshot environment mismatch');
  }
  return {
    environment: expectedEnvironment,
    queriedAt: result.queriedAt ?? null,
    request: structuredClone(result.request ?? null),
    raw: {
      config: structuredClone(result.config),
      models: structuredClone(result.models),
    },
    snapshot: structuredClone(result.snapshot),
    missingModelReferences: structuredClone(
      result.missingModelReferences ?? null,
    ),
  };
}

export function createEnvironmentBackup(input) {
  const capturedAt = input?.capturedAt ?? new Date().toISOString();
  return {
    schemaVersion: ENVIRONMENT_BACKUP_SCHEMA_VERSION,
    backupType: 'AM_DEV_PRO_CONFIG_BACKUP',
    capturedAt,
    reason: String(input?.reason ?? 'manual'),
    metadata: structuredClone(input?.metadata ?? {}),
    environments: {
      DEV: environmentRecord(input?.devResult, 'DEV'),
      PRO: environmentRecord(input?.proResult, 'PRO'),
    },
  };
}

export function summarizeEnvironmentBackup(backup) {
  if (!isRecord(backup) || backup.backupType !== 'AM_DEV_PRO_CONFIG_BACKUP') {
    throw new TypeError('AM_DEV_PRO_CONFIG_BACKUP is required');
  }
  return {
    capturedAt: backup.capturedAt,
    reason: backup.reason,
    dev: {
      groups: backup.environments.DEV.snapshot.counts.groups,
      models: backup.environments.DEV.snapshot.counts.models,
      introPages: backup.environments.DEV.snapshot.counts.introPages,
      missingModelReferences:
        backup.environments.DEV.missingModelReferences?.count ?? null,
    },
    pro: {
      groups: backup.environments.PRO.snapshot.counts.groups,
      models: backup.environments.PRO.snapshot.counts.models,
      introPages: backup.environments.PRO.snapshot.counts.introPages,
      missingModelReferences:
        backup.environments.PRO.missingModelReferences?.count ?? null,
    },
  };
}
