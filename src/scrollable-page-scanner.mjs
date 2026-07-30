export const SCAN_TERMINATIONS = Object.freeze({
  STOPPED: 'STOPPED',
  COMPLETED_ROUND_TRIP: 'COMPLETED_ROUND_TRIP',
  SCAN_LIMIT_REACHED: 'SCAN_LIMIT_REACHED',
});

export function normalizePageText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function decodeXmlText(value) {
  return value
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function visiblePageEntries(hierarchy, options = {}) {
  const viewportBottom = options.viewportBottom ?? 2874;
  const entries = [];
  for (const nodeMatch of String(hierarchy ?? '').matchAll(/<node\b[^>]*>/g)) {
    const node = nodeMatch[0];
    const boundsMatch = node.match(
      /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
    );
    if (!boundsMatch) continue;
    const [, x1, y1, x2, y2] = boundsMatch.map(Number);
    if (x2 <= x1 || y2 <= y1 || y2 <= 0 || y1 >= viewportBottom) continue;

    for (const attribute of node.matchAll(/\b(?:text|content-desc)="([^"]*)"/g)) {
      const decoded = decodeXmlText(attribute[1]);
      for (const line of decoded.split(/\r?\n/)) {
        const text = line.replace(/\s+/g, ' ').trim();
        if (text) entries.push({ text, bounds: [x1, y1, x2, y2] });
      }
    }
  }
  return entries;
}

export function visiblePageText(hierarchy, options) {
  return visiblePageEntries(hierarchy, options).map((entry) => entry.text);
}

export function pageTextSignature(hierarchy, options) {
  return visiblePageEntries(hierarchy, options)
    .map((entry) => `${entry.text}\u0000${entry.bounds.join(',')}`)
    .join('\n');
}

export function pageTextContentSignature(hierarchy, options) {
  return visiblePageText(hierarchy, options)
    .map(normalizePageText)
    .filter(Boolean)
    .join('\n');
}

export function exactPageTextVisible(hierarchy, expectedText, options) {
  const expected = normalizePageText(expectedText);
  return (
    Boolean(expected) &&
    visiblePageText(hierarchy, options).some(
      (value) => normalizePageText(value) === expected,
    )
  );
}

export function uniqueExactPageTextTapTarget(
  hierarchy,
  expectedText,
  options = {},
) {
  const expected = normalizePageText(expectedText);
  if (!expected) return null;

  const maximumHeight = options.maximumHeight ?? 180;
  const matchingBounds = new Map();
  for (const entry of visiblePageEntries(hierarchy, options)) {
    if (normalizePageText(entry.text) !== expected) continue;
    const [x1, y1, x2, y2] = entry.bounds;
    if (y2 - y1 > maximumHeight) continue;
    matchingBounds.set(entry.bounds.join(','), entry.bounds);
  }
  if (matchingBounds.size !== 1) return null;

  const bounds = [...matchingBounds.values()][0];
  const [x1, y1, x2, y2] = bounds;
  return {
    x: Math.round((x1 + x2) / 2),
    y: Math.round((y1 + y2) / 2),
    bounds,
  };
}

function positiveInteger(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved;
}

function observationSignature(observation) {
  return String(observation?.signature ?? '');
}

