import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeConsistencyChange,
  renderConsistencyTextReport,
} from '../src/consistency-checker.mjs';

function makeReport() {
  return {
    consistent: false,
    notification: {
      operator: 'user@example.com',
      sourceEnvironment: 'DEV',
      targetEnvironment: 'PRO',
      declaredChanges: 2,
    },
    diff: { hasChanges: true },
    summary: {
      declaredAssertions: 2,
      actualAssertions: 2,
      matchedAssertions: 1,
      missingDeclarations: 1,
      unexpectedChanges: 1,
    },
    matches: [{
      declared: { type: 'MODEL_IMAGE_CHANGE', modelName: 'Foo' },
      actual: {
        type: 'MODEL_IMAGE_CHANGE',
        modelName: 'Foo',
        modelId: '10',
        fieldPaths: ['cover_image_url'],
      },
    }],
    missingDeclarations: [{
      type: 'MODEL_ADD',
      tagName: 'New',
      modelId: '1407',
    }],
    unexpectedChanges: [{
      type: 'MODEL_RENAME',
      modelId: '20',
      beforeName: 'Old',
      afterName: 'New',
    }],
  };
}

test('renders a readable Chinese consistency report', () => {
  const output = renderConsistencyTextReport(makeReport());

  assert.match(output, /检查结论：不一致/);
  assert.match(output, /操作人：user@example\.com/);
  assert.match(output, /声明核验项：2/);
  assert.match(output, /已匹配声明（1）/);
  assert.match(output, /标签「New」；模型 ID：1407/);
  assert.match(output, /「Old」→「New」/);
  assert.ok(output.endsWith('\n'));
});

test('describes supported change types and rejects malformed reports', () => {
  assert.equal(
    describeConsistencyChange({ type: 'INTRO_REORDER' }),
    '新手引导页排序变化',
  );
  assert.throws(() => renderConsistencyTextReport(null), {
    name: 'TypeError',
    message: 'Consistency report must be an object',
  });
});
