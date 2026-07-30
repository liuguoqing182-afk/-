import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exactTagTitleTextVisible,
  normalizeTagTitleText,
  tagTitleTextOnly,
} from '../src/tag-title-text.mjs';

test('removes decorative emoji while preserving the exact tag text', () => {
  assert.equal(
    tagTitleTextOnly('🎬  Seedance 2.0'),
    'Seedance 2.0',
  );
  assert.equal(
    normalizeTagTitleText('🎬 Seedance 2.0'),
    'seedance 2.0',
  );
});

test('matches the same exact tag text with or without emoji', () => {
  const withoutEmoji = `<hierarchy>
    <node text="Seedance 2.0" bounds="[20,300][500,380]" />
  </hierarchy>`;
  const withEmoji = `<hierarchy>
    <node text="🎬 Seedance 2.0" bounds="[20,300][500,380]" />
  </hierarchy>`;

  assert.equal(
    exactTagTitleTextVisible(withoutEmoji, '🎬 Seedance 2.0'),
    true,
  );
  assert.equal(
    exactTagTitleTextVisible(withEmoji, 'Seedance 2.0'),
    true,
  );
});

test('does not weaken tag matching into a fuzzy text match', () => {
  const hierarchy = `<hierarchy>
    <node text="Seedance 2.1" bounds="[20,300][500,380]" />
  </hierarchy>`;
  assert.equal(
    exactTagTitleTextVisible(hierarchy, '🎬 Seedance 2.0'),
    false,
  );
});
