import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  parseNotification,
  parsePublishNotification,
} from '../src/notification-parser.mjs';

test('public parser dispatches the captured publish notification', async () => {
  const fixtureUrl = new URL('../fixtures/publish-message.txt', import.meta.url);
  const message = await fs.readFile(fixtureUrl, 'utf8');
  const result = parseNotification(message);

  assert.equal(result.messageType, 'AM_HOME_CONFIG_PUBLISHED');
  assert.equal(result.valid, true);
  assert.equal(result.fullyParsed, true);
  assert.equal(result.declaredChanges.length, 10);
});

test('public module keeps the message-specific parser available', () => {
  const result = parsePublishNotification(`AIMirror首屏配置发布成功!
操作人: user@example.com
发布环境: 从DEV发布到PRO`);

  assert.equal(result.valid, true);
});

test('returns a stable invalid result for an unsupported notification', () => {
  const result = parseNotification('这是一条尚未支持的通知');

  assert.deepEqual(result, {
    messageType: 'UNKNOWN',
    valid: false,
    fullyParsed: false,
    unparsedLines: ['这是一条尚未支持的通知'],
    errors: ['无法识别通知类型'],
  });
});

test('rejects non-string input', () => {
  assert.throws(() => parseNotification(null), {
    name: 'TypeError',
    message: 'Notification input must be a string',
  });
});
