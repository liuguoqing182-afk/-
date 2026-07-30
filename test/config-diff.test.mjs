import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diffConfigSnapshots,
  diffDevPro,
  diffProRelease,
} from '../src/diff.mjs';
import { standardizeConfigSnapshot } from '../src/standardizer.mjs';

function makeRawSnapshot() {
  return {
    config: {
      last_update_time: 100,
      version: 4,
      model_url: 'before-models.json',
      tabs: [
        {
          tab_id: 'group-1',
          tab_name: 'New',
          local_tab_name: 'New',
          model_id_list: ['1', '2', '3'],
          select_cover_image_indexes: [0, 0, 0],
          enable: true,
        },
      ],
      ai_video_tabs: [],
      ai_filter_tabs: [],
      ai_editor_tabs: [],
      intro_list: [
        { intro_page_config_id: 'intro-0', title: 'Zero', model_id: '1' },
        { intro_page_config_id: 'intro-1', title: 'One', model_id: '1' },
        { intro_page_config_id: 'intro-2', title: 'Two', model_id: '2' },
      ],
    },
    models: [
      { model_id: '1', model_name: 'First', cover_image_url: 'old.jpg', is_free: true },
      { model_id: '2', model_name: 'Second', is_free: true },
      { model_id: '3', model_name: 'Third', is_free: false },
    ],
  };
}

function makeChangedRawSnapshot() {
  const result = makeRawSnapshot();
  result.config.last_update_time = 200;
  result.config.model_url = 'after-models.json';
  result.config.tabs[0].model_id_list = ['2', '1', '4'];
  result.config.tabs[0].select_cover_image_indexes = [1, 0, 0];
  result.config.tabs[0].enable = false;
  result.config.intro_list = [
    { intro_page_config_id: 'intro-2', title: 'Two updated', model_id: '2' },
    { intro_page_config_id: 'intro-1', title: 'One', model_id: '1' },
    { intro_page_config_id: 'intro-3', title: 'Three', model_id: '4' },
  ];
  result.models = [
    { model_id: '1', model_name: 'First', cover_image_url: 'new.jpg', is_free: false },
    { model_id: '2', model_name: 'Second renamed', is_free: true },
    { model_id: '4', model_name: 'Fourth', is_free: true },
  ];
  return result;
}

test('ignores metadata and catalog transport-order changes', () => {
  const beforeRaw = makeRawSnapshot();
  const afterRaw = makeRawSnapshot();
  afterRaw.config.last_update_time = 999;
  afterRaw.config.model_url = 'another-url.json';
  afterRaw.models.reverse();

  const report = diffProRelease({ before: beforeRaw, after: afterRaw });

  assert.equal(report.diffType, 'PRO_RELEASE_DIFF');
  assert.equal(report.environment, 'PRO');
  assert.equal(report.hasChanges, false);
  assert.deepEqual(report.summary.byType, {});
  assert.equal(report.summary.totalChanges, 0);
});

test('PRO release diff filters creator IDs but keeps business changes', () => {
  const before = makeRawSnapshot();
  const after = makeRawSnapshot();
  for (const model of before.models) model.creator_id = 'before-creator';
  for (const model of after.models) model.creator_id = 'after-creator';
  after.models[0].model_name = 'First published';

  const report = diffProRelease({ before, after });

  assert.equal(report.diffType, 'PRO_RELEASE_DIFF');
  assert.deepEqual(report.summary.byType, { MODEL_RENAME: 1 });
  assert.equal(report.ignoredDifferences.fieldCount, 3);
  assert.equal(report.ignoredDifferences.removedChanges, 3);
  assert.deepEqual(report.ignoredDifferences.byType, { MODEL_FIELD_CHANGE: 3 });
});

test('classifies all supported release changes', () => {
  const report = diffProRelease({
    before: makeRawSnapshot(),
    after: makeChangedRawSnapshot(),
  });

  assert.equal(report.hasChanges, true);
  assert.deepEqual(report.summary.byType, {
    GROUP_COVER_CHANGE: 1,
    GROUP_FIELD_CHANGE: 1,
    INTRO_ADD: 1,
    INTRO_DELETE: 1,
    INTRO_MODIFY: 1,
    INTRO_REORDER: 1,
    MODEL_ADD: 1,
    MODEL_CATALOG_ADD: 1,
    MODEL_CATALOG_DELETE: 1,
    MODEL_DELETE: 1,
    MODEL_FIELD_CHANGE: 1,
    MODEL_IMAGE_CHANGE: 1,
    MODEL_RENAME: 1,
    MODEL_REORDER: 1,
  });

  const add = report.changes.groups.find(({ type }) => type === 'MODEL_ADD');
  const remove = report.changes.groups.find(({ type }) => type === 'MODEL_DELETE');
  assert.deepEqual(add.modelIds, ['4']);
  assert.deepEqual(remove.modelIds, ['3']);

  const modelField = report.changes.models.find(
    ({ type }) => type === 'MODEL_FIELD_CHANGE',
  );
  assert.deepEqual(modelField.fields.map(({ path }) => path), ['is_free']);
  const introModify = report.changes.introPages.find(
    ({ type }) => type === 'INTRO_MODIFY',
  );
  assert.equal(introModify.introId, 'intro-2');
  assert.deepEqual(introModify.fields.map(({ path }) => path), ['title']);
});

