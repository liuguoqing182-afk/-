import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMessageDeduplicator,
  extractFeishuMessageText,
  routeFeishuHealthCheck,
  routeFeishuMessage,
} from '../src/feishu-events.mjs';

test('extracts plain text and routes only AM publish messages in the target chat', () => {
  const data = {
    event: {
      sender: { sender_type: 'user' },
      message: {
        chat_id: 'oc_target',
        message_id: 'om_1',
        content: JSON.stringify({
          text: 'AIMirror首屏配置发布成功!\n操作人: user@example.com',
        }),
      },
    },
  };

  const routed = routeFeishuMessage(data, { chatId: 'oc_target' });

  assert.equal(routed.accepted, true);
  assert.equal(routed.messageId, 'om_1');
  assert.match(routed.text, /AIMirror首屏配置发布成功/);
  assert.equal(routeFeishuMessage(data, { chatId: 'oc_other' }).reason, 'OTHER_CHAT');
});

test('extracts rich-text post notifications', () => {
  const message = {
    content: JSON.stringify({
      zh_cn: {
        title: 'AIMirror首屏配置发布成功!',
        content: [[
          { tag: 'text', text: '模版修改: 新增模型: Paw Hug' },
          { tag: 'at', user_name: '巡检机器人' },
        ]],
      },
    }),
  };

  const text = extractFeishuMessageText(message);

  assert.match(text, /^AIMirror首屏配置发布成功!/);
  assert.match(text, /新增模型: Paw Hug/);
  assert.match(text, /@巡检机器人/);
});

test('extracts interactive cards sent by the publishing custom bot', () => {
  const message = {
    content: JSON.stringify({
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
    }),
  };

  const text = extractFeishuMessageText(message);

  assert.match(text, /AIMirror首屏配置发布成功!/);
  assert.match(text, /模型Farewell Paw图片改变/);
});

test('removes a leading @ mention before handing the notification to the parser', () => {
  const routed = routeFeishuMessage({
    message: {
      chat_id: 'oc_target',
      message_id: 'om_mention',
      content: JSON.stringify({
        text: '@巡检机器人 AIMirror首屏配置发布成功!\n操作人: user@example.com',
      }),
    },
  }, { chatId: 'oc_target' });

  assert.equal(routed.accepted, true);
  assert.match(routed.text, /^AIMirror首屏配置发布成功!/);
  assert.doesNotMatch(routed.text, /@巡检机器人/);
});

test('routes a bot mention in the test chat as a health check', () => {
  const data = {
    event: {
      sender: { sender_type: 'user' },
      message: {
        chat_id: 'oc_test',
        message_id: 'om_health',
        content: JSON.stringify({ text: '@巡检机器人 状态' }),
      },
    },
  };

  const routed = routeFeishuHealthCheck(data, { chatId: 'oc_test' });

  assert.equal(routed.accepted, true);
  assert.equal(routed.messageId, 'om_health');
  assert.equal(routed.command, '状态');
  assert.equal(routeFeishuHealthCheck(data, { chatId: 'oc_release' }).reason, 'OTHER_CHAT');
});

test('accepts a bare mention but ignores ordinary and unsupported test-chat messages', () => {
  const message = (text) => ({
    message: {
      chat_id: 'oc_test',
      message_id: 'om_test',
      content: JSON.stringify({ text }),
    },
  });

  assert.equal(routeFeishuHealthCheck(message('@巡检机器人'), { chatId: 'oc_test' }).accepted, true);
  assert.equal(
    routeFeishuHealthCheck(message('普通群消息'), { chatId: 'oc_test' }).reason,
    'BOT_NOT_MENTIONED',
  );
  assert.equal(
    routeFeishuHealthCheck(message('@巡检机器人 执行发布'), { chatId: 'oc_test' }).reason,
    'NOT_HEALTH_CHECK',
  );
});

test('deduplicates message IDs with a bounded cache', () => {
  const isDuplicate = createMessageDeduplicator(2);
  assert.equal(isDuplicate('1'), false);
  assert.equal(isDuplicate('1'), true);
  assert.equal(isDuplicate('2'), false);
  assert.equal(isDuplicate('3'), false);
  assert.equal(isDuplicate('1'), false);
});
