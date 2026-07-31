import { Buffer } from 'node:buffer';

export const MODEL_SEARCH_RESULT_TIMEOUT_MS = 100_000;
export const MODEL_SEARCH_POLL_INTERVAL_MS = 10_000;
export const MODEL_SEARCH_EXECUTION_ATTEMPT_MAX = 3;
export const MODEL_SEARCH_ATTEMPT_TIMEOUT_MS = 110_000;
export const MODEL_SEARCH_OPERATION_TIMEOUT_MS = 10_000;
export const MODEL_SEARCH_BACK_PRESS_COUNT = 3;

const FINAL_IMAGE_STATES = new Set(['LOADED', 'VALID', 'MISSING']);
const WAITABLE_IMAGE_STATES = new Set(['LOADING', 'PLACEHOLDER']);
const READABLE_IMAGE_STATES = new Set([
  ...FINAL_IMAGE_STATES,
  ...WAITABLE_IMAGE_STATES,
]);
const NO_RESULT_STATES = new Set(['NO_RESULTS', 'EMPTY']);
const ERROR_RESULT_STATES = new Set(['APP_ERROR', 'NETWORK_ERROR', 'ERROR']);

function decodeXmlAttribute(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_match, codePoint) =>
      String.fromCodePoint(Number(codePoint)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizedLabel(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function positiveDimension(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`invalid device ${label}: ${value}`);
  }
  return number;
}

export function parsePhysicalScreenSize(output) {
  const matches = [
    ...String(output ?? '').matchAll(
      /(?:Physical size|Override size):\s*(\d+)\s*x\s*(\d+)/gi,
    ),
  ];
  const selected =
    matches.find((match) => /Override size/i.test(match[0])) ??
    matches.find((match) => /Physical size/i.test(match[0]));
  if (!selected) {
    throw new Error(`unable to parse device screen size: ${output}`);
  }
  return {
    width: positiveDimension(selected[1], 'width'),
    height: positiveDimension(selected[2], 'height'),
  };
}

export function deterministicModelSearchTargets(screenSize) {
  const width = positiveDimension(screenSize?.width, 'width');
  const height = positiveDimension(screenSize?.height, 'height');
  const point = (xRatio, yRatio) => ({
    x: Math.round(width * xRatio),
    y: Math.round(height * yRatio),
  });
  return {
    homeSearch: point(0.853, 0.071),
    searchInput: point(0.448, 0.085),
    submitSearch: point(0.903, 0.083),
  };
}

export function encodeAdbInputText(value) {
  const text = String(value ?? '');
  if (!text.trim()) throw new Error('model search text must not be empty');
  if (!/^[A-Za-z0-9 ._'-]+$/.test(text)) {
    throw new Error(
      `model search text requires Unicode input: ${text}`,
    );
  }
  return text.replace(/ /g, '%s');
}

export function requiresAdbUnicodeInput(value) {
  const text = String(value ?? '');
  if (!text.trim()) throw new Error('model search text must not be empty');
  if (/[\u0000-\u001F\u007F]/u.test(text)) {
    throw new Error(
      `model search text contains unsupported control characters`,
    );
  }
  return !/^[A-Za-z0-9 ._'-]+$/.test(text);
}

export function encodeAdbUnicodeInput(value) {
  const text = String(value ?? '');
  requiresAdbUnicodeInput(text);
  return Buffer.from(text, 'utf8').toString('base64');
}

function booleanAttribute(value) {
  return String(value).toLowerCase() === 'true';
}

export function parseHierarchyNodes(hierarchy) {
  const nodes = [];
  for (const match of String(hierarchy ?? '').matchAll(/<node\b[^>]*>/g)) {
    const raw = match[0];
    const attributes = {};
    for (const attribute of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes[attribute[1]] = decodeXmlAttribute(attribute[2]);
    }
    const boundsMatch = String(attributes.bounds ?? '').match(
      /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/,
    );
    if (!boundsMatch) continue;
    const bounds = boundsMatch.slice(1).map(Number);
    if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) continue;
    nodes.push({
      raw,
      attributes,
      bounds,
      text: attributes.text ?? '',
      contentDescription: attributes['content-desc'] ?? '',
      resourceId: attributes['resource-id'] ?? '',
      className: attributes.class ?? '',
      clickable: booleanAttribute(attributes.clickable),
      editable: booleanAttribute(attributes.editable),
      focused: booleanAttribute(attributes.focused),
    });
  }
  return nodes;
}

export function centerOfNode(node) {
  if (!node?.bounds || node.bounds.length !== 4) {
    throw new Error('deterministic search target has no valid bounds');
  }
  const [left, top, right, bottom] = node.bounds;
  return {
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2),
  };
}

