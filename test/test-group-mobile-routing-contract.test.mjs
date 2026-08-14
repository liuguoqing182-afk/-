import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const listener = await fs.readFile(
  new URL('../src/feishu-listener.mjs', import.meta.url),
  'utf8',
);
const listenerTask = await fs.readFile(
  new URL('../scripts/run-listener-task.ps1', import.meta.url),
  'utf8',
);

test('WebSocket listener is isolated to the test group', () => {
  assert.match(listener, /requiredEnvironment\('FEISHU_TEST_CHAT_ID'\)/u);
  assert.match(listener, /allowedReceiveId:\s*testChatId/u);
  assert.doesNotMatch(listener, /\bFEISHU_CHAT_ID\b/u);
  assert.doesNotMatch(listener, /\breleaseChatId\b/u);
  assert.doesNotMatch(listener, /processPublishMessage|new ReleaseMonitor/u);
  assert.doesNotMatch(listener, /apiClient\.im\.v1\.message\.create/u);

  assert.match(listenerTask, /'FEISHU_TEST_CHAT_ID'/u);
  assert.match(listenerTask, /\$env:FEISHU_TEST_CHAT_ID/u);
  assert.doesNotMatch(listenerTask, /'FEISHU_CHAT_ID'/u);
  assert.match(listenerTask, /Remove-Item[^\n]+Env:FEISHU_CHAT_ID/u);
  assert.doesNotMatch(listenerTask, /'AM_INSPECT_UID'/u);
  assert.doesNotMatch(listenerTask, /\$env:FEISHU_CHAT_ID/u);
});

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
