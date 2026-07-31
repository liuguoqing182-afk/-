import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublishNotification } from '../src/message-parser.mjs';
import { planAppScreenshotTasks } from '../src/app-screenshot-task-planner.mjs';

const CURRENT_RELEASE = `AIMirror首屏配置发布成功!
模版修改: 新增模型: 宠物开车跳舞,
新增模型: Player Posters,
新增模型: Petal Awakening,
新增模型: Tulip Cradle,
新增模型: Grainy Portrait,
新增模型: Paw Driver
More Style AI Filter配置: 标签Retro的模型排序改变,
新增了模型(所属标签Retro)[1413],
标签Retro的组封面修改,
标签Studio的模型排序改变,
新增了模型(所属标签Studio)[986],
标签Studio的组封面修改
国际化配置: 新增国际化模型: 986,
新增国际化模型: 20482,
新增国际化模型: 987,
新增国际化模型: 2998,
新增国际化模型: 1413,
新增国际化模型: 20483
新首页配置: 标签Trend Hub的模型排序改变,
新增了模型(所属标签Trend Hub)[20483, 20482, 986],
标签Trend Hub的组封面修改,
标签Noir Mood的模型排序改变,
新增了模型(所属标签Noir Mood)[1413],
标签Noir Mood的组封面修改,
标签New的模型排序改变,
新增了模型(所属标签New)[1413, 2998, 986],
标签New的组封面修改,
标签Viral Dance的模型排序改变,
新增了模型(所属标签Viral Dance)[20483],
标签Viral Dance的组封面修改
More Style Video配置: 标签Viral Dance的模型排序改变,
新增了模型(所属标签Viral Dance)[20483],
标签Viral Dance的组封面修改,
标签Social Trend的模型排序改变,
新增了模型(所属标签Social Trend)[20482],
标签Social Trend的组封面修改
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`;

test('plans the current release as 14 objects and 24 screenshots', () => {
  const parsed = parsePublishNotification(CURRENT_RELEASE);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.fullyParsed, true);

  const plan = planAppScreenshotTasks(parsed, {
    messageId: 'om_current',
    generatedAt: '2026-07-24T02:00:00.000Z',
  });

  assert.deepEqual(plan.totals, {
    moduleCount: 4,
    changedModuleCount: 4,
    taskCount: 14,
    screenshotCount: 24,
  });
  assert.equal(plan.ignoredManualModules.includes('国际化配置'), false);
  assert.equal(plan.planningWarnings.length, 0);

  const modules = Object.fromEntries(
    plan.automationModules.map((module) => [module.module, module]),
  );
  assert.equal(modules['模版修改'].tasks.length, 6);
  assert.equal(modules['新首页配置'].tasks.length, 4);
  assert.equal(modules['More Style Video配置'].tasks.length, 2);
  assert.equal(modules['More Style AI Filter配置'].tasks.length, 2);
  assert.equal(
    modules['新首页配置'].tasks.find((task) => task.objectName === 'New').flow,
    'HOME_NEW',
  );  assert.equal(
    modules['新首页配置'].tasks.find((task) => task.objectName === 'New')
      .screenshotTotal,
    4,
  );
  assert.equal(
    modules['新首页配置'].tasks.find(
      (task) => task.objectName === 'Trend Hub',
    ).screenshotTotal,
    2,
  );
  assert.equal(modules['More Style Video配置'].tasks[0].screenshotTotal, 2);
  assert.equal(modules['More Style AI Filter配置'].tasks[0].screenshotTotal, 2);
});

test('merges changes for the same object and creates no-change labels', () => {
  const parsed = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改: 模型Farewell Paw图片改变,
模型Farewell Paw的封面图系列有改动,
模型Farewell Paw有字段改动
新首页配置: 标签Beyond Love的模型排序改变,
新增了模型(所属标签Beyond Love)[20288],
标签Beyond Love的组封面修改
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`);

  const plan = planAppScreenshotTasks(parsed);
  assert.equal(plan.totals.taskCount, 2);
  assert.equal(plan.totals.screenshotCount, 3);

  const modelTask = plan.tasks.find(
    (task) => task.objectName === 'Farewell Paw',
  );
  assert.equal(modelTask.changeTypes.length, 3);

  const video = plan.automationModules.find(
    (module) => module.module === 'More Style Video配置',
  );
  assert.equal(video.changed, false);
  assert.equal(video.noChangeLabel, 'More Style Video配置｜本次无修改');
});

test('plans formal-group delivery only when the target is explicit', () => {
  const parsed = parsePublishNotification(CURRENT_RELEASE);
  const testPlan = planAppScreenshotTasks(parsed);
  const formalPlan = planAppScreenshotTasks(parsed, {
    reportTarget: 'FORMAL_GROUP',
  });

  assert.equal(testPlan.policy.reportTarget, 'TEST_GROUP_ONLY');
  assert.equal(testPlan.policy.formalGroupOutputEnabled, false);
  assert.equal(formalPlan.policy.reportTarget, 'FORMAL_GROUP');
  assert.equal(formalPlan.policy.formalGroupOutputEnabled, true);
});

