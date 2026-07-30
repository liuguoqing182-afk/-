import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectMoreStyleModuleHierarchy,
} from '../src/more-style-module-state.mjs';

function hierarchy({
  effectsSelected = true,
  filterSelected = false,
  videoSelected = false,
  content = '',
} = {}) {
  return `<hierarchy>
    <node content-desc="Filter&#10;Tab 1 of 3" selected="${filterSelected}" bounds="[340,167][581,286]" />
    <node content-desc="Video&#10;Tab 2 of 3" selected="${videoSelected}" bounds="[581,167][839,286]" />
    <node content-desc="Editor&#10;Tab 3 of 3" selected="false" bounds="[839,167][1100,286]" />
    <node content-desc="${content}" selected="false" bounds="[0,300][1440,2700]" />
    <node content-desc="Effects&#10;Tab 1 of 3" selected="${effectsSelected}" bounds="[35,2812][492,2874]" />
    <node content-desc="Home&#10;Tab 2 of 3" selected="${!effectsSelected}" bounds="[492,2812][948,2874]" />
  </hierarchy>`;
}

test('confirms More Style Video only when Effects and Video are selected', () => {
  const state = inspectMoreStyleModuleHierarchy(
    hierarchy({ videoSelected: true, content: 'Social Trend&#10;AI Video' }),
    'VIDEO_TAG',
  );
  assert.equal(state.effectsTab.selected, true);
  assert.equal(state.topTab.selected, true);
  assert.deepEqual(state.effectsTab.tapTarget, { x: 264, y: 2843 });
  assert.deepEqual(state.topTab.tapTarget, { x: 710, y: 227 });
  assert.equal(state.stable, true);
});

test('confirms More Style Filter only when Effects and Filter are selected', () => {
  const state = inspectMoreStyleModuleHierarchy(
    hierarchy({ filterSelected: true, content: 'Fashion&#10;AI Filter' }),
    'FILTER_TAG',
  );
  assert.equal(state.effectsTab.selected, true);
  assert.equal(state.topTab.selected, true);
  assert.equal(state.stable, true);
});

test('content markers cannot replace either selected tab', () => {
  const filterWithoutEffects = inspectMoreStyleModuleHierarchy(
    hierarchy({
      effectsSelected: false,
      filterSelected: true,
      content: 'Painting&#10;Studio',
    }),
    'FILTER_TAG',
  );
  const videoWithoutTopSelection = inspectMoreStyleModuleHierarchy(
    hierarchy({
      effectsSelected: true,
      videoSelected: false,
      content: 'Seedance&#10;Social Trend',
    }),
    'VIDEO_TAG',
  );
  assert.equal(filterWithoutEffects.stable, false);
  assert.equal(videoWithoutTopSelection.stable, false);
});

test('rejects unsupported flows instead of weakening the guard', () => {
  assert.throws(
    () => inspectMoreStyleModuleHierarchy(hierarchy(), 'HOME_TAG'),
    /unsupported More Style flow/,
  );
});
