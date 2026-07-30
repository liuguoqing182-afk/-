import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const listener = await fs.readFile(
  new URL('../src/feishu-listener.mjs', import.meta.url),
  'utf8',
);

test('test-group publish notifications are delegated only to the mobile App pipeline', () => {
  const start = listener.indexOf('    const testPublishMessage =');
  const end = listener.indexOf('    const healthCheck =', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const testGroupRoute = listener.slice(start, end);

  assert.match(testGroupRoute, /delegated to app screenshot poller/);
  assert.doesNotMatch(
    testGroupRoute,
    /enqueue|testMonitor|processPublishMessage|inspect/,
  );
});