function viewportFromNodes(nodes) {
  return {
    width: Math.max(0, ...nodes.map((node) => node.bounds[2])),
    height: Math.max(0, ...nodes.map((node) => node.bounds[3])),
  };
}

function searchLabelScore(node) {
  const labels = [
    node.contentDescription,
    node.text,
    node.resourceId.replace(/^.*[/:]/, ''),
  ].map(normalizedLabel);
  let score = 0;
  for (const label of labels) {
    if (/^(search|搜索)$/.test(label)) score = Math.max(score, 100);
    else if (/^(search|搜索)\b/.test(label)) score = Math.max(score, 80);
    else if (/(search|搜索)/.test(label)) score = Math.max(score, 50);
  }
  return score;
}

export function findHomeSearchTrigger(hierarchy) {
  const nodes = parseHierarchyNodes(hierarchy);
  const viewport = viewportFromNodes(nodes);
  const candidates = nodes
    .filter(
      (node) =>
        !node.editable &&
        !/EditText/i.test(node.className) &&
        searchLabelScore(node) > 0,
    )
    .map((node) => {
      const center = centerOfNode(node);
      let score = searchLabelScore(node);
      if (node.clickable) score += 15;
      if (viewport.width && center.x >= viewport.width * 0.6) score += 20;
      if (viewport.height && center.y <= viewport.height * 0.3) score += 20;
      return { node, score };
    })
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.node ?? null;
}

export function findSearchInput(hierarchy) {
  const nodes = parseHierarchyNodes(hierarchy);
  const candidates = nodes
    .filter(
      (node) =>
        node.editable ||
        /EditText/i.test(node.className) ||
        (node.focused && searchLabelScore(node) > 0),
    )
    .map((node) => {
      let score = 0;
      if (node.editable) score += 100;
      if (/EditText/i.test(node.className)) score += 80;
      if (node.focused) score += 30;
      score += searchLabelScore(node);
      return { node, score };
    })
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.node ?? null;
}

export function classifyModelSearchObservation(verdict) {
  const evidence = verdict?.evidence ?? {};
  const resultState = String(evidence.resultState ?? '').toUpperCase();
  const imageState = String(
    evidence.firstResultImageState ?? '',
  ).toUpperCase();

  if (ERROR_RESULT_STATES.has(resultState)) {
    return {
      state: 'EXECUTION_INCOMPLETE',
      reason: verdict?.verdictReasonCode ?? 'SEARCH_PAGE_ERROR',
    };
  }
  if (NO_RESULT_STATES.has(resultState)) {
    return { state: 'BUSINESS_COMPLETE' };
  }
  if (verdict?.businessVerdict === 'PASS') {
    return { state: 'BUSINESS_COMPLETE' };
  }
  const firstCardCompletelyRead =
    resultState === 'RESULTS' &&
    evidence.firstResultVisible === true &&
    Boolean(String(evidence.firstResultTitle ?? '').trim()) &&
    READABLE_IMAGE_STATES.has(imageState);
  if (
    verdict?.verdictReasonCode === 'MODEL_IMAGE_NOT_LOADED' &&
    WAITABLE_IMAGE_STATES.has(imageState)
  ) {
    return { state: 'WAIT_FOR_RESULT' };
  }
  if (verdict?.businessVerdict === 'FAIL' && firstCardCompletelyRead) {
    return { state: 'BUSINESS_COMPLETE' };
  }
  return {
    state: 'WAIT_FOR_RESULT',
    reason: verdict?.verdictReasonCode ?? 'MODEL_RESULT_NOT_READABLE',
  };
}

export function resolveModelSearchAtDeadline(lastVerdict) {
  if (!lastVerdict) {
    return {
      state: 'EXECUTION_INCOMPLETE',
      reason: 'MODEL_RESULT_NOT_READABLE',
    };
  }
  const classification = classifyModelSearchObservation(lastVerdict);
  const imageState = String(
    lastVerdict.evidence?.firstResultImageState ?? '',
  ).toUpperCase();
  if (
    lastVerdict.verdictReasonCode === 'MODEL_IMAGE_NOT_LOADED' &&
    WAITABLE_IMAGE_STATES.has(imageState)
  ) {
    return { state: 'BUSINESS_COMPLETE', verdict: lastVerdict };
  }
  if (classification.state === 'BUSINESS_COMPLETE') {
    return { ...classification, verdict: lastVerdict };
  }
  return {
    state: 'EXECUTION_INCOMPLETE',
    reason: classification.reason ?? 'MODEL_RESULT_NOT_READABLE',
  };
}
