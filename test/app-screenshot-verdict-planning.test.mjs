import assert from 'node:assert/strict';
import test from 'node:test';
import { planAppScreenshotTasks } from '../src/app-screenshot-task-planner.mjs';
import { parsePublishNotification } from '../src/message-parser.mjs';
import { MODEL_EXPECTED_STATES } from '../src/model-search-verdict.mjs';

function notification(changes) {
  return `AIMirror首屏配置发布成功!
模版修改: ${changes}
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`;
}

test('enables business verdicts only for template-model tasks', () => {
  const plan = planAppScreenshotTasks(
    parsePublishNotification(notification('新增模型: Graphite Rose')),
  );
  const modelTask = plan.tasks[0];

  assert.equal(plan.planType, 'AM_RELEASE_APP_SCREENSHOT_V2');
  assert.equal(plan.policy.screenshotOnly, false);
  assert.equal(plan.policy.businessVerdictEnabled, true);
  assert.deepEqual(plan.policy.businessVerdictModules, ['模版修改']);
  assert.equal(modelTask.businessVerdictEnabled, true);
  assert.equal(modelTask.expectedState, MODEL_EXPECTED_STATES.PRESENT);
  assert.equal(modelTask.deletionExpectedNoResult, false);
});

test('parses a deleted model and plans an absent-state verdict', () => {
  const parsed = parsePublishNotification(
    notification('删除模型: Farewell Paw'),
  );
  assert.equal(parsed.fullyParsed, true);
  assert.equal(parsed.declaredChanges[0].type, 'MODEL_CATALOG_DELETE');

  const task = planAppScreenshotTasks(parsed).tasks[0];
  assert.equal(task.objectName, 'Farewell Paw');
  assert.equal(task.expectedState, MODEL_EXPECTED_STATES.ABSENT);
  assert.equal(task.deletionExpectedNoResult, true);
});

test('marks mixed delete and update declarations as a conflict', () => {
  const parsed = parsePublishNotification(
    notification(`删除模型: Farewell Paw,
模型Farewell Paw图片改变`),
  );
  const task = planAppScreenshotTasks(parsed).tasks[0];
  assert.equal(task.expectedState, MODEL_EXPECTED_STATES.CONFLICT);
});
