import { isDeepStrictEqual } from 'node:util';

import { standardizeConfigSnapshot } from './config-standardizer.mjs';

export const DIFF_SCHEMA_VERSION = '1.0';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  return value === undefined ? null : structuredClone(value);
}

function stableCompare(left, right) {
  return String(left).localeCompare(String(right), 'en', {
    numeric: true,
    sensitivity: 'variant',
  });
}

function assertSnapshot(snapshot, label) {
  if (!isRecord(snapshot) || snapshot.snapshotType !== 'AM_HOME_CONFIG') {
    throw new TypeError(label + ' must be a standardized AM_HOME_CONFIG snapshot');
  }
  for (const field of ['groups', 'models', 'introPages']) {
    if (!Array.isArray(snapshot[field])) {
      throw new TypeError(label + '.' + field + ' must be an array');
    }
  }
  if (snapshot.valid === false) {
    const errors = snapshot.diagnostics?.errors ?? [];
    throw new Error(label + ' snapshot is invalid: ' + errors.join('; '));
  }
}

function resolveSnapshot(value, label, environment = null) {
  if (isRecord(value) && value.snapshotType === 'AM_HOME_CONFIG') {
    assertSnapshot(value, label);
    return value;
  }
  if (!isRecord(value)) {
    throw new TypeError(label + ' must be a snapshot or raw config input');
  }
  const snapshot = standardizeConfigSnapshot({
    ...value,
    environment: environment ?? value.environment,
  });
  assertSnapshot(snapshot, label);
  return snapshot;
}

function mapUnique(items, keyOf, label) {
  const result = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (result.has(key)) throw new Error(label + ' contains duplicate key: ' + key);
    result.set(key, item);
  }
  return result;
}

function diffFields(before, after) {
  const differences = [];

  function visit(beforeValue, afterValue, path, beforeExists, afterExists) {
    if (
      beforeExists &&
      afterExists &&
      isDeepStrictEqual(beforeValue, afterValue)
    ) {
      return;
    }

    if (beforeExists && afterExists && isRecord(beforeValue) && isRecord(afterValue)) {
      const keys = [...new Set([
        ...Object.keys(beforeValue),
        ...Object.keys(afterValue),
      ])].sort(stableCompare);
      for (const key of keys) {
        const childPath = path ? path + '.' + key : key;
        visit(
          beforeValue[key],
          afterValue[key],
          childPath,
          Object.hasOwn(beforeValue, key),
          Object.hasOwn(afterValue, key),
        );
      }
      return;
    }

    differences.push({
      path: path || '$',
      beforeExists,
      afterExists,
      before: beforeExists ? cloneValue(beforeValue) : null,
      after: afterExists ? cloneValue(afterValue) : null,
    });
  }

  visit(before, after, '', true, true);
  return differences;
}

function unmatchedInOrder(source, other) {
  const remaining = new Map();
  for (const item of other) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  return source.filter((item) => {
    const count = remaining.get(item) ?? 0;
    if (count === 0) return true;
    remaining.set(item, count - 1);
    return false;
  });
}

function commonInOrder(source, other) {
  const remaining = new Map();
  for (const item of other) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  return source.filter((item) => {
    const count = remaining.get(item) ?? 0;
    if (count === 0) return false;
    remaining.set(item, count - 1);
    return true;
  });
}

function sequenceChanges(before, after) {
  const added = unmatchedInOrder(after, before);
  const removed = unmatchedInOrder(before, after);
  const commonBefore = commonInOrder(before, after);
  const commonAfter = commonInOrder(after, before);
  return {
    added,
    removed,
    orderChanged: !isDeepStrictEqual(commonBefore, commonAfter),
  };
}

function summarizeGroup(group) {
  return {
    section: group.section,
    id: group.id,
    name: group.name,
    order: group.order,
    modelIds: cloneValue(group.modelIds),
    coverSelection: cloneValue(group.coverSelection),
  };
}

function summarizeModel(model) {
  return { id: model.id, name: model.name };
}

