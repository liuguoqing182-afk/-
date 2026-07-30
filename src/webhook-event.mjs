const EVENT_TYPE = 'am.home_config.published.v1';
const EVENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

export class WebhookEventValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'WebhookEventValidationError';
    this.field = field;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(input, field, maximumLength) {
  const value = typeof input[field] === 'string' ? input[field].trim() : '';
  if (!value) {
    throw new WebhookEventValidationError(field + ' is required', field);
  }
  if (value.length > maximumLength) {
    throw new WebhookEventValidationError(field + ' is too long', field);
  }
  return value;
}

function normalizeSections(value) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new WebhookEventValidationError('sections must be an object', 'sections');
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, sectionValue]) => [
      String(key),
      String(sectionValue ?? ''),
    ]),
  );
}

export function normalizePublishedWebhookEvent(input) {
  if (!isRecord(input)) {
    throw new WebhookEventValidationError('request body must be a JSON object');
  }
  const eventType = requiredString(input, 'event_type', 100);
  if (eventType !== EVENT_TYPE) {
    throw new WebhookEventValidationError(
      'event_type must be ' + EVENT_TYPE,
      'event_type',
    );
  }
  const eventId = requiredString(input, 'event_id', 128);
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new WebhookEventValidationError('event_id has an invalid format', 'event_id');
  }
  const releaseId = requiredString(input, 'release_id', 200);
  const publishedAt = requiredString(input, 'published_at', 100);
  if (!Number.isFinite(Date.parse(publishedAt))) {
    throw new WebhookEventValidationError('published_at must be ISO-8601', 'published_at');
  }
  const operator = requiredString(input, 'operator', 320);
  const sourceEnvironment = requiredString(input, 'source_environment', 20);
  const targetEnvironment = requiredString(input, 'target_environment', 20);
  if (sourceEnvironment !== 'DEV' || targetEnvironment !== 'PRO') {
    throw new WebhookEventValidationError(
      'only DEV to PRO publication events are accepted',
      'target_environment',
    );
  }
  const status = requiredString(input, 'status', 20);
  if (status !== 'success') {
    throw new WebhookEventValidationError(
      'only successful publication events are accepted',
      'status',
    );
  }
  const notificationText = requiredString(input, 'notification_text', 500_000);
  if (!notificationText.includes('AIMirror') ||
      !notificationText.includes('首屏配置发布成功')) {
    throw new WebhookEventValidationError(
      'notification_text is not an AIMirror home publication notification',
      'notification_text',
    );
  }
  const sections = normalizeSections(input.sections);
  return {
    event_type: eventType,
    event_id: eventId,
    release_id: releaseId,
    published_at: publishedAt,
    operator,
    source_environment: sourceEnvironment,
    target_environment: targetEnvironment,
    status,
    notification_text: notificationText,
    ...(sections === undefined ? {} : { sections }),
  };
}

export { EVENT_TYPE as PUBLISHED_EVENT_TYPE };

