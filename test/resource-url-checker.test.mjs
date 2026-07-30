import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkChangedResourceUrls,
  extractChangedResourceUrls,
  renderResourceUrlTextReport,
} from '../src/resource-checker.mjs';

function makeDiff() {
  return {
    diffType: 'PRO_RELEASE_DIFF',
    environment: 'PRO',
    changes: {
      groups: [{
        type: 'GROUP_COVER_CHANGE',
        afterSelectedCovers: [{
          modelId: '1',
          selectedIndex: 0,
          resource: {
            gen_image: 'https://cdn.example.com/a.jpg',
            gen_image_blur_hash: 'not-a-url',
          },
        }],
      }],
      models: [{
        type: 'MODEL_IMAGE_CHANGE',
        fields: [
          {
            path: 'cover_image_series',
            afterExists: true,
            after: [
              'https://cdn.example.com/a.jpg',
              'https://cdn.example.com/b.jpg',
            ],
          },
          {
            path: 'logo_image_url',
            afterExists: true,
            after: 'broken-url',
          },
          {
            path: 'cover_image_blur_hash',
            afterExists: true,
            after: 'blur-hash-is-not-a-url',
          },
        ],
      }],
      introPages: [{
        type: 'INTRO_MODIFY',
        fields: [{
          path: 'cover',
          afterExists: true,
          after: 'https://cdn.example.com/b.jpg',
        }],
      }],
    },
  };
}

function response(status, url, contentType = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : '',
    url,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    body: { async cancel() {} },
  };
}

test('extracts, deduplicates, and locates changed resource URLs', () => {
  const extracted = extractChangedResourceUrls(makeDiff());

  assert.equal(extracted.changesScanned, 3);
  assert.deepEqual(
    extracted.resources.map(({ url }) => url),
    [
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
    ],
  );
  assert.equal(extracted.resources[0].references.length, 2);
  assert.equal(extracted.resources[1].references.length, 2);
  assert.deepEqual(
    extracted.invalidResources.map(({ value }) => value),
    ['broken-url'],
  );
});

test('checks URLs with HEAD and falls back to ranged GET', async () => {
  const diff = makeDiff();
  diff.changes.models[0].fields.push({
    path: 'video_compare_url',
    afterExists: true,
    after: 'https://cdn.example.com/fail.mp4',
  });
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith('/a.jpg')) {
      return response(200, url, 'image/jpeg');
    }
    if (url.endsWith('/b.jpg') && options.method === 'HEAD') {
      return response(405, url);
    }
    if (url.endsWith('/b.jpg')) {
      return response(206, url, 'image/jpeg');
    }
    throw new Error('connection refused');
  };

  const report = await checkChangedResourceUrls(diff, {
    fetchImpl: fakeFetch,
    concurrency: 2,
    timeoutMs: 1000,
    retryDelaysMs: [],
  });

  assert.equal(report.passed, false);
  assert.deepEqual(report.summary, {
    changesScanned: 3,
    resourceReferences: 5,
    uniqueUrls: 3,
    passed: 2,
    failed: 1,
    invalid: 1,
    totalAttempts: 3,
    retryAttempts: 0,
  });
  assert.ok(calls.some(({ url, method }) =>
    url.endsWith('/b.jpg') && method === 'GET',
  ));
  assert.match(
    report.results.find(({ url }) => url.endsWith('/fail.mp4')).error,
    /connection refused/,
  );
});


test('retries failures after the configured 10/30/60 second schedule', async () => {
  const diff = {
    diffType: 'PRO_RELEASE_DIFF',
    environment: 'PRO',
    changes: {
      groups: [],
      models: [{
        type: 'MODEL_IMAGE_CHANGE',
        fields: [{
          path: 'cover_image_url',
          afterExists: true,
          after: 'https://cdn.example.com/retry.jpg',
        }],
      }],
      introPages: [],
    },
  };
  const waits = [];
  let requests = 0;
  const report = await checkChangedResourceUrls(diff, {
    fetchImpl: async (url) => {
      requests += 1;
      return response(503, url);
    },
    retryDelaysMs: [10000, 30000, 60000],
    sleepImpl: async (delay) => waits.push(delay),
  });

  assert.equal(requests, 4);
  assert.deepEqual(waits, [10000, 30000, 60000]);
  assert.equal(report.results[0].retryCount, 3);
  assert.equal(report.results[0].attempts.length, 4);
  assert.equal(report.summary.totalAttempts, 4);
  assert.equal(report.summary.retryAttempts, 3);
  assert.deepEqual(report.retryDelaysMs, [10000, 30000, 60000]);
  assert.match(renderResourceUrlTextReport(report), /10 秒 \/ 30 秒 \/ 60 秒/);
});

test('passes an empty diff without making network requests', async () => {
  const diff = {
    diffType: 'PRO_RELEASE_DIFF',
    environment: 'PRO',
    changes: { groups: [], models: [], introPages: [] },
  };
  let calls = 0;
  const report = await checkChangedResourceUrls(diff, {
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not be called');
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.summary.uniqueUrls, 0);
  assert.equal(calls, 0);
  assert.match(renderResourceUrlTextReport(report), /没有需要检查的新 URL/);
});

test('rejects malformed diff and options', async () => {
  assert.throws(() => extractChangedResourceUrls(null), {
    name: 'TypeError',
    message: 'diff must be a configuration diff report',
  });
  await assert.rejects(
    () => checkChangedResourceUrls(
      { changes: { groups: [], models: [], introPages: [] } },
      { concurrency: 0 },
    ),
    /concurrency must be a positive integer/,
  );
  await assert.rejects(
    () => checkChangedResourceUrls(
      { changes: { groups: [], models: [], introPages: [] } },
      { retryDelaysMs: [10000, -1] },
    ),
    /retryDelaysMs must contain non-negative numbers/,
  );
});
