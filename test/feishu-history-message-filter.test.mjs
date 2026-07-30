import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAIMirrorPublishMessages,
  isAIMirrorPublishMessageText,
  isHistoryCandidateCreatedAtOrAfter,
  normalizeHistoryMessageText,
} from '../src/feishu-history-message-filter.mjs';

test('normalizes the publishing bot interactive card and finds it by strict prefix', () => {
  const cardContent = JSON.stringify({
    elements: [{
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**AIMirror首屏配置发布成功!**\n------',
      },
      fields: [{
        is_short: false,
        text: {
          tag: 'lark_md',
          content: '**模版修改:** 模型Farewell Paw图片改变',
        },
      }],
    }],
  });

  const candidates = findAIMirrorPublishMessages([{
    message_id: 'om_release',
    chat_id: 'oc_release',
    create_time: '1784781300000',
    msg_type: 'interactive',
    sender: {
      sender_type: 'app',
      sender_name: '发布机器人',
    },
    body: { content: cardContent },
  }]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].messageId, 'om_release');
  assert.equal(candidates[0].senderType, 'app');
  assert.match(
    candidates[0].notificationText,
    /^AIMirror首屏配置发布成功!\n模版修改:/u,
  );
  assert.doesNotMatch(candidates[0].notificationText, /\*\*|------/u);
});

test('accepts a full-width exclamation mark at the start of a plain message', () => {
  assert.equal(
    isAIMirrorPublishMessageText(
      'AIMirror首屏配置发布成功！\n操作人: user@riverolls.com',
    ),
    true,
  );
});

test('does not match ordinary chat that only quotes the title later', () => {
  assert.equal(
    isAIMirrorPublishMessageText(
      '请帮我巡检下面这条：\nAIMirror首屏配置发布成功!',
    ),
    false,
  );
});

test('does not match inspection reports or deleted publishing messages', () => {
  const messages = [{
    message_id: 'om_report',
    body: {
      content: JSON.stringify({
        text: '【AIMirror 首屏配置巡检】\n巡检结论：通过',
      }),
    },
  }, {
    message_id: 'om_deleted',
    deleted: true,
    body: {
      content: JSON.stringify({
        text: 'AIMirror首屏配置发布成功!\n操作人: user@riverolls.com',
      }),
    },
  }];

  assert.deepEqual(findAIMirrorPublishMessages(messages), []);
});

test('requires the publish-success exclamation mark', () => {
  assert.equal(
    isAIMirrorPublishMessageText('AIMirror首屏配置发布成功\n操作人: user'),
    false,
  );
});

test('normalization removes card markdown without moving the title', () => {
  assert.equal(
    normalizeHistoryMessageText(
      '  **AIMirror首屏配置发布成功!**\r\n------\r\n**操作人:** user  ',
    ),
    'AIMirror首屏配置发布成功!\n操作人: user',
  );
});

test('compares Feishu millisecond create_time without replaying old messages', () => {
  const threshold = Date.parse('2026-07-24T10:00:00.000Z');
  assert.equal(
    isHistoryCandidateCreatedAtOrAfter(
      { createTime: String(threshold - 1) },
      threshold,
    ),
    false,
  );
  assert.equal(
    isHistoryCandidateCreatedAtOrAfter(
      { createTime: String(threshold) },
      threshold,
    ),
    true,
  );
});

test('also accepts second-based timestamps from test fixtures or adapters', () => {
  const threshold = Date.parse('2026-07-24T10:00:00.000Z');
  assert.equal(
    isHistoryCandidateCreatedAtOrAfter(
      { createTime: String(threshold / 1000) },
      threshold,
    ),
    true,
  );
  assert.equal(
    isHistoryCandidateCreatedAtOrAfter({ createTime: null }, threshold),
    false,
  );
});