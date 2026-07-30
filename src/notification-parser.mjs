import { parsePublishNotification } from './message-parser.mjs';

export { parsePublishNotification };

const PUBLISH_SUCCESS_PATTERN = /AIMirror\s*首屏配置发布成功[!！]?/;

function cleanUnknownLine(line) {
  return line.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

/**
 * Parse a supported AIMirror notification without requiring the caller to
 * select a message-specific parser first.
 */
export function parseNotification(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Notification input must be a string');
  }

  if (PUBLISH_SUCCESS_PATTERN.test(input)) {
    return parsePublishNotification(input);
  }

  return {
    messageType: 'UNKNOWN',
    valid: false,
    fullyParsed: false,
    unparsedLines: input
      .split(/\r\n?|\n/)
      .map(cleanUnknownLine)
      .filter(Boolean),
    errors: ['无法识别通知类型'],
  };
}
