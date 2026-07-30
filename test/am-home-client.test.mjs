import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchHomeSnapshot } from '../src/am-home-client.mjs';

test('fetches and standardizes AM home config with missing-reference diagnostics', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = url.includes('/config/v4')
      ? {
          model_url: '/models.json',
          tabs: [{
            tab_id: 'group-1',
            tab_name: 'New',
            model_id_list: [1, 2],
            select_cover_image_indexes: [],
          }],
          intro_list: [],
        }
      : [{ model_id: 1, model_name: 'One' }];
    return { ok: true, status: 200, statusText: 'OK', json: async () => body };
  };

  const result = await fetchHomeSnapshot('DEV', {
    uid: 'uid-1',
    fetchImpl,
    baseUrls: { DEV: 'https://dev.example.test', PRO: 'https://pro.example.test' },
  });

  assert.equal(result.snapshot.environment, 'DEV');
  assert.equal(result.snapshot.counts.groups, 1);
  assert.equal(result.snapshot.counts.models, 1);
  assert.equal(result.config.model_url, '/models.json');
  assert.deepEqual(result.models, [{ model_id: 1, model_name: 'One' }]);
  assert.match(result.queriedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.missingModelReferences.count, 1);
  assert.deepEqual(result.missingModelReferences.uniqueModelIds, ['2']);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/config\/v4\?uid=uid-1/);
  assert.equal(calls[0].options.headers.UID, 'uid-1');
});
