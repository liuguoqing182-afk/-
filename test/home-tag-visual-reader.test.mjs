import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exactVisualHomeTagTitle,
  homeTagTitleHasDecorativeSymbols,
  parseVisibleHomeSectionTitles,
  safeVisualHomeTagTapTarget,
  visualHomeTagTitleTextOnly,
} from '../src/home-tag-visual-reader.mjs';

test('visual Home title cleaning removes only decorative edge symbols', () => {
  assert.equal(
    visualHomeTagTitleTextOnly('🎬 Seedance 2.0 ›'),
    'Seedance 2.0',
  );
  assert.equal(
    visualHomeTagTitleTextOnly('🤮More Style1'),
    'More Style1',
  );
  assert.equal(
    visualHomeTagTitleTextOnly('AI-Filter 2.0'),
    'AI-Filter 2.0',
  );
});

test('decorated Home titles opt into the visual fallback', () => {
  assert.equal(
    homeTagTitleHasDecorativeSymbols('🎬 Seedance 2.0'),
    true,
  );
  assert.equal(homeTagTitleHasDecorativeSymbols('Seedance 2.0'), false);
});

test('parses visual title text and keeps exact matching', () => {
  const response = {
    visibleHomeSectionTitlesText:
      'Fun Pack||🎬 Seedance 2.0 ›||Viral Dance',
  };
  assert.deepEqual(parseVisibleHomeSectionTitles(response), [
    'Fun Pack',
    '🎬 Seedance 2.0 ›',
    'Viral Dance',
  ]);
  assert.equal(
    exactVisualHomeTagTitle(response, '🎬 Seedance 2.0'),
    '🎬 Seedance 2.0 ›',
  );
  assert.equal(exactVisualHomeTagTitle(response, 'Seedance 2.1'), null);
});

test('accepts only a safe title-sized visual location', () => {
  assert.deepEqual(
    safeVisualHomeTagTapTarget({
      center: [180, 920],
      rect: { left: 20, top: 880, width: 400, height: 80 },
    }),
    { x: 180, y: 920 },
  );
  assert.equal(
    safeVisualHomeTagTapTarget({
      center: [180, 2_820],
      rect: { left: 20, top: 2_780, width: 400, height: 80 },
    }),
    null,
  );
  assert.equal(
    safeVisualHomeTagTapTarget({
      center: [720, 1_200],
      rect: { left: 20, top: 900, width: 1_400, height: 600 },
    }),
    null,
  );
});
