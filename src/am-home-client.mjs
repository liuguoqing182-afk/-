import { standardizeConfigSnapshot } from './config-standardizer.mjs';

export const AM_HOME_BASE_URLS = Object.freeze({
  DEV: 'https://betv2.aimirror.fun',
  PRO: 'https://be.aimirror.fun',
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredText(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(name + ' is required');
  return normalized;
}

function normalizeEnvironment(value) {
  const environment = requiredText(value, 'environment').toUpperCase();
  if (!AM_HOME_BASE_URLS[environment]) {
    throw new Error('Unsupported environment: ' + environment);
  }
  return environment;
}

async function requestJson(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await options.fetchImpl(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(response.status + ' ' + response.statusText + ': ' + url);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < options.retries) {
        await options.sleepImpl(1000 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

export function findMissingModelReferences(snapshot) {
  const modelIds = new Set(snapshot.models.map(({ id }) => id));
  const references = [];
  for (const group of snapshot.groups) {
    for (const modelId of group.modelIds) {
      if (modelIds.has(modelId)) continue;
      references.push({
        section: group.section,
        groupId: group.id,
        tagName: group.name,
        modelId,
      });
    }
  }
  return {
    count: references.length,
    uniqueModelIds: [...new Set(references.map(({ modelId }) => modelId))]
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true })),
    references,
  };
}

/** Fetch /config/v4 and its model catalog, then build a stable snapshot. */
export async function fetchHomeSnapshot(environmentInput, options = {}) {
  const environment = normalizeEnvironment(environmentInput);
  const uid = requiredText(options.uid, 'uid');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const baseUrl = (options.baseUrls ?? AM_HOME_BASE_URLS)[environment];
  if (!baseUrl) throw new Error('Missing base URL for ' + environment);
  const language = options.language ?? 'en-US';
  const appVersion = options.appVersion ?? '7.0.6+206';
  const headers = {
    UID: uid,
    'Accept-Language': language,
    'User-Agent': `AIMirror/${appVersion} (android)`,
    'App-Version': appVersion,
    'Package-Name': options.packageName ?? 'com.ai.polyverse.mirror',
    Store: options.store ?? 'google_play',
    Env: environment,
    'Eagleeyes-V2': 'true',
  };
  const requestOptions = {
    fetchImpl,
    headers,
    timeoutMs: options.timeoutMs ?? 20000,
    retries: options.retries ?? 2,
    sleepImpl: options.sleepImpl ?? sleep,
  };
  const configUrl = new URL('/config/v4', baseUrl);
  configUrl.searchParams.set('uid', uid);
  const config = await requestJson(configUrl.href, requestOptions);
  if (!config?.model_url) throw new Error(environment + ' /config/v4 missing model_url');
  const modelUrl = new URL(config.model_url, baseUrl).href;
  const modelPayload = await requestJson(modelUrl, requestOptions);
  const models = Array.isArray(modelPayload)
    ? modelPayload
    : modelPayload?.models ?? modelPayload?.data;
  if (!Array.isArray(models)) throw new Error(environment + ' model catalog is not an array');

  const snapshot = standardizeConfigSnapshot({ config, models, environment });
  return {
    environment,
    queriedAt: new Date().toISOString(),
    request: { configUrl: configUrl.href, modelUrl },
    config,
    models,
    snapshot,
    missingModelReferences: findMissingModelReferences(snapshot),
  };
}
