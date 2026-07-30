import {
  normalizePageText,
  visiblePageText,
} from './scrollable-page-scanner.mjs';

const EMOJI_CHARACTERS =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\uFE0F\u200D]/gu;

export function tagTitleTextOnly(value) {
  return String(value ?? '')
    .replace(EMOJI_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTagTitleText(value) {
  return normalizePageText(tagTitleTextOnly(value));
}

export function exactTagTitleTextVisible(
  hierarchy,
  expectedTitle,
  options,
) {
  const expected = normalizeTagTitleText(expectedTitle);
  return (
    Boolean(expected) &&
    visiblePageText(hierarchy, options).some(
      (value) => normalizeTagTitleText(value) === expected,
    )
  );
}
