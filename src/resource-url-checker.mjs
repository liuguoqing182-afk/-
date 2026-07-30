export const RESOURCE_URL_CHECK_SCHEMA_VERSION = '1.0';
export const DEFAULT_RESOURCE_RETRY_DELAYS_MS = Object.freeze([
  10000,
  30000,
  60000,
]);

const EXTRA_RESOURCE_FIELDS = [
  'afterImages',
  'afterFields',
  'afterSelectedCovers',
  'afterResources',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateDiff(diff) {
  if (!isRecord(diff) || !isRecord(diff.changes)) {
    throw new TypeError('diff must be a configuration diff report');
  }
  for (const category of ['groups', 'models', 'introPages']) {
    if (!Array.isArray(diff.changes[category])) {
      throw new TypeError('diff.changes.' + category + ' must be an array');
    }
  }
}

function resourceFieldName(path) {
  return path
    .replace(/\[\d+\]/g, '')
    .split('.')
    .at(-1)
    ?.toLowerCase() ?? '';
}

function isResourcePath(path) {
  const field = resourceFieldName(path);
  if (
    /(?:blur_hash|background_color|width_height_ratio|index|indexes)$/.test(field)
  ) {
    return false;
  }
  return (
    field === 'cover' ||
    field === 'gen_image' ||
    field === 'original_image' ||
    field === 'more_style_image' ||
    field === 'cover_image_series' ||
    /(?:_url|url|_uri|uri|_src|src)$/.test(field)
  );
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function addReference(resourceMap, url, reference) {
  const existing = resourceMap.get(url);
  if (existing) {
    existing.references.push(reference);
  } else {
    resourceMap.set(url, { url, references: [reference] });
  }
}

function collectCandidates(
  value,
  path,
  resourceContext,
  referenceBase,
  resourceMap,
  invalidResources,
) {
  if (value === null || value === undefined || value === '') return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const looksLikeHttp = /^https?:\/\//i.test(trimmed);
    if (!resourceContext && !looksLikeHttp) return;
    const reference = { ...referenceBase, path };
    const url = normalizeHttpUrl(trimmed);
    if (url) {
      addReference(resourceMap, url, reference);
    } else {
      invalidResources.push({ value: trimmed, reference });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectCandidates(
        item,
        path + '[' + index + ']',
        resourceContext,
        referenceBase,
        resourceMap,
        invalidResources,
      ),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? path + '.' + key : key;
      collectCandidates(
        child,
        childPath,
        isResourcePath(childPath),
        referenceBase,
        resourceMap,
        invalidResources,
      );
    }
  }
}

/**
 * Extract every new/changed HTTP resource from a diff. Removed URLs are not
 * checked because they are no longer referenced after publication.
 */
export function extractChangedResourceUrls(diff) {
  validateDiff(diff);
  const resourceMap = new Map();
  const invalidResources = [];
  let changesScanned = 0;

  for (const category of ['groups', 'models', 'introPages']) {
    for (const [changeIndex, change] of diff.changes[category].entries()) {
      changesScanned += 1;
      const referenceBase = {
        category,
        changeType: change.type ?? 'UNKNOWN',
        changeIndex,
      };

      for (const field of change.fields ?? []) {
        if (!isRecord(field) || field.afterExists === false) continue;
        if (!Object.hasOwn(field, 'after')) continue;
        collectCandidates(
          field.after,
          field.path ?? '$',
          isResourcePath(field.path ?? ''),
          referenceBase,
          resourceMap,
          invalidResources,
        );
      }

      for (const fieldName of EXTRA_RESOURCE_FIELDS) {
        if (!Object.hasOwn(change, fieldName)) continue;
        collectCandidates(
          change[fieldName],
          fieldName,
          false,
          referenceBase,
          resourceMap,
          invalidResources,
        );
      }
    }
  }

  return {
    changesScanned,
    resources: [...resourceMap.values()],
    invalidResources,
  };
}

async function cancelBody(response) {
  try {
    await response?.body?.cancel();
  } catch {
    // The headers and status are enough for this check.
  }
}

async function fetchResource(url, fetchImpl, signal) {
  let response = await fetchImpl(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal,
  });
  let method = 'HEAD';

  if ([403, 405, 501].includes(response.status)) {
    await cancelBody(response);
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      signal,
    });
    method = 'GET';
  }
  await cancelBody(response);
  return { response, method };
}

