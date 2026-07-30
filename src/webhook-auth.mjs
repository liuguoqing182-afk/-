import crypto from 'node:crypto';

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value ?? ''), 'utf8');
}

function canonicalPayload(timestamp, deliveryId, rawBody) {
  return Buffer.concat([
    Buffer.from(String(timestamp) + '\n' + String(deliveryId) + '\n', 'utf8'),
    asBuffer(rawBody),
  ]);
}

export function createWebhookSignature({
  secret,
  timestamp,
  deliveryId,
  rawBody,
}) {
  if (!secret) throw new TypeError('webhook secret is required');
  if (!timestamp) throw new TypeError('webhook timestamp is required');
  if (!deliveryId) throw new TypeError('webhook delivery ID is required');
  return crypto
    .createHmac('sha256', asBuffer(secret))
    .update(canonicalPayload(timestamp, deliveryId, rawBody))
    .digest('hex');
}

function parseSignature(value) {
  const match = /^sha256=([a-fA-F0-9]{64})$/.exec(String(value ?? '').trim());
  return match ? Buffer.from(match[1], 'hex') : null;
}

export function verifyWebhookSignature({
  secret,
  timestamp,
  deliveryId,
  signature,
  rawBody,
  nowMs = Date.now(),
  maxSkewSeconds = 300,
}) {
  if (!secret || !timestamp || !deliveryId || !signature) {
    return { valid: false, reason: 'MISSING_AUTHENTICATION' };
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    return { valid: false, reason: 'INVALID_TIMESTAMP' };
  }
  if (!Number.isFinite(maxSkewSeconds) || maxSkewSeconds < 0) {
    throw new TypeError('maxSkewSeconds must be a non-negative number');
  }
  const skewSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (skewSeconds > maxSkewSeconds) {
    return { valid: false, reason: 'EXPIRED_TIMESTAMP' };
  }
  const received = parseSignature(signature);
  if (!received) return { valid: false, reason: 'INVALID_SIGNATURE_FORMAT' };
  const expected = Buffer.from(
    createWebhookSignature({ secret, timestamp, deliveryId, rawBody }),
    'hex',
  );
  return crypto.timingSafeEqual(received, expected)
    ? { valid: true, reason: null }
    : { valid: false, reason: 'SIGNATURE_MISMATCH' };
}

