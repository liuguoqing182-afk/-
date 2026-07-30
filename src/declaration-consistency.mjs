import { parseNotification } from './notification-parser.mjs';

export const CONSISTENCY_SCHEMA_VERSION = '1.0';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKey(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .trim()
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

function requireKey(value, path) {
  const key = normalizeKey(value);
  if (!key) throw new Error(path + ' 缺失');
  return key;
}

function resolveNotification(value) {
  const notification = typeof value === 'string' ? parseNotification(value) : value;
  if (!isRecord(notification)) {
    throw new TypeError('notification must be text or a parsed notification');
  }
  if (notification.messageType !== 'AM_HOME_CONFIG_PUBLISHED') {
    throw new Error('notification must be an AM home config publish notification');
  }
  if (notification.valid !== true) {
    throw new Error(
      'notification is invalid: ' + (notification.errors ?? []).join('; '),
    );
  }
  if (notification.fullyParsed !== true) {
    throw new Error(
      'notification is not fully parsed: ' +
        (notification.unparsedLines ?? []).join('; '),
    );
  }
  if (!Array.isArray(notification.declaredChanges)) {
    throw new TypeError('notification.declaredChanges must be an array');
  }
  return notification;
}

function resolveDiff(value) {
  if (!isRecord(value)) throw new TypeError('diff must be a PRO release diff report');
  if (value.diffType !== 'PRO_RELEASE_DIFF') {
    throw new Error('diff must have diffType PRO_RELEASE_DIFF');
  }
  if (!isRecord(value.changes)) throw new TypeError('diff.changes must be an object');
  for (const category of ['groups', 'models', 'introPages']) {
    if (!Array.isArray(value.changes[category])) {
      throw new TypeError('diff.changes.' + category + ' must be an array');
    }
  }
  return value;
}

function atom(output, match) {
  return { output, match };
}

function declarationAtoms(change, declarationIndex) {
  if (!isRecord(change) || typeof change.type !== 'string') {
    throw new TypeError(
      'notification.declaredChanges[' + declarationIndex + '] must have a type',
    );
  }
  const base = {
    type: change.type,
    declarationIndex,
    sourceText: change.sourceText ?? null,
  };

  switch (change.type) {
    case 'I18N_MODEL_ADD':
    case 'I18N_MODEL_MODIFY':
      // /config/v4 currently exposes one locale at a time. The notification is
      // still parsed, but locale delivery needs a separate multi-language check.
      return [];
    case 'INSPIRATION_REORDER':
      // Inspiration ordering is declared independently from tag/model ordering
      // and is not represented by the current stable diff schema.
      return [];
    case 'MODEL_CATALOG_ADD':
      return [atom(
        { ...base, modelName: change.modelName },
        {
          type: change.type,
          modelNameKey: requireKey(
            change.modelName,
            change.type + '.modelName',
          ),
        },
      )];
    case 'MODEL_ADD':
    case 'MODEL_DELETE': {
      const tagKey = requireKey(change.tagName, change.type + '.tagName');
      if (!Array.isArray(change.modelIds) || change.modelIds.length === 0) {
        throw new Error(change.type + '.modelIds 缺失');
      }
      return change.modelIds.map((modelId) =>
        atom(
          { ...base, tagName: change.tagName, modelId: String(modelId) },
          {
            type: change.type,
            tagKey,
            modelIdKey: requireKey(modelId, change.type + '.modelId'),
          },
        ),
      );
    }
    case 'MODEL_REORDER':
    case 'GROUP_COVER_CHANGE':
      return [atom(
        { ...base, tagName: change.tagName },
        {
          type: change.type,
          tagKey: requireKey(change.tagName, change.type + '.tagName'),
        },
      )];
    case 'MODEL_IMAGE_CHANGE':
    case 'MODEL_COVER_SERIES_CHANGE':
    case 'MODEL_FIELD_CHANGE':
      return [atom(
        { ...base, modelName: change.modelName },
        {
          type: change.type,
          modelNameKey: requireKey(
            change.modelName,
            change.type + '.modelName',
          ),
        },
      )];
    case 'INTRO_DELETE':
    case 'INTRO_MODIFY':
      return [atom(
        { ...base, introId: change.introId },
        {
          type: change.type,
          introIdKey: requireKey(change.introId, change.type + '.introId'),
        },
      )];
    case 'INTRO_REORDER':
      return [atom(base, { type: change.type })];
    default:
      return [atom(base, { type: change.type })];
  }
}

function conciseActual(change, category, changeIndex) {
  const output = {
    type: change.type,
    category,
    changeIndex,
  };
  for (const field of [
    'key',
    'section',
    'groupId',
    'tagName',
    'modelId',
    'modelName',
    'beforeName',
    'afterName',
    'introId',
    'title',
  ]) {
    if (change[field] !== undefined) output[field] = change[field];
  }
  const group = change.after ?? change.before;
  if (group?.id !== undefined) {
    output.groupId = group.id;
    output.tagName = group.name ?? null;
  }
  if (change.model?.id !== undefined) {
    output.modelId = change.model.id;
    output.modelName = change.model.name ?? null;
  }
  if (change.page?.id !== undefined) {
    output.introId = change.page.id;
    output.title = change.page.title ?? null;
  }
  if (Array.isArray(change.fields)) {
    output.fieldPaths = change.fields.map(({ path }) => path);
  }
  return output;
}

function actualAtoms(change, category, changeIndex) {
  if (!isRecord(change) || typeof change.type !== 'string') {
    throw new TypeError(
      'diff.changes.' + category + '[' + changeIndex + '] must have a type',
    );
  }
  const base = conciseActual(change, category, changeIndex);

  switch (change.type) {
    case 'MODEL_CATALOG_ADD':
      return [atom(base, {
        type: change.type,
        modelNameKeys: [normalizeKey(change.model?.name ?? change.modelName)]
          .filter(Boolean),
      })];
    case 'MODEL_ADD':
    case 'MODEL_DELETE':
      if (!Array.isArray(change.modelIds) || change.modelIds.length === 0) {
        return [atom(base, { type: change.type })];
      }
      return change.modelIds.map((modelId) =>
        atom(
          { ...base, modelId: String(modelId) },
          {
            type: change.type,
            tagKey: normalizeKey(change.tagName),
            modelIdKey: normalizeKey(modelId),
          },
        ),
      );
    case 'MODEL_REORDER':
    case 'GROUP_COVER_CHANGE':
      return [atom(base, {
        type: change.type,
        tagKey: normalizeKey(change.tagName),
      })];
    case 'MODEL_IMAGE_CHANGE': {
      const fields = Array.isArray(change.fields) ? change.fields : [];
      const hasCoverSeries = fields.some(({ path }) =>
        String(path ?? '').split('.').includes('cover_image_series'),
      );
      const hasOtherImages = fields.length === 0 || fields.some(({ path }) =>
        !String(path ?? '').split('.').includes('cover_image_series'),
      );
      return [
        ...(hasOtherImages ? [atom(base, {
          type: 'MODEL_IMAGE_CHANGE',
          modelNameKeys: [normalizeKey(change.modelName)].filter(Boolean),
        })] : []),
        ...(hasCoverSeries ? [atom(
          { ...base, type: 'MODEL_COVER_SERIES_CHANGE' },
          {
            type: 'MODEL_COVER_SERIES_CHANGE',
            modelNameKeys: [normalizeKey(change.modelName)].filter(Boolean),
          },
        )] : []),
      ];
    }
    case 'MODEL_COVER_SERIES_CHANGE':
    case 'MODEL_FIELD_CHANGE':
      return [atom(base, {
        type: change.type,
        modelNameKeys: [normalizeKey(change.modelName)].filter(Boolean),
      })];
    case 'MODEL_RENAME':
      return [atom(base, {
        type: 'MODEL_FIELD_CHANGE',
        modelNameKeys: [
          normalizeKey(change.beforeName),
          normalizeKey(change.afterName),
        ].filter(Boolean),
      })];
    case 'INTRO_DELETE':
      return [atom(base, {
        type: change.type,
        introIdKey: normalizeKey(change.page?.id ?? change.introId),
      })];
    case 'INTRO_MODIFY':
      return [atom(base, {
        type: change.type,
        introIdKey: normalizeKey(change.introId),
      })];
    case 'INTRO_REORDER':
      return [atom(base, { type: change.type })];
    default:
      return [atom(base, { type: change.type })];
  }
}

function atomsMatch(declared, actual) {
  if (declared.type !== actual.type) return false;
  switch (declared.type) {
    case 'MODEL_CATALOG_ADD':
      return actual.modelNameKeys?.includes(declared.modelNameKey) ?? false;
    case 'MODEL_ADD':
    case 'MODEL_DELETE':
      return (
        declared.tagKey === actual.tagKey &&
        declared.modelIdKey === actual.modelIdKey
      );
    case 'MODEL_REORDER':
    case 'GROUP_COVER_CHANGE':
      return declared.tagKey === actual.tagKey;
    case 'MODEL_IMAGE_CHANGE':
    case 'MODEL_COVER_SERIES_CHANGE':
    case 'MODEL_FIELD_CHANGE':
      return actual.modelNameKeys?.includes(declared.modelNameKey) ?? false;
    case 'INTRO_DELETE':
    case 'INTRO_MODIFY':
      return declared.introIdKey === actual.introIdKey;
    case 'INTRO_REORDER':
      return true;
    default:
      return false;
  }
}

function findModelOrderEvidence(declared, actualAtoms) {
  if (declared.type !== 'MODEL_REORDER') return null;
  const candidate = actualAtoms.find(({ match }) =>
    (match.type === 'MODEL_ADD' || match.type === 'MODEL_DELETE') &&
      match.tagKey === declared.tagKey,
  );
  if (!candidate) return null;
  return {
    ...candidate.output,
    evidenceFor: 'MODEL_REORDER',
  };
}

function flattenActualChanges(diff) {
  const atoms = [];
  let actualChanges = 0;
  for (const category of ['groups', 'models', 'introPages']) {
    for (const [changeIndex, change] of diff.changes[category].entries()) {
      actualChanges += 1;
      atoms.push(...actualAtoms(change, category, changeIndex));
    }
  }
  return { atoms, actualChanges };
}

/**
 * Check whether every declared notification change happened in the PRO release
 * diff and whether the PRO release contains undeclared changes.
 */
export function checkDeclarationConsistency(input) {
  if (!isRecord(input)) {
    throw new TypeError('Consistency check input must be an object');
  }
  const notification = resolveNotification(input.notification);
  const diff = resolveDiff(input.diff);
  const declaredAtoms = notification.declaredChanges.flatMap(
    (change, index) => declarationAtoms(change, index),
  );
  const actual = flattenActualChanges(diff);
  const usedActualIndexes = new Set();
  const matches = [];
  const missingDeclarations = [];

  for (const declared of declaredAtoms) {
    const actualIndex = actual.atoms.findIndex(
      (candidate, index) =>
        !usedActualIndexes.has(index) && atomsMatch(declared.match, candidate.match),
    );
    if (actualIndex === -1) {
      const orderingEvidence = findModelOrderEvidence(declared.match, actual.atoms);
      if (orderingEvidence) {
        matches.push({
          declared: declared.output,
          actual: orderingEvidence,
        });
        continue;
      }
      missingDeclarations.push(declared.output);
      continue;
    }
    usedActualIndexes.add(actualIndex);
    matches.push({
      declared: declared.output,
      actual: actual.atoms[actualIndex].output,
    });
  }

  const unexpectedChanges = actual.atoms
    .filter((_, index) => !usedActualIndexes.has(index))
    .map(({ output }) => output);
  const consistent =
    missingDeclarations.length === 0 && unexpectedChanges.length === 0;

  return {
    schemaVersion: CONSISTENCY_SCHEMA_VERSION,
    checkType: 'PUBLISH_DECLARATION_CONSISTENCY',
    consistent,
    notification: {
      messageType: notification.messageType,
      operator: notification.operator,
      sourceEnvironment: notification.sourceEnvironment,
      targetEnvironment: notification.targetEnvironment,
      declaredChanges: notification.declaredChanges.length,
    },
    diff: {
      diffType: diff.diffType,
      environment: diff.environment,
      hasChanges: diff.hasChanges,
      actualChanges: actual.actualChanges,
    },
    summary: {
      declaredAssertions: declaredAtoms.length,
      actualAssertions: actual.atoms.length,
      matchedAssertions: matches.length,
      missingDeclarations: missingDeclarations.length,
      unexpectedChanges: unexpectedChanges.length,
    },
    matches,
    missingDeclarations,
    unexpectedChanges,
  };
}
