import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { parsePublishNotification } from '../src/publish-message-parser.mjs';

test('parses changes placed on section heading lines', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改: 模型Chat Edit图片改变,
模型Chat Edit有字段改动,
新首页配置: 标签Fun Pack的模型排序改变,
新增了模型(所属标签Fun Pack)[1568, 783],
新手引导页配置: 新手引导页顺序发生了变化,
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`);

  assert.equal(result.valid, true);
  assert.deepEqual(
    result.declaredChanges.map(({ type }) => type),
    [
      'MODEL_IMAGE_CHANGE',
      'MODEL_FIELD_CHANGE',
      'MODEL_REORDER',
      'MODEL_ADD',
      'INTRO_REORDER',
    ],
  );
  assert.deepEqual(result.declaredChanges[3].modelIds, ['1568', '783']);
  assert.deepEqual(result.unparsedLines, []);
});

test('parses the captured Feishu fixture completely', async () => {
  const fixtureUrl = new URL('../fixtures/publish-message.txt', import.meta.url);
  const message = await fs.readFile(fixtureUrl, 'utf8');
  const result = parsePublishNotification(message);

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.equal(result.declaredChanges.length, 10);
  assert.deepEqual(result.unparsedLines, []);
});

