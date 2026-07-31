import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePublishNotification } from '../src/message-parser.mjs';

test('parses all supported AM publish change types', () => {
  const message = `AIMirror首屏配置发布成功!
模版修改:
模型Chat Edit图片改变,
模型Chat Edit的封面图系列有改动,
模型Chat Edit有字段改动,
模型Heaven Reach有字段改动
新首页配置:
标签New的模型排序改变,
新增了模型(所属标签New)[1407, 1406],
删除了模型（所属标签New）[1385],
标签New的组封面修改
新手引导页配置:
新手引导页顺序发生了变化,
删除新手引导页：intro_1771062803865,
修改了新手引导页：intro_1763023634601
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`;

  const result = parsePublishNotification(message);

  assert.equal(result.valid, true);
  assert.equal(result.operator, 'wuzhenzhen@riverolls.com');
  assert.equal(result.sourceEnvironment, 'DEV');
  assert.equal(result.targetEnvironment, 'PRO');
  assert.deepEqual(result.templateSections, [
    '模版修改',
    '新首页配置',
    '新手引导页配置',
  ]);
  assert.deepEqual(
    result.declaredChanges.map(({ type }) => type),
    [
      'MODEL_IMAGE_CHANGE',
      'MODEL_COVER_SERIES_CHANGE',
      'MODEL_FIELD_CHANGE',
      'MODEL_FIELD_CHANGE',
      'MODEL_REORDER',
      'MODEL_ADD',
      'MODEL_DELETE',
      'GROUP_COVER_CHANGE',
      'INTRO_REORDER',
      'INTRO_DELETE',
      'INTRO_MODIFY',
    ],
  );
  assert.deepEqual(result.declaredChanges[5].modelIds, ['1407', '1406']);
  assert.deepEqual(result.unparsedLines, []);
  assert.equal(result.fullyParsed, true);
});

test('accepts a successful notification with no declared changes', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改:
新首页配置:
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`);

  assert.equal(result.valid, true);
  assert.deepEqual(result.declaredChanges, []);
  assert.deepEqual(result.unparsedLines, []);
});

test('reports unsupported publish directions and preserves unknown lines', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
未知配置发生改变
操作人: user@example.com
发布环境: 从TEST发布到PRO`);

  assert.equal(result.valid, false);
  assert.equal(result.fullyParsed, false);
  assert.match(result.errors[0], /仅支持 DEV→PRO/);
  assert.deepEqual(result.unparsedLines, ['未知配置发生改变']);
});

test('accepts CR line endings, list markers, and the alternate 模板 spelling', () => {
  const result = parsePublishNotification(
    'AIMirror首屏配置发布成功！\r' +
      '模板修改：模型Chat Edit图片改变；\r' +
      '- 模型Chat Edit有字段改动。\r' +
      '操作人：user@example.com\r' +
      '发布环境：从DEV发布到PRO',
  );

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.deepEqual(
    result.declaredChanges.map(({ type }) => type),
    ['MODEL_IMAGE_CHANGE', 'MODEL_FIELD_CHANGE'],
  );
  assert.deepEqual(result.templateSections, ['模版修改']);
});

test('ignores Feishu image and expand artifacts after a publish notification', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改: 新增模型: Tiny Cleaner
操作人: [wuzhenzhen@riverolls.com](mailto:wuzhenzhen@riverolls.com)
发布环境: 从DEV发布到PRO
[图片]
展开`);

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.equal(result.operator, 'wuzhenzhen@riverolls.com');
  assert.deepEqual(result.unparsedLines, []);
});

test('restores boundaries in a Feishu notification flattened to one line', () => {
  const result = parsePublishNotification(
    'AIMirror首屏配置发布成功! 模版修改: 新增模型: Tiny Cleaner, ' +
      '新增模型: Lux Yacht More Style AI Filter配置: ' +
      '标签Baby的模型排序改变, 新增了模型(所属标签Baby)[980], ' +
      '标签Baby的组封面修改 国际化配置: 新增国际化模型: 980 ' +
      '操作人: [wuzhenzhen@riverolls.com](mailto:wuzhenzhen@riverolls.com) ' +
      '发布环境: 从DEV发布到PRO [图片] 展开',
  );

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.equal(result.operator, 'wuzhenzhen@riverolls.com');
  assert.deepEqual(result.templateSections, [
    '模版修改',
    'More Style AI Filter配置',
  ]);
  assert.deepEqual(
    result.declaredChanges.map(({ type }) => type),
    [
      'MODEL_CATALOG_ADD',
      'MODEL_CATALOG_ADD',
      'MODEL_REORDER',
      'MODEL_ADD',
      'GROUP_COVER_CHANGE',
    ],
  );
  assert.deepEqual(result.unparsedLines, []);
});

test('parses the current multi-section publish notification format', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改: 新增模型: Paw Hug,
新增模型: Film Record
More Style AI Filter配置: 标签Retro的模型排序改变,
新增了模型(所属标签Retro)[1412],
标签Retro的组封面修改
国际化配置: 新增国际化模型: 1411,
新增国际化模型: 1412
新首页配置: 标签Best Companion的模型排序改变,
新增了模型(所属标签Best Companion)[1411]
More Style Video配置: 标签Seedance 2.0的模型排序改变,
新增了模型(所属标签Seedance 2.0)[22034, 22032]
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`);

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.deepEqual(result.templateSections, [
    '模版修改',
    'More Style AI Filter配置',
    '新首页配置',
    'More Style Video配置',
  ]);
  assert.deepEqual(
    result.declaredChanges.map(({ type }) => type),
    [
      'MODEL_CATALOG_ADD',
      'MODEL_CATALOG_ADD',
      'MODEL_REORDER',
      'MODEL_ADD',
      'GROUP_COVER_CHANGE',
      'MODEL_REORDER',
      'MODEL_ADD',
      'MODEL_REORDER',
      'MODEL_ADD',
    ],
  );
});

