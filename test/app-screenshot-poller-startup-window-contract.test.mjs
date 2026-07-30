import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const poller = await fs.readFile(
  new URL('../src/feishu-app-screenshot-test-poller.mjs', import.meta.url),
  'utf8',
);

test('mobile App poller accepts the whole configured startup lookback window', () => {
  assert.match(
    poller,
    /const acceptAfterMilliseconds = Date\.now\(\) - initialLookbackMs;/,
  );
  assert.doesNotMatch(
    poller,
    /const acceptAfterMilliseconds = Date\.now\(\) - 2 \* 60 \* 1000;/,
  );
});
