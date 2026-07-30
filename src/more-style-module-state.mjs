import { normalizePageText } from './scrollable-page-scanner.mjs';

const MORE_STYLE_FLOW_TABS = Object.freeze({
  VIDEO_TAG: Object.freeze({
    label: 'video',
    position: 'tab 2 of 3',
  }),
  FILTER_TAG: Object.freeze({
    label: 'filter',
    position: 'tab 1 of 3',
  }),
});

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

function visibleBounds(node, viewportBottom = 2874) {
  const match = node.match(
    /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
  );
  if (!match) return null;
  const [, x1, y1, x2, y2] = match.map(Number);
  if (
    x2 <= x1 ||
    y2 <= y1 ||
    y2 <= 0 ||
    y1 >= viewportBottom
  ) {
    return null;
  }
  return [x1, y1, x2, y2];
}

function labelLines(node) {
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
        bounds: visibleBounds(node),
        labelLines: labelLines(node),
        selected: attribute(node, 'selected') === 'true',
      };
    },
  );
}

function selectedTabState(nodes, label, position) {
  const node = nodes.find(
    (candidate) =>
      candidate.bounds &&
      candidate.labelLines.includes(label) &&
      candidate.labelLines.includes(position),
  );
  return {
    visible: Boolean(node),
    selected: Boolean(node?.selected),
    bounds: node?.bounds ?? null,
  };
}

export function inspectMoreStyleModuleHierarchy(hierarchy, flow) {
  const expectedTopTab = MORE_STYLE_FLOW_TABS[flow];
  if (!expectedTopTab) {
    throw new Error(`unsupported More Style flow: ${flow}`);
  }

  const nodes = hierarchyNodes(hierarchy);
  const effectsTab = selectedTabState(
    nodes,
    'effects',
    'tab 1 of 3',
  );
  const topTab = selectedTabState(
    nodes,
    expectedTopTab.label,
    expectedTopTab.position,
  );

  return {
    flow,
    expectedTopTab: expectedTopTab.label,
    effectsTab,
    topTab,
    stable: effectsTab.selected && topTab.selected,
  };
}
