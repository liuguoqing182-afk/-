import { uniqueVisibleModelNames } from './tag-model-verdict.mjs';

const RESPONSE_KEYS = [
  'tagModelScan',
  'visibleModelTitlesText',
  'visibleModelNames',
  'modelNames',
  'value',
  'result',
  'data',
  'content',
  'output',
  'output_text',
  'text',
  'answer',
  'response',
];

function parseNameText(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed !== text) return parseVisibleModelNames(parsed);
  } catch {}

  return uniqueVisibleModelNames(
    text
      .split(/\s*\|\|\s*|\r?\n|[,，;；]/)
      .map((name) =>
        name
          .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '')
          .replace(/^['“”‘’]+|['“”‘’]+$/g, '')
          .trim(),
      )
      .filter((name) => name && name !== '[]'),
  );
}

export function parseVisibleModelNames(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return [];
  if (typeof value === 'string') return parseNameText(value);
  if (Array.isArray(value)) {
    return uniqueVisibleModelNames(
      value.flatMap((item) => parseVisibleModelNames(item, depth + 1)),
    );
  }
  if (typeof value !== 'object') return [];

  const names = [];
  let recognizedKey = false;
  for (const key of RESPONSE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    recognizedKey = true;
    names.push(...parseVisibleModelNames(value[key], depth + 1));
  }
  if (recognizedKey) return uniqueVisibleModelNames(names);

  const entries = Object.entries(value);
  if (entries.length === 1) {
    return parseVisibleModelNames(entries[0][1], depth + 1);
  }
  return [];
}

export function compactVisionResponse(value, maxLength = 2_000) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  if (serialized === undefined) serialized = String(value);
  return serialized.length <= maxLength
    ? serialized
    : `${serialized.slice(0, maxLength)}…`;
}