function summarizeIntroPage(page) {
  return { id: page.id, order: page.order, title: page.fields?.title ?? null };
}

function selectedGroupCoverResources(group, modelMap) {
  const resources = [];
  for (const [index, modelId] of group.modelIds.entries()) {
    const selectedIndex = Number(group.coverSelection[index]);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0) continue;
    const series = modelMap.get(modelId)?.images?.cover_image_series;
    if (!Array.isArray(series) || series[selectedIndex] == null) continue;
    resources.push({
      modelId,
      selectedIndex,
      resource: cloneValue(series[selectedIndex]),
    });
  }
  return resources;
}

function diffGroups(beforeGroups, afterGroups, afterModels) {
  const changes = [];
  const keyOf = (group) => group.section + ':' + group.id;
  const beforeMap = mapUnique(beforeGroups, keyOf, 'before.groups');
  const afterMap = mapUnique(afterGroups, keyOf, 'after.groups');
  const afterModelMap = mapUnique(afterModels, (model) => model.id, 'after.models');

  for (const group of beforeGroups) {
    const key = keyOf(group);
    if (!afterMap.has(key)) {
      changes.push({ type: 'GROUP_DELETE', key, before: summarizeGroup(group) });
    }
  }
  for (const group of afterGroups) {
    const key = keyOf(group);
    if (!beforeMap.has(key)) {
      changes.push({
        type: 'GROUP_ADD',
        key,
        after: summarizeGroup(group),
        afterFields: cloneValue(group.fields),
        afterSelectedCovers: selectedGroupCoverResources(group, afterModelMap),
      });
    }
  }

  for (const before of beforeGroups) {
    const key = keyOf(before);
    const after = afterMap.get(key);
    if (!after) continue;
    const identity = {
      key,
      section: after.section,
      groupId: after.id,
      tagName: after.name ?? before.name,
    };

    if (before.order !== after.order) {
      changes.push({
        type: 'GROUP_REORDER',
        ...identity,
        beforeOrder: before.order,
        afterOrder: after.order,
      });
    }

    const models = sequenceChanges(before.modelIds, after.modelIds);
    if (models.added.length > 0) {
      changes.push({ type: 'MODEL_ADD', ...identity, modelIds: models.added });
    }
    if (models.removed.length > 0) {
      changes.push({ type: 'MODEL_DELETE', ...identity, modelIds: models.removed });
    }
    if (models.orderChanged) {
      changes.push({
        type: 'MODEL_REORDER',
        ...identity,
        beforeModelIds: cloneValue(before.modelIds),
        afterModelIds: cloneValue(after.modelIds),
      });
    }

    if (!isDeepStrictEqual(before.coverSelection, after.coverSelection)) {
      changes.push({
        type: 'GROUP_COVER_CHANGE',
        ...identity,
        beforeCoverSelection: cloneValue(before.coverSelection),
        afterCoverSelection: cloneValue(after.coverSelection),
        afterSelectedCovers: selectedGroupCoverResources(after, afterModelMap),
      });
    }

    const fields = diffFields(
      { name: before.name, localName: before.localName, fields: before.fields },
      { name: after.name, localName: after.localName, fields: after.fields },
    );
    if (fields.length > 0) {
      changes.push({ type: 'GROUP_FIELD_CHANGE', ...identity, fields });
    }
  }

  return changes;
}

