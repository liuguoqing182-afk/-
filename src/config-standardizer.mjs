export const SNAPSHOT_SCHEMA_VERSION = '1.0';

const SECTION_DEFINITIONS = [
  ['tabs', 'TABS'],
  ['ai_video_tabs', 'AI_VIDEO_TABS'],
  ['ai_filter_tabs', 'AI_FILTER_TABS'],
  ['ai_editor_tabs', 'AI_EDITOR_TABS'],
];

const SET_LIKE_FIELDS = new Set([
  'exclude_countries',
  'exclude_platforms',
  'support_apps',
  'support_platforms',
  'support_stores',
]);

const MODEL_IMAGE_FIELDS = [
  'background_color',
  'cover_image_blur_hash',
  'cover_image_series',
  'cover_image_url',
  'cover_image_url2',
  'cover_width_height_ratio',
  'logo_image_url',
  'more_style_image',
  'video_compare_url',
];

const MODEL_IDENTITY_FIELDS = new Set(['model_id', 'model_name']);
const GROUP_IDENTITY_FIELDS = new Set([
  'local_tab_name',
  'model_id_list',
  'select_cover_image_indexes',
  'tab_id',
  'tab_name',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeId(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim().normalize('NFC');
}

function normalizeLabel(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().normalize('NFC');
}

function stableCompare(left, right) {
  return String(left).localeCompare(String(right), 'en', {
    numeric: true,
    sensitivity: 'variant',
  });
}

function canonicalize(value, fieldName = null) {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (
    fieldName &&
    /(?:^|_)id$/.test(fieldName) &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    return normalizeId(value);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item, fieldName));
    if (!SET_LIKE_FIELDS.has(fieldName)) return items;
    return items.sort((left, right) =>
      stableCompare(JSON.stringify(left), JSON.stringify(right)),
    );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(stableCompare)
        .map((key) => [key, canonicalize(value[key], key)]),
    );
  }
  throw new TypeError(`Unsupported snapshot value: ${typeof value}`);
}

function remainingFields(record, excludedFields) {
  return canonicalize(
    Object.fromEntries(
      Object.entries(record).filter(([key]) => !excludedFields.has(key)),
    ),
  );
}

function readArray(value, path, errors) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  errors.push(`${path} 必须是数组`);
  return [];
}

function unwrapModels(payload) {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.models)) return payload.models;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  throw new TypeError('models must be an array or an object containing models/data');
}

function standardizeGroups(config, errors, warnings) {
  const groups = [];
  const identities = new Set();

  for (const [sourceKey, section] of SECTION_DEFINITIONS) {
    const sectionGroups = readArray(config[sourceKey], `config.${sourceKey}`, errors);
    for (const [index, group] of sectionGroups.entries()) {
      const path = `config.${sourceKey}[${index}]`;
      if (!isRecord(group)) {
        errors.push(`${path} 必须是对象`);
        continue;
      }

      const id = normalizeId(group.tab_id);
      const name = normalizeLabel(group.tab_name);
      if (!id) errors.push(`${path}.tab_id 缺失`);
      if (!name) warnings.push(`${path}.tab_name 缺失`);

      const identity = `${section}:${id ?? `@${index}`}`;
      if (identities.has(identity)) errors.push(`分组标识重复: ${identity}`);
      identities.add(identity);

      const modelIds = readArray(group.model_id_list, `${path}.model_id_list`, errors)
        .map(normalizeId)
        .filter(Boolean);
      const coverSelection = readArray(
        group.select_cover_image_indexes,
        `${path}.select_cover_image_indexes`,
        errors,
      ).map((value) => canonicalize(value));

      groups.push({
        section,
        sourceKey,
        order: index + 1,
        id,
        name,
        localName: normalizeLabel(group.local_tab_name),
        modelIds,
        coverSelection,
        fields: remainingFields(group, GROUP_IDENTITY_FIELDS),
      });
    }
  }

  return groups;
}

function standardizeModels(modelPayload, errors, warnings) {
  const models = [];
  const ids = new Set();

  for (const [index, model] of unwrapModels(modelPayload).entries()) {
    const path = `models[${index}]`;
    if (!isRecord(model)) {
      errors.push(`${path} 必须是对象`);
      continue;
    }

    const id = normalizeId(model.model_id);
    const name = normalizeLabel(model.model_name);
    if (!id) errors.push(`${path}.model_id 缺失`);
    if (!name) warnings.push(`${path}.model_name 缺失`);
    if (id && ids.has(id)) errors.push(`模型 ID 重复: ${id}`);
    if (id) ids.add(id);

    const images = Object.fromEntries(
      MODEL_IMAGE_FIELDS.map((field) => [field, canonicalize(model[field], field)]),
    );
    const excludedFields = new Set([...MODEL_IDENTITY_FIELDS, ...MODEL_IMAGE_FIELDS]);
    models.push({
      id,
      name,
      images,
      fields: remainingFields(model, excludedFields),
    });
  }

  return models.sort((left, right) =>
    stableCompare(left.id ?? '', right.id ?? '') ||
    stableCompare(left.name ?? '', right.name ?? ''),
  );
}

function standardizeIntroPages(config, errors, warnings) {
  const pages = [];
  const ids = new Set();
  const introList = readArray(config.intro_list, 'config.intro_list', errors);

  for (const [index, page] of introList.entries()) {
    const path = `config.intro_list[${index}]`;
    if (!isRecord(page)) {
      errors.push(`${path} 必须是对象`);
      continue;
    }

    const id = normalizeId(page.intro_page_config_id);
    if (!id) errors.push(`${path}.intro_page_config_id 缺失`);
    if (id && ids.has(id)) errors.push(`新手引导页 ID 重复: ${id}`);
    if (id) ids.add(id);
    if (!page.title) warnings.push(`${path}.title 缺失`);

    pages.push({
      order: index + 1,
      id,
      fields: remainingFields(page, new Set(['intro_page_config_id'])),
    });
  }

  return pages;
}

/**
 * Convert raw AM home config and model payloads into a deterministic snapshot.
 * Semantic list order is retained; catalog order and set-like fields are made
 * stable so DEV/PRO comparisons do not report transport-order noise.
 */
export function standardizeConfigSnapshot(input) {
  if (!isRecord(input)) throw new TypeError('Standardizer input must be an object');
  const config = input.config ?? input.homeConfig;
  if (!isRecord(config)) throw new TypeError('config must be an object');
  if (input.models === undefined) throw new TypeError('models is required');

  const errors = [];
  const warnings = [];
  const groups = standardizeGroups(config, errors, warnings);
  const models = standardizeModels(input.models, errors, warnings);
  const introPages = standardizeIntroPages(config, errors, warnings);
  const environment = input.environment == null
    ? null
    : String(input.environment).trim().toUpperCase();

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotType: 'AM_HOME_CONFIG',
    environment,
    metadata: {
      lastUpdateTime: canonicalize(config.last_update_time),
      version: canonicalize(config.version),
      modelUrl: canonicalize(config.model_url),
    },
    counts: {
      groups: groups.length,
      models: models.length,
      introPages: introPages.length,
    },
    groups,
    models,
    introPages,
    valid: errors.length === 0,
    diagnostics: { errors, warnings },
  };
}

export const standardizeHomeConfig = standardizeConfigSnapshot;