test('joins metadata labels and values split by an interactive card', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改:
模型Farewell Paw图片改变
操作人:
wuzhenzhen@riverolls.com
发布环境:
从DEV发布到PRO`);

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.equal(result.operator, 'wuzhenzhen@riverolls.com');
  assert.equal(result.sourceEnvironment, 'DEV');
  assert.equal(result.targetEnvironment, 'PRO');
});


test('ignores the entire i18n section while parsing later sections', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
国际化配置: 修改了国际化模型: 898
新首页配置: inspire:✨ Inspiration的排序改变
More Style Editor配置: 增加标签: AI Better,
标签Chat Edit的组封面修改
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`);

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.deepEqual(result.unparsedLines, []);
  assert.deepEqual(result.templateSections, [
    '新首页配置',
    'More Style Editor配置',
  ]);
  assert.deepEqual(
    result.declaredChanges.map(({ type, template }) => ({ type, template })),
    [
      { type: 'INSPIRATION_REORDER', template: '新首页配置' },
      { type: 'GROUP_ADD', template: 'More Style Editor配置' },
      { type: 'GROUP_COVER_CHANGE', template: 'More Style Editor配置' },
    ],
  );
});


test('ignores every line in an i18n-only section without reporting parse errors', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
国际化配置:
新增国际化模型: 22038,
修改了国际化模型: 898,
任意未来国际化格式也直接忽略
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`);

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.deepEqual(result.templateSections, []);
  assert.deepEqual(result.declaredChanges, []);
  assert.deepEqual(result.unparsedLines, []);
});

test('ignores splash-screen changes while parsing the following release sections', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
模版修改: 新增模型: Pool Triumph,
新增模型: Street Rap
开屏设置改动:
开屏图[1754045335435] ,封面图/视频改变了 ,标题改变了 ,副标题改变了 ,跳转参数改变了,
开屏图[1735890389820] ,封面图/视频改变了 ,标题改变了 ,类型改变了 ,副标题改变了 ,跳转参数改变了,
开屏图[1751624202105] ,封面图/视频改变了 ,标题改变了 ,副标题改变了 ,跳转参数改变了
More Style AI Filter配置: 标签Studio的模型排序改变,
新增了模型(所属标签Studio)[3022, 3021],
标签Studio的组封面修改
国际化配置: 新增国际化模型: 3022
新首页配置: 标签Trend Hub的模型排序改变,
新增了模型(所属标签Trend Hub)[3022, 3021, 20489]
More Style Video配置: 标签Viral Dance的模型排序改变,
新增了模型(所属标签Viral Dance)[20489]
操作人: wuzhenzhen@riverolls.com
发布环境: 从DEV发布到PRO`);

  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.deepEqual(result.unparsedLines, []);
  assert.deepEqual(result.templateSections, [
    '模版修改',
    'More Style AI Filter配置',
    '新首页配置',
    'More Style Video配置',
  ]);
  assert.deepEqual(
    result.declaredChanges.map(({ type }) => type),
    [
      'MODEL_CATALOG_ADD',
      'MODEL_CATALOG_ADD',
      'MODEL_REORDER',
      'MODEL_ADD',
      'GROUP_COVER_CHANGE',
      'MODEL_REORDER',
      'MODEL_ADD',
      'MODEL_REORDER',
      'MODEL_ADD',
    ],
  );
});
