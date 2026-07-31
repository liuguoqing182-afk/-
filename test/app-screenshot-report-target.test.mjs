import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_SCREENSHOT_REPORT_TARGETS,
  isFormalAppScreenshotTarget,
  normalizeAppScreenshotReportTarget,
} from '../src/app-screenshot-report-target.mjs';

test('APP screenshot reports default to the isolated test group', () => {
  assert.equal(
    normalizeAppScreenshotReportTarget(),
    APP_SCREENSHOT_REPORT_TARGETS.TEST_GROUP_ONLY,
  );
  assert.equal(isFormalAppScreenshotTarget('TEST_GROUP_ONLY'), false);
});

test('formal report mode must be selected explicitly', () => {
  assert.equal(
    normalizeAppScreenshotReportTarget('FORMAL_GROUP'),
    APP_SCREENSHOT_REPORT_TARGETS.FORMAL_GROUP,
  );
  assert.equal(isFormalAppScreenshotTarget('FORMAL_GROUP'), true);
  assert.throws(
    () => normalizeAppScreenshotReportTarget('unknown'),
    /unsupported APP screenshot report target/u,
  );
});
