import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { seedMonitorData } from '../src/monitor-data-seed.mjs';

test('seeds a new test monitor from the release baseline and backup', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'am-monitor-seed-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDataDir = path.join(root, 'data');
  const targetDataDir = path.join(root, 'data-test');
  await fs.mkdir(path.join(sourceDataDir, 'backups'), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(sourceDataDir, 'pro-baseline.json'),
      JSON.stringify({ version: 'previous' }),
    ),
    fs.writeFile(
      path.join(sourceDataDir, 'known-differences.json'),
      JSON.stringify({ known: true }),
    ),
    fs.writeFile(
      path.join(sourceDataDir, 'current-environment-backup.json'),
      JSON.stringify({ archivePath: 'backups/previous.json' }),
    ),
    fs.writeFile(
      path.join(sourceDataDir, 'backups', 'previous.json'),
      JSON.stringify({ backup: true }),
    ),
  ]);

  const result = await seedMonitorData({ sourceDataDir, targetDataDir });

  assert.equal(result.seeded, true);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(targetDataDir, 'pro-baseline.json'), 'utf8')),
    { version: 'previous' },
  );
  assert.equal(
    (await fs.stat(path.join(targetDataDir, 'backups', 'previous.json'))).isFile(),
    true,
  );
});

test('does not overwrite an existing test baseline', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'am-monitor-seed-existing-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDataDir = path.join(root, 'data');
  const targetDataDir = path.join(root, 'data-test');
  await fs.mkdir(targetDataDir, { recursive: true });
  await fs.writeFile(
    path.join(targetDataDir, 'pro-baseline.json'),
    JSON.stringify({ keep: true }),
  );

  const result = await seedMonitorData({ sourceDataDir, targetDataDir });

  assert.equal(result.seeded, false);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(targetDataDir, 'pro-baseline.json'), 'utf8')),
    { keep: true },
  );
});