// A round trip means stepwise scanning toward the bottom and then back to
// the top. Every swipe is followed by a fresh observation; this is not a
// single fling to either boundary.
export async function scanScrollablePage(options = {}) {
  if (typeof options.observe !== 'function') throw new Error('observe is required');
  if (typeof options.swipeForward !== 'function') {
    throw new Error('swipeForward is required');
  }
  if (typeof options.swipeBackward !== 'function') {
    throw new Error('swipeBackward is required');
  }

  const maxSwipesPerDirection = positiveInteger(
    options.maxSwipesPerDirection,
    30,
    'maxSwipesPerDirection',
  );
  const boundaryUnchangedThreshold = positiveInteger(
    options.boundaryUnchangedThreshold,
    3,
    'boundaryUnchangedThreshold',
  );
  const boundaryMatchingSwipeReadsThreshold =
    options.boundaryMatchingSwipeReadsThreshold === undefined
      ? null
      : positiveInteger(
          options.boundaryMatchingSwipeReadsThreshold,
          null,
          'boundaryMatchingSwipeReadsThreshold',
        );
  const stopWhen = options.stopWhen ?? (() => false);
  const onObservation = options.onObservation ?? (() => {});
  const onBoundary = options.onBoundary ?? (() => {});
  const boundaryWhen = options.boundaryWhen ?? (() => false);
  const boundaryResults = [];
  let observationCount = 0;

  const record = async (observation, location) => {
    observationCount += 1;
    await onObservation(observation, location);
    return Boolean(await stopWhen(observation, location));
  };

  const initialLocation = {
    direction: 'initial',
    boundary: null,
    swipeIndex: 0,
    unchangedCount: 0,
  };
  let current = await options.observe(initialLocation);
  if (await record(current, initialLocation)) {
    return {
      termination: SCAN_TERMINATIONS.STOPPED,
      observationCount,
      stoppedAt: initialLocation,
      lastObservation: current,
      boundaryResults,
    };
  }

  const directions = [
    {
      direction: 'finger-bottom-to-top',
      boundary: 'page-bottom',
      swipe: options.swipeForward,
    },
    {
      direction: 'finger-top-to-bottom',
      boundary: 'page-top',
      swipe: options.swipeBackward,
    },
  ];

  for (const scanDirection of directions) {
    let previousSignature = observationSignature(current);
    let previousSwipeSignature = '';
    let matchingSwipeReadCount = 0;
    let unchangedCount = 0;
    let boundaryConfirmed = false;

    for (
      let swipeIndex = 1;
      swipeIndex <= maxSwipesPerDirection;
      swipeIndex += 1
    ) {
      await scanDirection.swipe();
      current = await options.observe({
        direction: scanDirection.direction,
        boundary: null,
        swipeIndex,
        unchangedCount: 0,
      });
      const signature = observationSignature(current);
      unchangedCount =
        signature && previousSignature && signature === previousSignature
          ? unchangedCount + 1
          : 0;
      previousSignature = signature;
      matchingSwipeReadCount =
        signature &&
        previousSwipeSignature &&
        signature === previousSwipeSignature
          ? Math.max(2, matchingSwipeReadCount + 1)
          : signature
            ? 1
            : 0;
      previousSwipeSignature = signature;
      const location = {
        direction: scanDirection.direction,
        boundary: null,
        swipeIndex,
        unchangedCount,
        matchingSwipeReadCount,
      };

      if (await record(current, location)) {
        return {
          termination: SCAN_TERMINATIONS.STOPPED,
          observationCount,
          stoppedAt: location,
          lastObservation: current,
          boundaryResults,
        };
      }

      const explicitBoundary = Boolean(
        await boundaryWhen(current, location),
      );
      const matchingSwipeBoundary =
        boundaryMatchingSwipeReadsThreshold !== null &&
        matchingSwipeReadCount >= boundaryMatchingSwipeReadsThreshold;
      if (
        !explicitBoundary &&
        !matchingSwipeBoundary &&
        unchangedCount < boundaryUnchangedThreshold
      ) {
        continue;
      }
      boundaryConfirmed = true;
      const boundaryResult = {
        direction: scanDirection.direction,
        boundary: scanDirection.boundary,
        boundaryConfirmed: true,
        swipes: swipeIndex,
      };
      boundaryResults.push(boundaryResult);
      await onBoundary(current, boundaryResult);
      break;
    }

    if (boundaryConfirmed) continue;
    boundaryResults.push({
      direction: scanDirection.direction,
      boundary: scanDirection.boundary,
      boundaryConfirmed: false,
      swipes: maxSwipesPerDirection,
    });
    return {
      termination: SCAN_TERMINATIONS.SCAN_LIMIT_REACHED,
      observationCount,
      stoppedAt: null,
      lastObservation: current,
      boundaryResults,
    };
  }

  return {
    termination: SCAN_TERMINATIONS.COMPLETED_ROUND_TRIP,
    observationCount,
    stoppedAt: null,
    lastObservation: current,
    boundaryResults,
  };
}
