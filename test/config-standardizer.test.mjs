import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SNAPSHOT_SCHEMA_VERSION,
  standardizeConfigSnapshot,
  standardizeHomeConfig,
} from '../src/standardizer.mjs';

function makeInput() {
  return {
    environment: ' dev ',
    config: {
      last_update_time: 1784531819,
      version: 4,
      model_url: 'https://example.com/models.json',
      tabs: [
        {
          tab_id: 100,
          tab_name: ' New ',
          local_tab_name: ' New ',
          model_id_list: [1407, '1406'],
          select_cover_image_indexes: [1, 0],
          support_platforms: ['ios', 'android'],
          enable: true,
        },
      ],
      ai_video_tabs: [],
      ai_filter_tabs: [],
      ai_editor_tabs: [],
      intro_list: [
        {
          intro_page_config_id: 'intro_2',
          title: 'Second',
          model_id: 976,
          support_platforms: ['ios', 'android'],
          cover: 'second.jpg',
        },
        {
          intro_page_config_id: 'intro_1',
          title: 'First',
          model_id: '1406',
          cover: 'first.jpg',
        },
      ],
    },
    models: {
      data: [
        {
          model_id: 1407,
          model_name: ' Chat Edit ',
          cover_image_url: 'cover-1407.jpg',
          cover_image_series: ['second.jpg', 'first.jpg'],
          support_platforms: ['ios', 'android'],
          support_sizes: ['1024x1536', '1536x1024'],
          creator_id: 42,
          is_free: false,
        },
        {
          model_id: '1406',
          model_name: 'Heaven Reach',
          logo_image_url: 'logo-1406.png',
          support_stores: ['google_play', 'app_store'],
          is_free: true,
        },
      ],
    },
  };
}

test('standardizes groups, models, and intro pages without mutating input', () => {
  const input = makeInput();
  const original = structuredClone(input);
  const result = standardizeConfigSnapshot(input);

  assert.deepEqual(input, original);
  assert.equal(result.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(result.snapshotType, 'AM_HOME_CONFIG');
  assert.equal(result.environment, 'DEV');
  assert.equal(result.valid, true);
  assert.deepEqual(result.counts, { groups: 1, models: 2, introPages: 2 });

  assert.deepEqual(result.groups[0].modelIds, ['1407', '1406']);
  assert.deepEqual(result.groups[0].coverSelection, [1, 0]);
  assert.equal(result.groups[0].name, 'New');
  assert.deepEqual(result.groups[0].fields.support_platforms, ['android', 'ios']);

  assert.deepEqual(result.models.map(({ id }) => id), ['1406', '1407']);
  assert.equal(result.models[1].name, 'Chat Edit');
  assert.equal(result.models[1].images.cover_image_url, 'cover-1407.jpg');
  assert.equal(result.models[1].fields.creator_id, '42');
  assert.deepEqual(result.models[1].fields.support_platforms, ['android', 'ios']);
  assert.deepEqual(
    result.models[1].fields.support_sizes,
    ['1024x1536', '1536x1024'],
  );

  assert.deepEqual(result.introPages.map(({ id }) => id), ['intro_2', 'intro_1']);
  assert.equal(result.introPages[0].fields.model_id, '976');
  assert.deepEqual(
    result.introPages[0].fields.support_platforms,
    ['android', 'ios'],
  );
});

test('removes catalog and set-like transport ordering noise', () => {
  const firstInput = makeInput();
  const secondInput = makeInput();
  secondInput.models.data.reverse();
  secondInput.models.data[0].support_stores.reverse();
  secondInput.models.data[1].support_platforms.reverse();
  secondInput.config.tabs[0].support_platforms.reverse();
  secondInput.config.intro_list[0].support_platforms.reverse();

  assert.deepEqual(
    standardizeConfigSnapshot(firstInput),
    standardizeConfigSnapshot(secondInput),
  );
});

test('preserves semantic group model and intro page ordering', () => {
  const firstInput = makeInput();
  const secondInput = makeInput();
  secondInput.config.tabs[0].model_id_list.reverse();
  secondInput.config.intro_list.reverse();

  const first = standardizeConfigSnapshot(firstInput);
  const second = standardizeConfigSnapshot(secondInput);

  assert.notDeepEqual(first.groups[0].modelIds, second.groups[0].modelIds);
  assert.notDeepEqual(
    first.introPages.map(({ id }) => id),
    second.introPages.map(({ id }) => id),
  );
});

test('supports the homeConfig alias and models payload shape', () => {
  const input = makeInput();
  const result = standardizeHomeConfig({
    homeConfig: input.config,
    models: { models: input.models.data },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.counts, { groups: 1, models: 2, introPages: 2 });
});

test('reports duplicate stable identifiers', () => {
  const input = makeInput();
  input.config.tabs.push(structuredClone(input.config.tabs[0]));
  input.config.intro_list.push(structuredClone(input.config.intro_list[0]));
  input.models.data.push(structuredClone(input.models.data[0]));

  const result = standardizeConfigSnapshot(input);

  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.errors.includes('分组标识重复: TABS:100'));
  assert.ok(result.diagnostics.errors.includes('模型 ID 重复: 1407'));
  assert.ok(result.diagnostics.errors.includes('新手引导页 ID 重复: intro_2'));
});

test('rejects malformed top-level inputs', () => {
  assert.throws(() => standardizeConfigSnapshot(null), {
    name: 'TypeError',
    message: 'Standardizer input must be an object',
  });
  assert.throws(() => standardizeConfigSnapshot({ config: {}, models: {} }), {
    name: 'TypeError',
    message: 'models must be an array or an object containing models/data',
  });
  assert.throws(() => standardizeConfigSnapshot({ config: {} }), {
    name: 'TypeError',
    message: 'models is required',
  });
});
