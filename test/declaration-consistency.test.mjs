import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDeclarationConsistency } from '../src/consistency-checker.mjs';

function messageWith(body) {
  return [
    'AIMirror首屏配置发布成功!',
    body,
    '操作人: user@example.com',
    '发布环境: 从DEV发布到PRO',
  ].join('\n');
}

function diffWith(changes) {
  const all = [
    ...changes.groups,
    ...changes.models,
    ...changes.introPages,
  ];
  return {
    schemaVersion: '1.0',
    diffType: 'PRO_RELEASE_DIFF',
    environment: 'PRO',
    hasChanges: all.length > 0,
    summary: { totalChanges: all.length },
    changes,
  };
}

test('matches all declared changes to actual PRO release changes', () => {
  const notification = messageWith([
    '模版修改: 模型Foo图片改变,',
    '模型Bar有字段改动',
    '新首页配置: 标签New的模型排序改变,',
    '新增了模型(所属标签New)[1, 2],',
    '删除了模型(所属标签New)[3],',
    '标签New的组封面修改',
    '新手引导页配置: 新手引导页顺序发生了变化,',
    '删除新手引导页：intro-old,',
    '修改了新手引导页：intro-edit',
  ].join('\n'));
  const diff = diffWith({
    groups: [
      { type: 'MODEL_REORDER', tagName: 'New', groupId: 'g1' },
      { type: 'MODEL_ADD', tagName: 'New', groupId: 'g1', modelIds: ['1', '2'] },
      { type: 'MODEL_DELETE', tagName: 'New', groupId: 'g1', modelIds: ['3'] },
      { type: 'GROUP_COVER_CHANGE', tagName: 'New', groupId: 'g1' },
    ],
    models: [
      { type: 'MODEL_IMAGE_CHANGE', modelId: '10', modelName: 'Foo', fields: [] },
      { type: 'MODEL_FIELD_CHANGE', modelId: '11', modelName: 'Bar', fields: [] },
    ],
    introPages: [
      { type: 'INTRO_REORDER', beforeIntroIds: [], afterIntroIds: [] },
      { type: 'INTRO_DELETE', page: { id: 'intro-old', title: 'Old' } },
      { type: 'INTRO_MODIFY', introId: 'intro-edit', title: 'Edit', fields: [] },
    ],
  });
  const originalDiff = structuredClone(diff);

  const report = checkDeclarationConsistency({ notification, diff });

  assert.equal(report.consistent, true);
  assert.deepEqual(report.summary, {
    declaredAssertions: 10,
    actualAssertions: 10,
    matchedAssertions: 10,
    missingDeclarations: 0,
    unexpectedChanges: 0,
  });
  assert.deepEqual(report.missingDeclarations, []);
  assert.deepEqual(report.unexpectedChanges, []);
  assert.deepEqual(diff, originalDiff);
});

test('matches a model rename to a declared model field change', () => {
  const notification = messageWith('模版修改: 模型Old Name有字段改动');
  const diff = diffWith({
    groups: [],
    models: [{
      type: 'MODEL_RENAME',
      modelId: '20',
      modelName: 'New Name',
      beforeName: 'Old Name',
      afterName: 'New Name',
    }],
    introPages: [],
  });

  const report = checkDeclarationConsistency({ notification, diff });

  assert.equal(report.consistent, true);
  assert.equal(report.matches[0].actual.type, 'MODEL_RENAME');
});

test('matches separate image and cover-series declarations from one model diff', () => {
  const notification = messageWith([
    '模版修改: 模型Vlog图片改变,',
    '模型Vlog的封面图系列有改动',
  ].join('\n'));
  const diff = diffWith({
    groups: [],
    models: [{
      type: 'MODEL_IMAGE_CHANGE',
      modelId: '30',
      modelName: 'Vlog',
      fields: [
        { path: 'image', before: 'old', after: 'new' },
        { path: 'cover_image_series.0', before: 'old', after: 'new' },
      ],
    }],
    introPages: [],
  });

  const report = checkDeclarationConsistency({ notification, diff });

  assert.equal(report.consistent, true);
  assert.deepEqual(report.summary, {
    declaredAssertions: 2,
    actualAssertions: 2,
    matchedAssertions: 2,
    missingDeclarations: 0,
    unexpectedChanges: 0,
  });
});

test('matches catalog additions by name and skips locale-only declarations', () => {
  const notification = messageWith([
    '模版修改: 新增模型: Paw Hug',
    '国际化配置: 新增国际化模型: 1411',
  ].join('\n'));
  const diff = diffWith({
    groups: [],
    models: [{
      type: 'MODEL_CATALOG_ADD',
      model: { id: '1411', name: 'Paw Hug' },
    }],
    introPages: [],
  });

  const report = checkDeclarationConsistency({ notification, diff });

  assert.equal(report.consistent, true);
  assert.equal(report.summary.declaredAssertions, 1);
  assert.equal(report.summary.actualAssertions, 1);
  assert.equal(report.summary.matchedAssertions, 1);
});

test('accepts a reorder declaration when membership changes alter the model list', () => {
  const notification = messageWith([
    '新首页配置: 标签New的模型排序改变,',
    '新增了模型(所属标签New)[1]',
  ].join('\n'));
  const diff = diffWith({
    groups: [{ type: 'MODEL_ADD', tagName: 'New', modelIds: ['1'] }],
    models: [],
    introPages: [],
  });

  const report = checkDeclarationConsistency({ notification, diff });

  assert.equal(report.consistent, true);
  assert.equal(report.summary.declaredAssertions, 2);
  assert.equal(report.summary.actualAssertions, 1);
  assert.equal(report.summary.matchedAssertions, 2);
  assert.equal(report.matches[0].actual.evidenceFor, 'MODEL_REORDER');
});

test('reports partially missing declarations and undeclared actual changes', () => {
  const notification = messageWith(
    '新首页配置: 新增了模型(所属标签New)[1, 2]',
  );
  const diff = diffWith({
    groups: [
      { type: 'MODEL_ADD', tagName: 'New', modelIds: ['1'] },
      {
        type: 'GROUP_FIELD_CHANGE',
        tagName: 'New',
        groupId: 'g1',
        fields: [{ path: 'fields.enable' }],
      },
    ],
    models: [],
    introPages: [],
  });

  const report = checkDeclarationConsistency({ notification, diff });

  assert.equal(report.consistent, false);
  assert.deepEqual(report.summary, {
    declaredAssertions: 2,
    actualAssertions: 2,
    matchedAssertions: 1,
    missingDeclarations: 1,
    unexpectedChanges: 1,
  });
  assert.equal(report.missingDeclarations[0].modelId, '2');
  assert.equal(report.unexpectedChanges[0].type, 'GROUP_FIELD_CHANGE');
});

test('rejects partial notifications and non-PRO release diffs', () => {
  const partialNotification = messageWith('尚未支持的变更');
  const validDiff = diffWith({ groups: [], models: [], introPages: [] });

  assert.throws(
    () => checkDeclarationConsistency({
      notification: partialNotification,
      diff: validDiff,
    }),
    /notification is not fully parsed/,
  );
  assert.throws(
    () => checkDeclarationConsistency({
      notification: messageWith('模版修改:'),
      diff: { ...validDiff, diffType: 'DEV_PRO_DIFF' },
    }),
    /diffType PRO_RELEASE_DIFF/,
  );
  assert.throws(() => checkDeclarationConsistency(null), {
    name: 'TypeError',
    message: 'Consistency check input must be an object',
  });
});
