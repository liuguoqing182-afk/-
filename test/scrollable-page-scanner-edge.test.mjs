import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCAN_TERMINATIONS,
  exactPageTextVisible,
  scanScrollablePage,
  visiblePageText,
} from '../src/scrollable-page-scanner.mjs';

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

test('normalizes Unicode width and case while ignoring off-screen text', () => {
  const hierarchy = `<hierarchy>
    <node text="ＴＲＥＮＤ　ＨＵＢ" content-desc="" bounds="[20,300][500,380]" />
    <node text="Hidden Target" content-desc="" bounds="[20,3000][500,3080]" />
    <node text="Zero Area" content-desc="" bounds="[20,500][20,580]" />
  </hierarchy>`;

  assert.deepEqual(visiblePageText(hierarchy), ['ＴＲＥＮＤ ＨＵＢ']);
  assert.equal(exactPageTextVisible(hierarchy, 'trend hub'), true);
  assert.equal(exactPageTextVisible(hierarchy, 'Hidden Target'), false);
  assert.equal(exactPageTextVisible(hierarchy, 'Zero Area'), false);
});

test('records an observation before evaluating the asynchronous stop condition', async () => {
  const harness = createHarness({
    initial: 'page-1',
    forward: ['target'],
  });
  const events = [];
  let targetRecorded = false;

  const result = await scanScrollablePage({
    ...harness,
    onObservation: async (observation, location) => {
      await Promise.resolve();
      events.push(`observe:${location.direction}:${observation.value}`);
      if (observation.value === 'target') targetRecorded = true;
    },
    stopWhen: async (observation, location) => {
      await Promise.resolve();
      events.push(`stop:${location.direction}:${observation.value}`);
      return observation.value === 'target' && targetRecorded;
    },
  });

  assert.equal(result.termination, SCAN_TERMINATIONS.STOPPED);
  assert.deepEqual(events, [
    'observe:initial:page-1',
    'stop:initial:page-1',
    'observe:finger-bottom-to-top:target',
    'stop:finger-bottom-to-top:target',
  ]);
});

test('does not treat repeated empty signatures as a confirmed boundary', async () => {
  const harness = createHarness({
    initial: '',
    forward: ['', '', ''],
  });
  const boundaries = [];

  const result = await scanScrollablePage({
    ...harness,
    maxSwipesPerDirection: 3,
    boundaryUnchangedThreshold: 2,
    onBoundary: async (_observation, boundary) => {
      boundaries.push(boundary);
    },
  });

  assert.equal(result.termination, SCAN_TERMINATIONS.SCAN_LIMIT_REACHED);
  assert.equal(result.boundaryResults[0].boundaryConfirmed, false);
  assert.deepEqual(boundaries, []);
  assert.deepEqual(harness.counts(), { forwardIndex: 3, backwardIndex: 0 });
});

test('reports a reverse-scan safety limit after preserving the bottom boundary', async () => {
  const harness = createHarness({
    initial: 'middle',
    forward: ['bottom', 'bottom', 'bottom'],
    backward: ['return-1', 'return-2'],
  });

  const result = await scanScrollablePage({
    ...harness,
    maxSwipesPerDirection: 3,
    boundaryUnchangedThreshold: 2,
  });

  assert.equal(result.termination, SCAN_TERMINATIONS.SCAN_LIMIT_REACHED);
  assert.deepEqual(result.boundaryResults, [
    {
      direction: 'finger-bottom-to-top',
      boundary: 'page-bottom',
      boundaryConfirmed: true,
      swipes: 3,
    },
    {
      direction: 'finger-top-to-bottom',
      boundary: 'page-top',
      boundaryConfirmed: false,
      swipes: 3,
    },
  ]);
  assert.deepEqual(harness.counts(), { forwardIndex: 3, backwardIndex: 3 });
});

test('validates required callbacks and positive scan limits', async () => {
  await assert.rejects(scanScrollablePage(), /observe is required/);
  await assert.rejects(
    scanScrollablePage({
      observe: async () => ({ signature: 'page' }),
      swipeForward: async () => {},
      swipeBackward: async () => {},
      maxSwipesPerDirection: 0,
    }),
    /maxSwipesPerDirection must be a positive integer/,
  );
  await assert.rejects(
    scanScrollablePage({
      observe: async () => ({ signature: 'page' }),
      swipeForward: async () => {},
      swipeBackward: async () => {},
      boundaryUnchangedThreshold: 1.5,
    }),
    /boundaryUnchangedThreshold must be a positive integer/,
  );
});