function diffModels(beforeModels, afterModels) {
  const changes = [];
  const keyOf = (model) => model.id;
  const beforeMap = mapUnique(beforeModels, keyOf, 'before.models');
  const afterMap = mapUnique(afterModels, keyOf, 'after.models');

  for (const model of beforeModels) {
    if (!afterMap.has(model.id)) {
      changes.push({ type: 'MODEL_CATALOG_DELETE', model: summarizeModel(model) });
    }
  }
  for (const model of afterModels) {
    if (!beforeMap.has(model.id)) {
      changes.push({
        type: 'MODEL_CATALOG_ADD',
        model: summarizeModel(model),
        afterImages: cloneValue(model.images),
      });
    }
  }

  for (const before of beforeModels) {
    const after = afterMap.get(before.id);
    if (!after) continue;
    const identity = { modelId: after.id, modelName: after.name ?? before.name };

    if (before.name !== after.name) {
      changes.push({
        type: 'MODEL_RENAME',
        ...identity,
        beforeName: before.name,
        afterName: after.name,
      });
    }
    const images = diffFields(before.images, after.images);
    if (images.length > 0) {
      changes.push({ type: 'MODEL_IMAGE_CHANGE', ...identity, fields: images });
    }
    const fields = diffFields(before.fields, after.fields);
    if (fields.length > 0) {
      changes.push({ type: 'MODEL_FIELD_CHANGE', ...identity, fields });
    }
  }

  return changes;
}

function diffIntroPages(beforePages, afterPages) {
  const changes = [];
  const keyOf = (page) => page.id;
  const beforeMap = mapUnique(beforePages, keyOf, 'before.introPages');
  const afterMap = mapUnique(afterPages, keyOf, 'after.introPages');

  for (const page of beforePages) {
    if (!afterMap.has(page.id)) {
      changes.push({ type: 'INTRO_DELETE', page: summarizeIntroPage(page) });
    }
  }
  for (const page of afterPages) {
    if (!beforeMap.has(page.id)) {
      changes.push({
        type: 'INTRO_ADD',
        page: summarizeIntroPage(page),
        afterFields: cloneValue(page.fields),
      });
    }
  }

  const beforeIds = beforePages.map(({ id }) => id);
  const afterIds = afterPages.map(({ id }) => id);
  if (sequenceChanges(beforeIds, afterIds).orderChanged) {
    changes.push({
      type: 'INTRO_REORDER',
      beforeIntroIds: beforeIds,
      afterIntroIds: afterIds,
    });
  }

  for (const before of beforePages) {
    const after = afterMap.get(before.id);
    if (!after) continue;
    const fields = diffFields(before.fields, after.fields);
    if (fields.length > 0) {
      changes.push({
        type: 'INTRO_MODIFY',
        introId: after.id,
        title: after.fields?.title ?? before.fields?.title ?? null,
        fields,
      });
    }
  }

  return changes;
}

function buildSummary(changes) {
  const all = [
    ...changes.groups,
    ...changes.models,
    ...changes.introPages,
  ];
  const byType = {};
  for (const change of all) byType[change.type] = (byType[change.type] ?? 0) + 1;
  return {
    totalChanges: all.length,
    groupChanges: changes.groups.length,
    modelChanges: changes.models.length,
    introPageChanges: changes.introPages.length,
    byType: Object.fromEntries(
      Object.entries(byType).sort(([left], [right]) => stableCompare(left, right)),
    ),
  };
}

/** Compare two already-standardized AM home configuration snapshots. */
export function diffConfigSnapshots(before, after, options = {}) {
  assertSnapshot(before, 'before');
  assertSnapshot(after, 'after');

  const changes = {
    groups: diffGroups(before.groups, after.groups, after.models),
    models: diffModels(before.models, after.models),
    introPages: diffIntroPages(before.introPages, after.introPages),
  };
  const summary = buildSummary(changes);

  return {
    schemaVersion: DIFF_SCHEMA_VERSION,
    diffType: options.diffType ?? 'AM_HOME_CONFIG_DIFF',
    environment: options.environment ?? after.environment ?? before.environment ?? null,
    before: {
      metadata: cloneValue(before.metadata),
      counts: cloneValue(before.counts),
    },
    after: {
      metadata: cloneValue(after.metadata),
      counts: cloneValue(after.counts),
    },
    hasChanges: summary.totalChanges > 0,
    summary,
    changes,
  };
}

