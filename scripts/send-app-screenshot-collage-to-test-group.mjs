import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const IMAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/images';
const MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--')) continue;
    parsed[key.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function loadEnvText(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function loadEnvFiles(root) {
  for (const name of ['.env', '.env.local']) {
    try {
      loadEnvText(await fs.readFile(path.join(root, name), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function responseJson(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(`${label} failed: HTTP ${response.status}, code=${data.code}, message=${data.msg || data.message || 'unknown error'}`);
  }
  return data;
}

async function getTenantToken({ appId, appSecret }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await responseJson(response, 'tenant token request');
  if (!data.tenant_access_token) throw new Error('tenant token response did not contain a token');
  return data.tenant_access_token;
}

async function uploadImage({ token, filePath, fileData }) {
  const mimeType = path.extname(filePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([fileData], { type: mimeType }), path.basename(filePath));
  const response = await fetch(IMAGE_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await responseJson(response, 'image upload');
  const imageKey = data.data?.image_key;
  if (!imageKey) throw new Error('image upload response has no image_key');
  return imageKey;
}

async function sendImage({ token, chatId, imageKey }) {
  const response = await fetch(MESSAGE_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey }),
    }),
  });
  const data = await responseJson(response, 'image message');
  const messageId = data.data?.message_id;
  if (!messageId) throw new Error('image message response has no message_id');
  return messageId;
}

const args = parseArgs(process.argv.slice(2));
if (!args.image) throw new Error('--image <path> is required');
if (!args.receipt) throw new Error('--receipt <path> is required');

const root = path.resolve(args.root || process.cwd());
await loadEnvFiles(root);
const appId = requiredEnvironment('FEISHU_APP_ID');
const appSecret = requiredEnvironment('FEISHU_APP_SECRET');
const formalChatId = requiredEnvironment('FEISHU_CHAT_ID');
const testChatId = requiredEnvironment('FEISHU_TEST_CHAT_ID');
if (formalChatId === testChatId) {
  throw new Error('Refusing to send: formal and test chat IDs are identical');
}

const imagePath = path.resolve(args.image);
const receiptPath = path.resolve(args.receipt);
const fileData = await fs.readFile(imagePath);
if (fileData.length > 10 * 1024 * 1024) {
  throw new Error(`Image exceeds 10 MiB: ${fileData.length} bytes`);
}
const sha256 = crypto.createHash('sha256').update(fileData).digest('hex');

try {
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  if (receipt.sha256 === sha256 && receipt.target === 'TEST_GROUP_ONLY' && receipt.messageId) {
    console.log(JSON.stringify({ alreadySent: true, target: receipt.target, messageId: receipt.messageId, sha256 }));
    process.exit(0);
  }
  throw new Error('Receipt exists but does not match this image');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const token = await getTenantToken({ appId, appSecret });
const imageKey = await uploadImage({ token, filePath: imagePath, fileData });
const messageId = await sendImage({ token, chatId: testChatId, imageKey });
const receipt = {
  receiptType: 'AM_APP_SCREENSHOT_TEST_GROUP_DELIVERY_V1',
  target: 'TEST_GROUP_ONLY',
  imagePath,
  sha256,
  bytes: fileData.length,
  imageKey,
  messageId,
  sentAt: new Date().toISOString(),
};
await fs.mkdir(path.dirname(receiptPath), { recursive: true });
await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ alreadySent: false, target: receipt.target, messageId, sha256, bytes: fileData.length }));
