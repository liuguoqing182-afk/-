import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertFormalAppScreenshotDelivery,
  assertFormalGroupTextBlocked,
  FORMAL_APP_SCREENSHOT_MESSAGE_TYPE,
  FORMAL_APP_SCREENSHOT_REPORT_TITLE,
} from '../src/app-screenshot-formal-delivery-policy.mjs';

const formalChatId = 'formal-chat';

test('formal group accepts only the exact approved APP screenshot image report', () => {
  assert.doesNotThrow(() =>
    assertFormalAppScreenshotDelivery({
      destinationChatId: formalChatId,
      formalChatId,
      messageType: FORMAL_APP_SCREENSHOT_MESSAGE_TYPE,
      reportTitle: FORMAL_APP_SCREENSHOT_REPORT_TITLE,
      sendEnabled: '1',
      confirmedChatId: formalChatId,
    }),
  );
});

test('formal group rejects text and any non-approved report title', () => {
  assert.throws(
    () =>
      assertFormalAppScreenshotDelivery({
        destinationChatId: formalChatId,
        formalChatId,
        messageType: 'text',
        reportTitle: FORMAL_APP_SCREENSHOT_REPORT_TITLE,
        sendEnabled: '1',
        confirmedChatId: formalChatId,
      }),
    /only accepts the approved APP screenshot image report/u,
  );
  assert.throws(
    () =>
      assertFormalAppScreenshotDelivery({
        destinationChatId: formalChatId,
        formalChatId,
        messageType: FORMAL_APP_SCREENSHOT_MESSAGE_TYPE,
        reportTitle: '任意总结',
        sendEnabled: '1',
        confirmedChatId: formalChatId,
      }),
    /report title must be exactly/u,
  );
  assert.throws(
    () =>
      assertFormalGroupTextBlocked({
        destinationChatId: formalChatId,
        formalChatId,
      }),
    /text delivery is forbidden/u,
  );
});

test('formal delivery still requires explicit enablement and exact chat confirmation', () => {
  const base = {
    destinationChatId: formalChatId,
    formalChatId,
    messageType: FORMAL_APP_SCREENSHOT_MESSAGE_TYPE,
    reportTitle: FORMAL_APP_SCREENSHOT_REPORT_TITLE,
  };
  assert.throws(
    () => assertFormalAppScreenshotDelivery({ ...base, sendEnabled: '0' }),
    /is not enabled/u,
  );
  assert.throws(
    () =>
      assertFormalAppScreenshotDelivery({
        ...base,
        sendEnabled: '1',
        confirmedChatId: 'wrong-chat',
      }),
    /confirmation does not match/u,
  );
});
