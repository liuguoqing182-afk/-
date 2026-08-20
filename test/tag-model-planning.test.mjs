import assert from 'node:assert/strict';
import test from 'node:test';

import { planAppScreenshotTasks } from '../src/app-screenshot-task-planner.mjs';
import { parsePublishNotification } from '../src/message-parser.mjs';

test('maps tag model IDs to names and expands a newly added tag', () => {
  const parsed = parsePublishNotification(`AIMirror首屏配置发布成功!
More Style AI Filter配置: 标签Retro的模型排序改变,
新增了模型(所属标签Retro)[1415, 1414, 1419, 1418, 1417, 1416]
新首页配置: 增加标签: Film Portraits,
标签Best Companion的模型排序改变,
新增了模型(所属标签Best Companion)[1420]
More Style Video配置: 标签Seedance 2.0的模型排序改变,
新增了模型(所属标签Seedance 2.0)[22036, 22037, 20484],
标签Seedance 2.0的组封面修改
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.fullyParsed, true);

  const names = new Map([
    ['1412', 'Film Record'],
    ['1413', 'Grainy Portrait'],
    ['1414', 'Film Handset'],
    ['1415', 'Reel Memory'],
    ['1416', 'Subway Vibe'],
    ['1417', 'Transit Focus'],
    ['1418', 'Vintage Transit'],
    ['1419', 'Station Wanderer'],
    ['1420', 'Anniversary Reel'],
    ['20484', 'Kitchen Showdown III'],
    ['22036', 'Caught Snacking'],
    ['22037', 'Global Touch'],
  ]);
  const targetSnapshot = {
    models: [...names].map(([id, name]) => ({ id, name })),
    groups: [
      {
        section: 'TABS',
        name: 'Film Portraits',
        modelIds: [
          '1419',
          '1418',
          '1417',
          '1416',
          '1415',
          '1414',
          '1413',
          '1412',
        ],
      },
    ],
  };

  const plan = planAppScreenshotTasks(parsed, { targetSnapshot });
  const retro = plan.tasks.find((task) => task.objectName === 'Retro');
  const film = plan.tasks.find((task) => task.objectName === 'Film Portraits');
  const companion = plan.tasks.find(
    (task) => task.objectName === 'Best Companion',
  );
  const seedance = plan.tasks.find(
    (task) => task.objectName === 'Seedance 2.0',
  );

  assert.deepEqual(
    retro.modelAssertions.map(({ id, name }) => [id, name]),
    [
      ['1415', 'Reel Memory'],
      ['1414', 'Film Handset'],
      ['1419', 'Station Wanderer'],
      ['1418', 'Vintage Transit'],
      ['1417', 'Transit Focus'],
      ['1416', 'Subway Vibe'],
    ],
  );
  assert.equal(retro.tagModelVerdictEnabled, true);
  assert.equal(film.modelAssertions.length, 8);
  assert.equal(film.modelAssertions[0].name, 'Station Wanderer');
  assert.equal(companion.modelAssertions[0].name, 'Anniversary Reel');
  assert.deepEqual(
    seedance.modelAssertions.map(({ name }) => name),
    ['Caught Snacking', 'Global Touch', 'Kitchen Showdown III'],
  );
  assert.equal(plan.planningWarnings.length, 0);
});

test('routes New through tag model scanning when model assertions exist', () => {
  const parsed = parsePublishNotification(`AIMirror首屏配置发布成功!
新首页配置: 标签New的模型排序改变,
新增了模型(所属标签New)[1413, 2998],
标签New的组封面修改
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`);
  const plan = planAppScreenshotTasks(parsed, {
    targetSnapshot: {
      groups: [],
      models: [{ id: '1413', name: 'Grainy Portrait' }],
    },
  });
  const task = plan.tasks.find((item) => item.objectName === 'New');
  assert.equal(task.flow, 'HOME_TAG');
  assert.equal(task.screenshotTotal, 2);
  assert.equal(task.tagModelVerdictEnabled, true);
  assert.deepEqual(
    task.modelAssertions.map(({ id, name }) => [id, name]),
    [
      ['1413', 'Grainy Portrait'],
      ['2998', null],
    ],
  );
  assert.match(plan.planningWarnings[0], /2998/);
});

test('uses aligned publish additions only when the target catalog omits names', () => {
  const parsed = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改: 新增模型: Skybound Kin,
新增模型: Ivory Garden
国际化配置: 新增国际化模型: 1426,
新增国际化模型: 1427
新首页配置: 标签Reunited的模型排序改变,
新增了模型(所属标签Reunited)[1426, 1427]
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`);

  const plan = planAppScreenshotTasks(parsed, {
    targetSnapshot: {
      groups: [],
      models: [],
    },
  });
  const task = plan.tasks.find((item) => item.objectName === 'Reunited');

  assert.deepEqual(
    task.modelAssertions.map(({ id, name }) => [id, name]),
    [
      ['1426', 'Skybound Kin'],
      ['1427', 'Ivory Garden'],
    ],
  );
  assert.equal(task.tagModelVerdictEnabled, true);
  assert.deepEqual(plan.planningWarnings, []);
});

test('uses historical names only for deleted tag models', () => {
  const parsed = parsePublishNotification(`AIMirror首屏配置发布成功!
新首页配置: 删除了模型(所属标签New)[1443],
新增了模型(所属标签New)[2998]
操作人: user@riverolls.com
发布环境: 从DEV发布到PRO`);

  const plan = planAppScreenshotTasks(parsed, {
    targetSnapshot: { groups: [], models: [] },
    historicalModelNamesById: {
      1443: 'Magic World',
      2998: 'Historical Addition Name',
    },
  });
  const task = plan.tasks.find((item) => item.objectName === 'New');

  assert.deepEqual(task.modelAssertions, [
    { id: '1443', name: 'Magic World', expectedState: 'ABSENT' },
    { id: '2998', name: null, expectedState: 'PRESENT' },
  ]);
  assert.equal(plan.planningWarnings.length, 1);
  assert.match(plan.planningWarnings[0], /2998/);
});