async function runResourceAttempt(resource, options, attempt) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const { response, method } = await fetchResource(
      resource.url,
      options.fetchImpl,
      controller.signal,
    );
    return {
      attempt,
      ok: response.ok,
      method,
      status: response.status,
      statusText: response.statusText || null,
      contentType: response.headers?.get?.('content-type') ?? null,
      finalUrl: response.url || resource.url,
      durationMs: Date.now() - startedAt,
      error: response.ok ? null : 'HTTP ' + response.status,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      attempt,
      ok: false,
      method: null,
      status: null,
      statusText: null,
      contentType: null,
      finalUrl: null,
      durationMs: Date.now() - startedAt,
      error: timedOut
        ? '请求超时（' + options.timeoutMs + 'ms）'
        : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function checkOneResource(resource, options) {
  const startedAt = Date.now();
  const attempts = [];

  for (let index = 0; index <= options.retryDelaysMs.length; index += 1) {
    const attempt = await runResourceAttempt(resource, options, index + 1);
    attempts.push(attempt);
    if (attempt.ok) break;
    if (index < options.retryDelaysMs.length) {
      await options.sleepImpl(options.retryDelaysMs[index]);
    }
  }

  const lastAttempt = attempts.at(-1);
  return {
    ...resource,
    ...lastAttempt,
    retryCount: attempts.length - 1,
    totalDurationMs: Date.now() - startedAt,
    attempts,
  };
}

async function checkWithConcurrency(resources, options) {
  const results = new Array(resources.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < resources.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await checkOneResource(resources[index], options);
    }
  }

  const workerCount = Math.min(options.concurrency, resources.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Check syntax and HTTP reachability of every changed resource URL. */
export async function checkChangedResourceUrls(diff, options = {}) {
  const extracted = extractChangedResourceUrls(diff);
  const timeoutMs = options.timeoutMs ?? 10000;
  const concurrency = options.concurrency ?? 5;
  const retryDelaysMs =
    options.retryDelaysMs ?? DEFAULT_RESOURCE_RETRY_DELAYS_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive number');
  }
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new TypeError('concurrency must be a positive integer');
  }
  if (
    !Array.isArray(retryDelaysMs) ||
    retryDelaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)
  ) {
    throw new TypeError('retryDelaysMs must contain non-negative numbers');
  }
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  if (typeof sleepImpl !== 'function') {
    throw new TypeError('sleepImpl must be a function');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (extracted.resources.length > 0 && typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is required');
  }

  const results = extracted.resources.length === 0
    ? []
    : await checkWithConcurrency(extracted.resources, {
        fetchImpl,
        timeoutMs,
        concurrency,
        retryDelaysMs,
        sleepImpl,
      });
  const passed = results.filter(({ ok }) => ok).length;
  const failed = results.length - passed;
  const totalAttempts = results.reduce(
    (total, result) => total + result.attempts.length,
    0,
  );
  const retryAttempts = results.reduce(
    (total, result) => total + result.retryCount,
    0,
  );
  const referenceCount = extracted.resources.reduce(
    (total, resource) => total + resource.references.length,
    0,
  );

  return {
    schemaVersion: RESOURCE_URL_CHECK_SCHEMA_VERSION,
    checkType: 'CHANGED_RESOURCE_URL_CHECK',
    diffType: diff.diffType ?? null,
    environment: diff.environment ?? null,
    retryDelaysMs: [...retryDelaysMs],
    passed: failed === 0 && extracted.invalidResources.length === 0,
    summary: {
      changesScanned: extracted.changesScanned,
      resourceReferences: referenceCount,
      uniqueUrls: extracted.resources.length,
      passed,
      failed,
      invalid: extracted.invalidResources.length,
      totalAttempts,
      retryAttempts,
    },
    results,
    invalidResources: extracted.invalidResources,
  };
}

function referenceText(reference) {
  return (
    (reference.changeType ?? 'UNKNOWN') +
    ' / ' +
    (reference.path ?? '$')
  );
}

function addResultSection(lines, title, results, formatter) {
  lines.push('', title + '（' + results.length + '）', '-'.repeat(48));
  if (results.length === 0) {
    lines.push('无');
    return;
  }
  results.forEach((result, index) => {
    lines.push(String(index + 1) + '. ' + formatter(result));
  });
}

export function renderResourceUrlTextReport(report) {
  if (!isRecord(report) || !isRecord(report.summary)) {
    throw new TypeError('Resource URL report must be an object with summary');
  }
  const lines = [
    'AIMirror 变更资源 URL 检查报告',
    '='.repeat(48),
    '检查结论：' + (report.passed ? '通过' : '不通过'),
    'Diff 类型：' + (report.diffType ?? '未提供'),
    '环境：' + (report.environment ?? '未提供'),
    '',
    '检查统计',
    '-'.repeat(48),
    '扫描变化：' + report.summary.changesScanned,
    '资源引用：' + report.summary.resourceReferences,
    '唯一 URL：' + report.summary.uniqueUrls,
    '访问成功：' + report.summary.passed,
    '访问失败：' + report.summary.failed,
    '格式无效：' + report.summary.invalid,
    '请求尝试：' + report.summary.totalAttempts,
    '实际重试：' + report.summary.retryAttempts,
    '重试计划：' +
      (report.retryDelaysMs ?? [])
        .map((delay) => delay / 1000 + ' 秒')
        .join(' / '),
  ];

  addResultSection(
    lines,
    '格式无效的资源',
    report.invalidResources,
    (item) =>
      item.value +
      '\n   位置：' +
      referenceText(item.reference),
  );
  addResultSection(
    lines,
    '访问失败的资源',
    report.results.filter(({ ok }) => !ok),
    (item) =>
      item.url +
      '\n   原因：' +
      (item.error ?? '未知错误') +
      '\n   尝试：' +
      item.attempts.length +
      ' 次' +
      '\n   引用：' +
      item.references.map(referenceText).join('；'),
  );
  addResultSection(
    lines,
    '访问成功的资源',
    report.results.filter(({ ok }) => ok),
    (item) =>
      item.url +
      '\n   状态：HTTP ' +
      item.status +
      (item.contentType ? '；类型：' + item.contentType : '') +
      '\n   尝试：' +
      item.attempts.length +
      ' 次' +
      '\n   引用：' +
      item.references.map(referenceText).join('；'),
  );

  if (report.summary.uniqueUrls === 0 && report.summary.invalid === 0) {
    lines.push('', '说明：当前 Diff 中没有需要检查的新 URL。');
  }
  return lines.join('\n') + '\n';
}
