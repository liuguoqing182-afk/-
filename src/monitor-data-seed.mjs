import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function resolveDataChild(dataDir, relativePath) {
  const resolved = path.resolve(dataDir, relativePath);
  const relative = path.relative(dataDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Monitor archivePath must stay inside its data directory');
  }
  return resolved;
}

async function copyFile(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

export async function seedMonitorData(options = {}) {
  const sourceDataDir = path.resolve(options.sourceDataDir ?? 'data');
  const targetDataDir = path.resolve(options.targetDataDir ?? 'data-test');
  if (sourceDataDir === targetDataDir) {
    throw new Error('Test monitor data directory must differ from release data directory');
  }

  const targetBaselinePath = path.join(targetDataDir, 'pro-baseline.json');
  if (await exists(targetBaselinePath)) {
    return { seeded: false, targetDataDir };
  }

  const sourceBackupPath = path.join(sourceDataDir, 'current-environment-backup.json');
  const backup = JSON.parse(await fs.readFile(sourceBackupPath, 'utf8'));
  if (!backup.archivePath) {
    throw new Error('Release environment backup is missing archivePath');
  }

  const sourceArchivePath = resolveDataChild(sourceDataDir, backup.archivePath);
  const targetArchivePath = resolveDataChild(targetDataDir, backup.archivePath);
  await Promise.all([
    copyFile(
      path.join(sourceDataDir, 'known-differences.json'),
      path.join(targetDataDir, 'known-differences.json'),
    ),
    copyFile(sourceBackupPath, path.join(targetDataDir, 'current-environment-backup.json')),
    copyFile(sourceArchivePath, targetArchivePath),
  ]);
  await copyFile(path.join(sourceDataDir, 'pro-baseline.json'), targetBaselinePath);

  return {
    seeded: true,
    sourceDataDir,
    targetDataDir,
    targetBaselinePath,
  };
}