/** Standardize raw before/after inputs and produce a PRO release diff. */
export function diffProRelease(input, options = {}) {
  if (!isRecord(input)) throw new TypeError('PRO diff input must be an object');
  const before = resolveSnapshot(input.before, 'before', 'PRO');
  const after = resolveSnapshot(input.after, 'after', 'PRO');
  for (const [label, snapshot] of [['before', before], ['after', after]]) {
    if (snapshot.environment && snapshot.environment !== 'PRO') {
      throw new Error(
        label + ' environment must be PRO, received ' + snapshot.environment,
      );
    }
  }
  const report = diffConfigSnapshots(before, after, {
    diffType: 'PRO_RELEASE_DIFF',
    environment: 'PRO',
  });
  return filterIgnoredFieldDifferences(report, normalizeIgnoreRules(options));
}

const DEFAULT_DEV_PRO_IGNORE_RULES = {
  groupFields: [],
  modelFields: ['creator_id'],
  modelImages: [],
  introFields: [],
};

const DEV_PRO_IGNORE_OPTION_NAMES = {
  groupFields: 'ignoredGroupFieldPaths',
  modelFields: 'ignoredModelFieldPaths',
  modelImages: 'ignoredModelImagePaths',
  introFields: 'ignoredIntroFieldPaths',
};

function normalizeIgnoreRules(options) {
  return Object.fromEntries(
    Object.entries(DEFAULT_DEV_PRO_IGNORE_RULES).map(([key, defaults]) => [
      key,
      [...new Set(options[DEV_PRO_IGNORE_OPTION_NAMES[key]] ?? defaults)]
        .sort(stableCompare),
    ]),
  );
}

function filterIgnoredFieldDifferences(report, rules) {
  const ruleByType = {
    GROUP_FIELD_CHANGE: new Set(rules.groupFields),
    MODEL_FIELD_CHANGE: new Set(rules.modelFields),
    MODEL_IMAGE_CHANGE: new Set(rules.modelImages),
    INTRO_MODIFY: new Set(rules.introFields),
  };
  const ignoredByType = {};
  let fieldCount = 0;
  let removedChanges = 0;

  const changes = Object.fromEntries(
    Object.entries(report.changes).map(([category, categoryChanges]) => {
      const filtered = [];
      for (const change of categoryChanges) {
        const ignoredPaths = ruleByType[change.type];
        if (!ignoredPaths || !Array.isArray(change.fields)) {
          filtered.push(change);
          continue;
        }
        const fields = change.fields.filter(({ path }) => {
          if (!ignoredPaths.has(path)) return true;
          fieldCount += 1;
          ignoredByType[change.type] = (ignoredByType[change.type] ?? 0) + 1;
          return false;
        });
        if (fields.length === 0) {
          removedChanges += 1;
        } else {
          filtered.push({ ...change, fields });
        }
      }
      return [category, filtered];
    }),
  );
  const summary = buildSummary(changes);

  return {
    ...report,
    hasChanges: summary.totalChanges > 0,
    summary,
    changes,
    ignoredDifferences: {
      fieldCount,
      removedChanges,
      byType: Object.fromEntries(
        Object.entries(ignoredByType).sort(([left], [right]) =>
          stableCompare(left, right),
        ),
      ),
      rules,
    },
  };
}

/** Compare a DEV source snapshot with its published PRO target snapshot. */
export function diffDevPro(input, options = {}) {
  if (!isRecord(input)) throw new TypeError('DEV/PRO diff input must be an object');
  const dev = resolveSnapshot(input.dev, 'dev', 'DEV');
  const pro = resolveSnapshot(input.pro, 'pro', 'PRO');
  if (dev.environment !== 'DEV') {
    throw new Error('dev environment must be DEV, received ' + dev.environment);
  }
  if (pro.environment !== 'PRO') {
    throw new Error('pro environment must be PRO, received ' + pro.environment);
  }

  const report = diffConfigSnapshots(dev, pro, {
    diffType: 'DEV_PRO_DIFF',
    environment: 'DEV→PRO',
  });
  return filterIgnoredFieldDifferences(report, normalizeIgnoreRules(options));
}
