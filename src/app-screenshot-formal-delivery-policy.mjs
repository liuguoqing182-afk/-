export const FORMAL_APP_SCREENSHOT_REPORT_TITLE =
  'AIMirror首屏配置发布自动化检测报告！';

export const FORMAL_APP_SCREENSHOT_MESSAGE_TYPE = 'image';

export function assertFormalAppScreenshotDelivery({
  destinationChatId,
  formalChatId,
  messageType,
  reportTitle,
  sendEnabled,
  confirmedChatId,
} = {}) {
  if (String(destinationChatId ?? '').trim() !== String(formalChatId ?? '').trim()) {
    return;
  }
  if (String(sendEnabled ?? '').trim() !== '1') {
    throw new Error('formal-group APP screenshot delivery is not enabled');
  }
  if (String(confirmedChatId ?? '').trim() !== String(formalChatId ?? '').trim()) {
    throw new Error('formal-group APP screenshot chat confirmation does not match');
  }
  if (messageType !== FORMAL_APP_SCREENSHOT_MESSAGE_TYPE) {
    throw new Error('formal group only accepts the approved APP screenshot image report');
  }
  if (reportTitle !== FORMAL_APP_SCREENSHOT_REPORT_TITLE) {
    throw new Error(
      `formal-group APP screenshot report title must be exactly: ${FORMAL_APP_SCREENSHOT_REPORT_TITLE}`,
    );
  }
}

export function assertFormalGroupTextBlocked({ destinationChatId, formalChatId } = {}) {
  if (String(destinationChatId ?? '').trim() === String(formalChatId ?? '').trim()) {
    throw new Error(
      'formal-group text delivery is forbidden; only the approved APP screenshot image report is allowed',
    );
  }
}
