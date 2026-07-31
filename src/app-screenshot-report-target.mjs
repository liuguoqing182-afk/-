export const APP_SCREENSHOT_REPORT_TARGETS = Object.freeze({
  TEST_GROUP_ONLY: 'TEST_GROUP_ONLY',
  FORMAL_GROUP: 'FORMAL_GROUP',
});

export function normalizeAppScreenshotReportTarget(
  value,
  fallback = APP_SCREENSHOT_REPORT_TARGETS.TEST_GROUP_ONLY,
) {
  const target = String(value ?? fallback).trim().toUpperCase();
  if (!Object.values(APP_SCREENSHOT_REPORT_TARGETS).includes(target)) {
    throw new Error('unsupported APP screenshot report target: ' + value);
  }
  return target;
}

export function isFormalAppScreenshotTarget(value) {
  return (
    normalizeAppScreenshotReportTarget(value) ===
    APP_SCREENSHOT_REPORT_TARGETS.FORMAL_GROUP
  );
}

export function shouldSendAppScreenshotFailureNotification(value) {
  return !isFormalAppScreenshotTarget(value);
}
