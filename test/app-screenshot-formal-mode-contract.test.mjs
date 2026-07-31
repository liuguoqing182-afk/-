import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const formalRunner = await fs.readFile(
  new URL('../scripts/run-app-screenshot-formal-poller-task.ps1', import.meta.url),
  'utf8',
);
const sharedRunner = await fs.readFile(
  new URL('../scripts/run-app-screenshot-test-poller-task.ps1', import.meta.url),
  'utf8',
);
const poller = await fs.readFile(
  new URL('../src/feishu-app-screenshot-test-poller.mjs', import.meta.url),
  'utf8',
);
const sender = await fs.readFile(
  new URL('../scripts/send-app-screenshot-collage-to-test-group.mjs', import.meta.url),
  'utf8',
);

test('formal rollout reuses the shared poller runner with a 30-minute interval', () => {
  assert.match(formalRunner, /run-app-screenshot-test-poller-task\.ps1/u);
  assert.match(formalRunner, /FORMAL_GROUP/u);
  assert.match(formalRunner, /FORMAL_SEND_ENABLED = '1'/u);
  assert.match(formalRunner, /POLL_INTERVAL_MS = '1800000'/u);
  assert.match(
    formalRunner,
    /oc_a3d62e948296c31948f744f3db3758ad/u,
  );
  assert.match(sharedRunner, /feishu-app-screenshot-test-poller\.mjs/u);
});

test('formal polling and delivery both require explicit target authorization', () => {
  assert.match(poller, /AM_APP_SCREENSHOT_FORMAL_SEND_ENABLED/u);
  assert.match(poller, /AM_APP_SCREENSHOT_FORMAL_CHAT_ID_CONFIRMATION/u);
  assert.match(poller, /chatId: reportChatId/u);
  assert.match(sender, /AM_APP_SCREENSHOT_FORMAL_SEND_ENABLED/u);
  assert.match(sender, /AM_APP_SCREENSHOT_FORMAL_CHAT_ID_CONFIRMATION/u);
  assert.match(sender, /chatId: destinationChatId/u);
});

test('formal polling suppresses failure text and permits only final report delivery', () => {
  assert.match(poller, /failure notification suppressed; final reports only/u);
  assert.match(
    poller,
    /shouldSendAppScreenshotFailureNotification\(reportTarget\)/u,
  );
});
