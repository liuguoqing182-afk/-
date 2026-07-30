export function normalizeVisibleModelName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

export function uniqueVisibleModelNames(values) {
  const names = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const name = String(value ?? '').replace(/\s+/g, ' ').trim();
    const normalized = normalizeVisibleModelName(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(name);
  }
  return names;
}

export function evaluateTagModelAssertions(
  assertions,
  visibleNames,
  options = {},
) {
  const actualModelNames = uniqueVisibleModelNames(visibleNames);
  const actualNameByNormalized = new Map(
    actualModelNames.map((name) => [normalizeVisibleModelName(name), name]),
  );
  const expected = Array.isArray(assertions) ? assertions : [];
  const unresolved = expected.filter(
    (item) => !item?.name || item?.expectedState === 'CONFLICT',
  );
  const found = expected.filter(
    (item) =>
      item?.expectedState === 'PRESENT' &&
      item?.name &&
      actualNameByNormalized.has(normalizeVisibleModelName(item.name)),
  );
  const missing = expected.filter(
    (item) =>
      item?.expectedState === 'PRESENT' &&
      item?.name &&
      !actualNameByNormalized.has(normalizeVisibleModelName(item.name)),
  );
  const unexpectedlyPresent = expected.filter(
    (item) =>
      item?.expectedState === 'ABSENT' &&
      item?.name &&
      actualNameByNormalized.has(normalizeVisibleModelName(item.name)),
  );
  const assertedNames = new Set(
    expected
      .map((item) => normalizeVisibleModelName(item?.name))
      .filter(Boolean),
  );
  const unassertedActualModelNames = actualModelNames.filter(
    (name) => !assertedNames.has(normalizeVisibleModelName(name)),
  );
  const comparisons = expected.map((item) => {
    const normalizedName = normalizeVisibleModelName(item?.name);
    const actualName = normalizedName
      ? actualNameByNormalized.get(normalizedName) ?? null
      : null;
    let result = 'UNRESOLVED';
    if (item?.name && item?.expectedState === 'PRESENT') {
      result = actualName ? 'FOUND' : 'MISSING';
    } else if (item?.name && item?.expectedState === 'ABSENT') {
      result = actualName
        ? 'UNEXPECTEDLY_PRESENT'
        : 'ABSENT_AS_EXPECTED';
    }
    return {
      id: item?.id ?? null,
      expectedName: item?.name ?? null,
      expectedState: item?.expectedState ?? null,
      actualName,
      result,
    };
  });
  const details = {
    expectedModels: expected,
    actualModelNames,
    found,
    missing,
    unexpectedlyPresent,
    unresolved,
    unassertedActualModelNames,
    comparisons,
  };

  if (options.actualNameCollectionComplete === false) {
    const incompleteComparisons = comparisons.map((comparison) => ({
      ...comparison,
      result:
        comparison.result === 'FOUND' ||
        comparison.result === 'UNEXPECTEDLY_PRESENT' ||
        comparison.result === 'UNRESOLVED'
          ? comparison.result
          : 'NOT_EVALUATED',
    }));
    return {
      businessVerdict: 'ERROR',
      verdictReasonCode: 'TAG_MODEL_NAME_COLLECTION_INCOMPLETE',
      verdictReason:
        options.collectionFailureReason ||
        '页面模型卡片名称采集不完整，无法可靠判断名称是否缺失',
      ...details,
      missing: [],
      unexpectedlyPresent: [],
      comparisons: incompleteComparisons,
    };
  }

  if (unresolved.length > 0) {
    return {
      businessVerdict: 'ERROR',
      verdictReasonCode: 'TAG_MODEL_NAME_UNRESOLVED',
      verdictReason: `以下模型ID无法可靠生成名称断言：${unresolved.map((item) => item.id).join(', ')}`,
      ...details,
    };
  }
  if (missing.length > 0 || unexpectedlyPresent.length > 0) {
    const reasons = [];
    if (missing.length > 0) {
      reasons.push(`未找到新增模型：${missing.map((item) => `${item.name}(${item.id})`).join('、')}`);
    }
    if (unexpectedlyPresent.length > 0) {
      reasons.push(
        `应删除模型仍存在：${unexpectedlyPresent
          .map((item) => `${item.name}(${item.id})`)
          .join('、')}`,
      );
    }
    return {
      businessVerdict: 'FAIL',
      verdictReasonCode: 'TAG_MODEL_NAME_MISMATCH',
      verdictReason: reasons.join('；'),
      ...details,
    };
  }
  return {
    businessVerdict: 'PASS',
    verdictReasonCode: 'TAG_MODEL_NAMES_MATCH',
    verdictReason: `标签模型名称比对通过，共核对${expected.length}个模型`,
    ...details,
  };
}
