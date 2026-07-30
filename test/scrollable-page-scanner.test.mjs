import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCAN_TERMINATIONS,
  exactPageTextVisible,
  pageTextSignature,
  scanScrollablePage,
  uniqueExactPageTextTapTarget,
  visiblePageText,
} from '../src/scrollable-page-scanner.mjs';

test('extracts exact visible text and includes bounds in the page signature', () => {
  const first = `<hierarchy>
    <node text="Trend Hub" content-desc="" bounds="[20,300][500,380]" />
    <node text="" content-desc="More &amp; Style" bounds="[20,400][500,480]" />
  </hierarchy>`;
  const moved = first.replace('[20,300][500,380]', '[20,280][500,360]');

  assert.deepEqual(visiblePageText(first), ['Trend Hub', 'More & Style']);
  assert.equal(exactPageTextVisible(first, ' trend   hub '), true);
  assert.equal(exactPageTextVisible(first, 'Trend'), false);
  assert.notEqual(pageTextSignature(first), pageTextSignature(moved));
});

test('returns one exact short text-node center as a safe tap target', () => {
  const hierarchy = `<hierarchy>
    <node text="Social Trend" content-desc="Social Trend" bounds="[24,620][310,700]" />
  </hierarchy>`;

  assert.deepEqual(
    uniqueExactPageTextTapTarget(hierarchy, ' social   trend '),
    {
      x: 167,
      y: 660,
      bounds: [24, 620, 310, 700],
    },
  );
});

test('rejects ambiguous or card-sized text nodes for deterministic taps', () => {
  const duplicate = `<hierarchy>
    <node text="Studio" bounds="[20,400][200,480]" />
    <node text="Studio" bounds="[20,900][200,980]" />
  </hierarchy>`;
  const cardSized = `<hierarchy>
    <node text="Studio" bounds="[0,300][1440,900]" />
  </hierarchy>`;

  assert.equal(uniqueExactPageTextTapTarget(duplicate, 'Studio'), null);
  assert.equal(uniqueExactPageTextTapTarget(cardSized, 'Studio'), null);
});

function createHarness({ initial, forward = [], backward = [] }) {
  let current = initial;
  let forwardIndex = 0;
  let backwardIndex = 0;
  return {
    observe: async () => ({ signature: current, value: current }),
    swipeForward: async () => {
      current = forward[Math.min(forwardIndex, forward.length - 1)] ?? current;
      forwardIndex += 1;
    },
    swipeBackward: async () => {
      current = backward[Math.min(backwardIndex, backward.length - 1)] ?? current;
      backwardIndex += 1;
    },
    counts: () => ({ forwardIndex, backwardIndex }),
  };
}

test('stops immediately when the target is already visible', async () => {
  const harness = createHarness({ initial: 'target' });
  const result = await scanScrollablePage({
    ...harness,
    stopWhen: (observation) => observation.value === 'target',
  });

  assert.equal(result.termination, SCAN_TERMINATIONS.STOPPED);
  assert.equal(result.stoppedAt.direction, 'initial');
  assert.deepEqual(harness.counts(), { forwardIndex: 0, backwardIndex: 0 });
});

test('scans stepwise toward the bottom and stops when the target appears', async () => {
  const harness = createHarness({
    initial: 'home-1',
    forward: ['home-2', 'target'],
  });
  const result = await scanScrollablePage({
    ...harness,
    stopWhen: (observation) => observation.value === 'target',
  });

  assert.equal(result.termination, SCAN_TERMINATIONS.STOPPED);
  assert.equal(result.stoppedAt.direction, 'finger-bottom-to-top');
  assert.equal(result.stoppedAt.swipeIndex, 2);
  assert.deepEqual(harness.counts(), { forwardIndex: 2, backwardIndex: 0 });
});

test('reverses after confirming the bottom and finds a target on return', async () => {
  const harness = createHarness({
    initial: 'home-1',
    forward: ['bottom', 'bottom', 'bottom', 'bottom'],
    backward: ['target'],
  });
  const result = await scanScrollablePage({
    ...harness,
    stopWhen: (observation) => observation.value === 'target',
  });

  assert.equal(result.termination, SCAN_TERMINATIONS.STOPPED);
  assert.equal(result.stoppedAt.direction, 'finger-top-to-bottom');
  assert.deepEqual(result.boundaryResults, [
    {
      direction: 'finger-bottom-to-top',
      boundary: 'page-bottom',
      boundaryConfirmed: true,
      swipes: 4,
    },
  ]);
});

test('finishes one stepwise bottom-and-top round trip when not found', async () => {
  const harness = createHarness({
    initial: 'middle',
    forward: ['bottom', 'bottom', 'bottom', 'bottom'],
    backward: ['top', 'top', 'top', 'top'],
  });
  const result = await scanScrollablePage({
    ...harness,
    stopWhen: () => false,
  });

  assert.equal(
    result.termination,
    SCAN_TERMINATIONS.COMPLETED_ROUND_TRIP,
  );
  assert.deepEqual(
    result.boundaryResults.map(({ boundary, boundaryConfirmed }) => [
      boundary,
      boundaryConfirmed,
    ]),
    [
      ['page-bottom', true],
      ['page-top', true],
    ],
  );
  assert.deepEqual(harness.counts(), { forwardIndex: 4, backwardIndex: 4 });
});

test('reports the safety limit without starting the reverse scan', async () => {
  const harness = createHarness({
    initial: 'page-0',
    forward: ['page-1', 'page-2'],
  });
  const result = await scanScrollablePage({
    ...harness,
    maxSwipesPerDirection: 2,
  });

  assert.equal(result.termination, SCAN_TERMINATIONS.SCAN_LIMIT_REACHED);
  assert.equal(result.boundaryResults[0].boundaryConfirmed, false);
  assert.deepEqual(harness.counts(), { forwardIndex: 2, backwardIndex: 0 });
});

test('accepts a documented explicit bottom marker even while the page signature changes', async () => {
  const harness = createHarness({
    initial: 'middle',
    forward: ['documented-bottom'],
    backward: ['top', 'top', 'top', 'top'],
  });
  const result = await scanScrollablePage({
    ...harness,
    stopWhen: () => false,
    boundaryWhen: (observation, location) =>
      location.direction === 'finger-bottom-to-top' &&
      observation.value === 'documented-bottom',
  });

  assert.equal(
    result.termination,
    SCAN_TERMINATIONS.COMPLETED_ROUND_TRIP,
  );
  assert.equal(result.boundaryResults[0].boundary, 'page-bottom');
  assert.equal(result.boundaryResults[0].swipes, 1);
  assert.deepEqual(harness.counts(), { forwardIndex: 1, backwardIndex: 4 });
});

test('confirms each boundary from two identical post-swipe text reads', async () => {
  const harness = createHarness({
    initial: 'middle',
    forward: ['bottom', 'bottom'],
    backward: ['top', 'top'],
  });
  const result = await scanScrollablePage({
    ...harness,
    stopWhen: () => false,
    boundaryMatchingSwipeReadsThreshold: 2,
  });

  assert.equal(
    result.termination,
    SCAN_TERMINATIONS.COMPLETED_ROUND_TRIP,
  );
  assert.deepEqual(
    result.boundaryResults.map((item) => item.swipes),
    [2, 2],
  );
  assert.deepEqual(harness.counts(), { forwardIndex: 2, backwardIndex: 2 });
});
