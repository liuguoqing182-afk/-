import assert from 'node:assert/strict';
import test from 'node:test';

import { standardizeConfigSnapshot } from '../src/config-standardizer.mjs';
import {
  inspectRelease,
  renderFeishuInspectionSummary,
} from '../src/release-inspector.mjs';

function snapshot(environment) {
  return standardizeConfigSnapshot({
    environment,
    config: {
      model_url: 'https://example.test/models.json',
      tabs: [],
      ai_video_tabs: [],
      ai_filter_tabs: [],
      ai_editor_tabs: [],
      intro_list: [],
    },
    models: [],
  });
}

const notification = `AIMirror首屏配置发布成功!
模版修改:
新首页配置:
操作人: user@example.com
发布环境: 从DEV发布到PRO`;

test('runs a complete passing release inspection', async () => {
  const beforePro = snapshot('PRO');
  const fetchSnapshotImpl = async (environment) => ({
    snapshot: snapshot(environment),
    missingModelReferences: { count: 0, uniqueModelIds: [], references: [] },
  });

  const result = await inspectRelease({
    notificationText: notification,
    beforePro,
    uid: 'uid-1',
    fetchSnapshotImpl,
  });

  assert.equal(result.status, 'PASSED');
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks, {
    notificationParsed: true,
    baselineAvailable: true,
    devProAligned: true,
    noNewEnvironmentDifferences: true,
    declarationConsistent: true,
    resourcesPassed: true,
  });
  assert.match(renderFeishuInspectionSummary(result), /通过 ✅/);
});

test('returns a report instead of fetching when the notification cannot be parsed', async () => {
  const result = await inspectRelease({
    notificationText: '不是发布通知',
    uid: 'uid-1',
    fetchSnapshotImpl: async () => assert.fail('must not fetch'),
  });

  assert.equal(result.status, 'PARSE_FAILED');
  assert.equal(result.passed, false);
});
