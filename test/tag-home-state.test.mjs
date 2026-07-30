import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TAG_HOME_ACTIONS,
  TAG_HOME_RECOVERY_TIMEOUT_MS,
  inspectTagHomeHierarchy,
  safeAccountDrawerDismissTarget,
  tagHomeActionForHierarchy,
} from '../src/tag-home-state.mjs';

function homeHierarchy({
  selected = true,
  inspiration = true,
  drawer = false,
} = {}) {
  return `<hierarchy>
    <node text="" content-desc="" clickable="true" bounds="[0,0][1440,2874]" />
    ${
      inspiration
        ? '<node text="" content-desc="✨ Inspiration" clickable="false" bounds="[0,692][1440,1614]" />'
        : ''
    }
    <node text="" content-desc="New&#10;ALBUM" clickable="true" selected="false" bounds="[70,951][441,1508]" />
    <node text="" content-desc="Home&#10;Tab 2 of 3" clickable="true" selected="${selected}" bounds="[492,2812][948,2874]" />
    ${
      drawer
        ? `<node text="" content-desc="Credit Details &gt;" clickable="true" bounds="[934,215][1241,282]" />
           <node text="" content-desc="User ID" clickable="true" bounds="[640,830][1440,1033]" />`
        : ''
    }
  </hierarchy>`;
}

test('stable Home is accepted without another tap', () => {
  const hierarchy = homeHierarchy();
  const decision = tagHomeActionForHierarchy(hierarchy);

  assert.equal(TAG_HOME_RECOVERY_TIMEOUT_MS, 110_000);
  assert.equal(decision.action, TAG_HOME_ACTIONS.DONE);
  assert.equal(decision.state.homeTab.selected, true);
  assert.equal(decision.state.homeContentVisible, true);
  assert.equal(decision.state.accountDrawerVisible, false);
});

test('Home selection and Home content are sufficient even when the drawer is visible', () => {
  const decision = tagHomeActionForHierarchy(
    homeHierarchy({ drawer: true }),
  );

  assert.equal(decision.action, TAG_HOME_ACTIONS.DONE);
  assert.equal(decision.state.stable, true);
  assert.equal(decision.state.accountDrawerVisible, true);
});

test('drawer fallback chooses a safe header point outside the New card', () => {
  const target = safeAccountDrawerDismissTarget(
    homeHierarchy({ drawer: true }),
  );

  assert.ok(target);
  assert.ok(target.x < 640);
  assert.ok(target.y < 951);
  assert.equal(
    target.x >= 70 &&
      target.x < 441 &&
      target.y >= 951 &&
      target.y < 1508,
    false,
  );
  assert.notDeepEqual(target, { x: 200, y: 1200 });
});

test('a visible but unselected Home tab is tapped at its tree bounds', () => {
  const decision = tagHomeActionForHierarchy(
    homeHierarchy({ selected: false }),
  );

  assert.equal(decision.action, TAG_HOME_ACTIONS.TAP_HOME);
  assert.deepEqual(decision.tapTarget, { x: 720, y: 2843 });
});

test('Home selection alone is insufficient without Home content', () => {
  const state = inspectTagHomeHierarchy(
    homeHierarchy({ inspiration: false }),
  );
  const decision = tagHomeActionForHierarchy(
    homeHierarchy({ inspiration: false }),
  );

  assert.equal(state.stable, false);
  assert.equal(decision.action, TAG_HOME_ACTIONS.BACK);
});

test('the documented Home bottom marker counts as Home content', () => {
  const hierarchy = homeHierarchy({ inspiration: false }).replace(
    '</hierarchy>',
    '<node text="" content-desc="More Content is Coming!" clickable="false" bounds="[0,2200][1440,2600]" /></hierarchy>',
  );

  assert.equal(inspectTagHomeHierarchy(hierarchy).stable, true);
});