test('reports added, removed, and reordered groups', () => {
  const beforeRaw = makeRawSnapshot();
  beforeRaw.config.tabs.push({
    tab_id: 'old-group',
    tab_name: 'Old',
    model_id_list: [],
  });
  const afterRaw = makeRawSnapshot();
  afterRaw.config.tabs = [
    {
      tab_id: 'new-group',
      tab_name: 'New group',
      model_id_list: [],
    },
    afterRaw.config.tabs[0],
  ];

  const report = diffProRelease({ before: beforeRaw, after: afterRaw });

  assert.deepEqual(report.summary.byType, {
    GROUP_ADD: 1,
    GROUP_DELETE: 1,
    GROUP_REORDER: 1,
  });
});

test('compares already-standardized snapshots without mutating them', () => {
  const before = standardizeConfigSnapshot({
    ...makeRawSnapshot(),
    environment: 'PRO',
  });
  const after = standardizeConfigSnapshot({
    ...makeChangedRawSnapshot(),
    environment: 'PRO',
  });
  const originalBefore = structuredClone(before);
  const originalAfter = structuredClone(after);

  const report = diffConfigSnapshots(before, after);

  assert.equal(report.diffType, 'AM_HOME_CONFIG_DIFF');
  assert.deepEqual(before, originalBefore);
  assert.deepEqual(after, originalAfter);
});

test('rejects non-PRO and invalid inputs', () => {
  const devSnapshot = standardizeConfigSnapshot({
    ...makeRawSnapshot(),
    environment: 'DEV',
  });
  assert.throws(
    () => diffProRelease({ before: devSnapshot, after: devSnapshot }),
    /environment must be PRO/,
  );
  assert.throws(() => diffProRelease(null), {
    name: 'TypeError',
    message: 'PRO diff input must be an object',
  });
});

test('DEV/PRO diff filters creator IDs but reports ignored differences', () => {
  const dev = makeRawSnapshot();
  const pro = makeRawSnapshot();
  for (const model of dev.models) model.creator_id = 'dev-creator';
  for (const model of pro.models) model.creator_id = 'pro-creator';
  pro.models[0].model_name = 'First published';

  const report = diffDevPro({ dev, pro });

  assert.equal(report.diffType, 'DEV_PRO_DIFF');
  assert.equal(report.environment, 'DEV→PRO');
  assert.equal(report.hasChanges, true);
  assert.deepEqual(report.summary.byType, { MODEL_RENAME: 1 });
  assert.deepEqual(report.ignoredDifferences, {
    fieldCount: 3,
    removedChanges: 3,
    byType: { MODEL_FIELD_CHANGE: 3 },
    rules: {
      groupFields: [],
      modelFields: ['creator_id'],
      modelImages: [],
      introFields: [],
    },
  });
});

test('DEV/PRO diff can include creator IDs when explicitly requested', () => {
  const dev = makeRawSnapshot();
  const pro = makeRawSnapshot();
  for (const model of dev.models) model.creator_id = 'dev-creator';
  for (const model of pro.models) model.creator_id = 'pro-creator';

  const report = diffDevPro(
    { dev, pro },
    { ignoredModelFieldPaths: [] },
  );

  assert.equal(report.summary.byType.MODEL_FIELD_CHANGE, 3);
  assert.equal(report.ignoredDifferences.fieldCount, 0);
});

test('DEV/PRO diff validates direction and input', () => {
  const proSnapshot = standardizeConfigSnapshot({
    ...makeRawSnapshot(),
    environment: 'PRO',
  });
  assert.throws(
    () => diffDevPro({ dev: proSnapshot, pro: proSnapshot }),
    /dev environment must be DEV/,
  );
  assert.throws(() => diffDevPro(null), {
    name: 'TypeError',
    message: 'DEV/PRO diff input must be an object',
  });
});
