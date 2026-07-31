import { normalizePageText } from './scrollable-page-scanner.mjs';
import { tagTitleTextOnly } from './tag-title-text.mjs';

export const HOME_TAG_VISUAL_TITLES_KEY = 'visibleHomeSectionTitlesText';

const EDGE_DECORATIONS = /^[\s>›»→⟩❯]+|[\s>›»→⟩❯]+$/gu;

function collapsedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function visualHomeTagTitleTextOnly(value) {
  return tagTitleTextOnly(value)
    .replace(EDGE_DECORATIONS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeVisualHomeTagTitle(value) {
  return normalizePageText(visualHomeTagTitleTextOnly(value));
}

export function homeTagTitleHasDecorativeSymbols(value) {
  const original = collapsedText(value);
  return Boolean(
    original && visualHomeTagTitleTextOnly(original) !== original,
  );
}

function responseText(response) {
  if (typeof response === 'string') {
    const text = response.trim();
    if (!text) return '';
    try {
      return responseText(JSON.parse(text));
    } catch {
      return text;
    }
  }
  if (!response || typeof response !== 'object') return '';
  if (typeof response[HOME_TAG_VISUAL_TITLES_KEY] === 'string') {
    return response[HOME_TAG_VISUAL_TITLES_KEY];
  }
  if (response.data && response.data !== response) {
    return responseText(response.data);
  }
  return '';
}

export function parseVisibleHomeSectionTitles(response) {
  const seen = new Set();
  const titles = [];
  for (const rawTitle of responseText(response).split(/\|\||\r?\n/g)) {
    const title = collapsedText(rawTitle);
    const normalized = normalizeVisualHomeTagTitle(title);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    titles.push(title);
  }
  return titles;
}

export function exactVisualHomeTagTitle(response, expectedTitle) {
  const expected = normalizeVisualHomeTagTitle(expectedTitle);
  if (!expected) return null;
  return (
    parseVisibleHomeSectionTitles(response).find(
      (title) => normalizeVisualHomeTagTitle(title) === expected,
    ) ?? null
  );
}

export function safeVisualHomeTagTapTarget(
  locateResult,
  options = {},
) {
  const center = locateResult?.center;
  if (
    !Array.isArray(center) ||
    center.length < 2 ||
    !Number.isFinite(Number(center[0])) ||
    !Number.isFinite(Number(center[1]))
  ) {
    return null;
  }

  const x = Math.round(Number(center[0]));
  const y = Math.round(Number(center[1]));
  const viewportWidth = options.viewportWidth ?? 1_440;
  const viewportBottom = options.viewportBottom ?? 2_874;
  const contentTop = options.contentTop ?? 180;
  const contentBottom = options.contentBottom ?? viewportBottom - 174;
  if (
    x <= 0 ||
    x >= viewportWidth ||
    y <= contentTop ||
    y >= contentBottom
  ) {
    return null;
  }

  const rect = locateResult?.rect;
  if (
    rect &&
    Number.isFinite(Number(rect.height)) &&
    Number(rect.height) > 220
  ) {
    return null;
  }
  return { x, y };
}
