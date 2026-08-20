import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadHistoricalModelNamesById } from '../src/app-screenshot-test-pipeline.mjs';

async function writePlan(root, release, generatedAt, assertions) {
  const releaseDir = path.join(root, release);
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.writeFile(
    path.join(releaseDir, 'screenshot-plan.json'),
    JSON.stringify({ generatedAt, tasks: [{ modelAssertions: assertions }] }),
    'utf8',
  );
}

test('historical model names use the last generated plan value', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'am-model-name-history-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writePlan(root, 'newer', '2026-08-15T02:00:00.000Z', [
    { id: '1443', name: 'Latest Magic World' },
  ]);
  await writePlan(root, 'older', '2026-08-14T02:00:00.000Z', [
    { id: '1443', name: 'Magic World' },
    { id: '995', name: 'Birthday Beast' },
  ]);

  assert.deepEqual(await loadHistoricalModelNamesById(root), {
    995: 'Birthday Beast',
    1443: 'Latest Magic World',
  });
});
