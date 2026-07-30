import {
  normalizePageText,
  visiblePageText,
} from './scrollable-page-scanner.mjs';

export const TAG_HOME_RECOVERY_TIMEOUT_MS = 110_000;

export const TAG_HOME_ACTIONS = Object.freeze({
  DONE: 'DONE',
  DISMISS_ACCOUNT_DRAWER: 'DISMISS_ACCOUNT_DRAWER',
  TAP_HOME: 'TAP_HOME',
  BACK: 'BACK',
});

const HOME_CONTENT_MARKERS = Object.freeze([
  'inspiration',
  'more content is coming',
  'ai video',
  'ai filter',
  'ai better',
]);

const ACCOUNT_DRAWER_MARKERS = Object.freeze([
  'credit details',
  'user id',
]);

function decodeXmlValue(value) {
  return String(value ?? '')
    .replace(/&#10;|\\n/g, '\n')
    .replace(/&#13;|\\r/g, '\r')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attribute(node, name) {
  return node.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '';
}

function nodeBounds(node) {
  const match = node.match(
    /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
  );
  if (!match) return null;
  const [, x1, y1, x2, y2] = match.map(Number);
  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2, y2];
}

function nodeLabelLines(node) {
  return [attribute(node, 'text'), attribute(node, 'content-desc')]
    .flatMap((value) => decodeXmlValue(value).split(/\r?\n/))
    .map(normalizePageText)
    .filter(Boolean);
}

function hierarchyNodes(hierarchy) {
  return [...String(hierarchy ?? '').matchAll(/<node\b[^>]*>/g)].map(
    (match) => {
      const node = match[0];
      return {
        node,
        bounds: nodeBounds(node),
        labelLines: nodeLabelLines(node),
        clickable: attribute(node, 'clickable') === 'true',
        selected: attribute(node, 'selected') === 'true',
      };
    },
  );
}

function containsPoint(bounds, point) {
  if (!bounds || !point) return false;
  const [x1, y1, x2, y2] = bounds;
  return (
    point.x >= x1 &&
    point.x < x2 &&
    point.y >= y1 &&
    point.y < y2
  );
}

function hierarchySize(nodes) {
  return nodes.reduce(
    (size, node) => {
      if (!node.bounds) return size;
      return {
        width: Math.max(size.width, node.bounds[2]),
        height: Math.max(size.height, node.bounds[3]),
      };
    },
    { width: 0, height: 0 },
  );
}

function accountDrawerMarkerNodes(nodes) {
  return nodes.filter((node) =>
    ACCOUNT_DRAWER_MARKERS.some((marker) =>
      node.labelLines.some((line) => line.includes(marker)),
    ),
  );
}

function homeTabFromNodes(nodes) {
  const node = nodes.find(
    (candidate) =>
      candidate.labelLines.includes('home') &&
      candidate.labelLines.includes('tab 2 of 3'),
  );
  if (!node) {
    return {
      visible: false,
      selected: false,
      bounds: null,
      tapTarget: null,
    };
  }
  const [x1, y1, x2, y2] = node.bounds ?? [];
  return {
    visible: Boolean(node.bounds),
    selected: node.selected,
    bounds: node.bounds,
    tapTarget: node.bounds
      ? {
          x: Math.round((x1 + x2) / 2),
          y: Math.round((y1 + y2) / 2),
        }
      : null,
  };
}

export function inspectTagHomeHierarchy(hierarchy) {
  const nodes = hierarchyNodes(hierarchy);
  const texts = visiblePageText(hierarchy).map(normalizePageText);
  const drawerMarkerNodes = accountDrawerMarkerNodes(nodes);
  const accountDrawerVisible = ACCOUNT_DRAWER_MARKERS.every((marker) =>
    texts.some((text) => text.includes(marker)),
  );
  const homeTab = homeTabFromNodes(nodes);
  const homeContentVisible = HOME_CONTENT_MARKERS.some((marker) =>
    texts.some((text) => text.includes(marker)),
  );
  const stable = homeTab.selected && homeContentVisible;

  return {
    nodes,
    texts,
    homeTab,
    homeContentVisible,
    accountDrawerVisible,
    drawerMarkerNodes,
    stable,
  };
}

export function tagHomeActionForHierarchy(hierarchy) {
  const state = inspectTagHomeHierarchy(hierarchy);
  if (state.stable) {
    return {
      action: TAG_HOME_ACTIONS.DONE,
      state,
      tapTarget: null,
    };
  }
  if (state.accountDrawerVisible) {
    return {
      action: TAG_HOME_ACTIONS.DISMISS_ACCOUNT_DRAWER,
      state,
      tapTarget: null,
    };
  }
  if (
    state.homeTab.visible &&
    !state.homeTab.selected &&
    state.homeTab.tapTarget
  ) {
    return {
      action: TAG_HOME_ACTIONS.TAP_HOME,
      state,
      tapTarget: state.homeTab.tapTarget,
    };
  }
  return {
    action: TAG_HOME_ACTIONS.BACK,
    state,
    tapTarget: null,
  };
}

export function safeAccountDrawerDismissTarget(hierarchy) {
  const state = inspectTagHomeHierarchy(hierarchy);
  if (!state.accountDrawerVisible) return null;

  const { width, height } = hierarchySize(state.nodes);
  const drawerLeft = Math.min(
    ...state.drawerMarkerNodes
      .map((node) => node.bounds?.[0])
      .filter(Number.isFinite),
  );
  if (!Number.isFinite(drawerLeft) || drawerLeft <= 80) return null;

  const safeLeftWidth = Math.max(80, drawerLeft - 24);
  const xCandidates = [
    Math.round(safeLeftWidth * 0.5),
    Math.round(safeLeftWidth * 0.65),
    Math.round(safeLeftWidth * 0.35),
  ];
  const yCandidates = [
    Math.round(Math.min(260, height * 0.08)),
    Math.round(Math.min(340, height * 0.11)),
    180,
    380,
  ].filter((value) => value > 40 && value < height);
  const screenArea = Math.max(1, width * height);
  const blockingClickableNodes = state.nodes.filter((node) => {
    if (!node.clickable || !node.bounds) return false;
    const [x1, y1, x2, y2] = node.bounds;
    const area = (x2 - x1) * (y2 - y1);
    // Ignore only full-screen gesture containers. Cards and controls remain
    // blocking even when Flutter exposes no text for them.
    return area < screenArea * 0.45;
  });

  for (const y of yCandidates) {
    for (const x of xCandidates) {
      const point = { x, y };
      if (x >= drawerLeft) continue;
      if (
        blockingClickableNodes.some((node) =>
          containsPoint(node.bounds, point),
        )
      ) {
        continue;
      }
      return point;
    }
  }
  return null;
}
