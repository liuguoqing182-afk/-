export const MODEL_EXPECTED_STATES = Object.freeze({
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  CONFLICT: 'CONFLICT',
});

export const BUSINESS_VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  ERROR: 'ERROR',
  NOT_EVALUATED: 'NOT_EVALUATED',
});

const NO_RESULT_STATES = new Set(['NO_RESULTS', 'EMPTY']);
const ERROR_STATES = new Set(['APP_ERROR', 'NETWORK_ERROR', 'ERROR']);
const LOADED_IMAGE_STATES = new Set(['LOADED', 'VALID']);

export function normalizeModelName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function compactModelNameCharacters(value) {
  return normalizeModelName(value).replace(/[^\p{L}\p{N}]/gu, '');
}

function matchTruncatedModelTitle(expectedModelName, detectedModelName) {
  const normalizedDetected = String(detectedModelName ?? '')
    .normalize('NFKC')
    .trim();
  const truncation = normalizedDetected.match(/(?:\.{3}|…)\s*$/u);
  if (!truncation) {
    return {
      titleTruncated: false,
      prefixMatched: false,
      visibleTitleCoverage: 0,
    };
  }

  const visiblePrefix = normalizedDetected
    .slice(0, truncation.index)
    .trim();
  const expectedCharacters = compactModelNameCharacters(expectedModelName);
  const visibleCharacters = compactModelNameCharacters(visiblePrefix);
  const visibleTitleCoverage =
    expectedCharacters.length > 0
      ? visibleCharacters.length / expectedCharacters.length
      : 0;
  const prefixMatched =
    visibleCharacters.length > 0 &&
    visibleCharacters.length < expectedCharacters.length &&
    expectedCharacters.startsWith(visibleCharacters) &&
    visibleTitleCoverage > 0.8;

  return {
    titleTruncated: true,
    prefixMatched,
    visibleTitleCoverage: Number(visibleTitleCoverage.toFixed(4)),
  };
}

function normalizedEnum(value, fallback = 'UNKNOWN') {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return normalized || fallback;
}

export function normalizeModelSearchEvidence(raw = {}) {
  const firstResultTitle = String(
    raw.firstResultTitle ?? raw.detectedTitle ?? '',
  )
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    resultState: normalizedEnum(raw.resultState),
    firstResultTitle,
    firstResultImageState: normalizedEnum(raw.firstResultImageState),
    firstResultVisible:
      raw.firstResultVisible === true ||
      String(raw.firstResultVisible).toLowerCase() === 'true',
    pageIssue: String(raw.pageIssue ?? '').trim(),
    uiTexts: Array.isArray(raw.uiTexts)
      ? raw.uiTexts.map((value) => String(value)).filter(Boolean)
      : [],
    extractedAt: raw.extractedAt ?? null,
  };
}

function outcome(verdict, reasonCode, reason, details) {
  return {
    businessVerdict: verdict,
    verdictReasonCode: reasonCode,
    verdictReason: reason,
    ...details,
  };
}

export function judgeAddedModelTitle({ modelName, firstResultTitle }) {
  const expectedModelName = String(modelName ?? '').trim();
  const detectedModelName = String(firstResultTitle ?? '').trim();
  const expectedName = normalizeModelName(expectedModelName);
  const detectedName = normalizeModelName(detectedModelName);
  const truncatedMatch = matchTruncatedModelTitle(
    expectedModelName,
    detectedModelName,
  );
  const details = {
    expectedModelName,
    detectedModelName,
    titleMatched: false,
    titleTruncated: truncatedMatch.titleTruncated,
    visibleTitleCoverage: truncatedMatch.visibleTitleCoverage,
  };
  if (!expectedName) {
    return outcome(
      BUSINESS_VERDICTS.ERROR,
      'EXPECTED_MODEL_NAME_MISSING',
      '发布消息没有可用于搜索和比对的模型名称',
      details,
    );
  }
  if (!detectedName) {
    return outcome(
      BUSINESS_VERDICTS.FAIL,
      'MODEL_NOT_FOUND',
      '搜索结果中没有读取到对应模型文字',
      details,
    );
  }
  if (expectedName === detectedName) {
    return outcome(
      BUSINESS_VERDICTS.PASS,
      'MODEL_TEXT_MATCH',
      '搜索结果文字与发布模型一致',
      {
        ...details,
        titleMatched: true,
      },
    );
  }
  if (truncatedMatch.prefixMatched) {
    return outcome(
      BUSINESS_VERDICTS.PASS,
      'MODEL_TEXT_PREFIX_MATCH',
      '搜索结果名称被界面省略，但开头一致且已显示内容超过完整名称的80%',
      {
        ...details,
        titleMatched: true,
      },
    );
  }
  return outcome(
    BUSINESS_VERDICTS.FAIL,
    'MODEL_TEXT_MISMATCH',
    `搜索结果文字“${detectedModelName}”与发布模型不一致`,
    details,
  );
}

export function judgeModelSearchEvidence({
  modelName,
  expectedState,
  evidence: rawEvidence,
}) {
  const evidence = normalizeModelSearchEvidence(rawEvidence);
  const expectedName = normalizeModelName(modelName);
  const detectedName = normalizeModelName(evidence.firstResultTitle);
  const titleMatched = Boolean(expectedName) && expectedName === detectedName;
  const imageLoaded = LOADED_IMAGE_STATES.has(
    evidence.firstResultImageState,
  );
  const details = {
    expectedState,
    expectedModelName: String(modelName ?? '').trim(),
    detectedModelName: evidence.firstResultTitle,
    titleMatched,
    imageLoaded,
    evidence,
  };

  if (!expectedName) {
    return outcome(
      BUSINESS_VERDICTS.ERROR,
      'EXPECTED_MODEL_NAME_MISSING',
      '发布消息没有可用于搜索和比对的模型名称',
      details,
    );
  }

  if (expectedState === MODEL_EXPECTED_STATES.CONFLICT) {
    return outcome(
      BUSINESS_VERDICTS.ERROR,
      'CONFLICTING_CHANGE_TYPES',
      '同一模型同时包含删除和非删除变更，无法自动判断',
      details,
    );
  }

  if (ERROR_STATES.has(evidence.resultState)) {
    return outcome(
      BUSINESS_VERDICTS.ERROR,
      'SEARCH_PAGE_ERROR',
      evidence.pageIssue || '搜索页面出现网络或应用错误',
      details,
    );
  }

  if (expectedState === MODEL_EXPECTED_STATES.ABSENT) {
    if (evidence.firstResultVisible && titleMatched) {
      return outcome(
        BUSINESS_VERDICTS.FAIL,
        'DELETED_MODEL_STILL_VISIBLE',
        '删除模型仍能搜索到对应模型名称',
        details,
      );
    }
    if (
      NO_RESULT_STATES.has(evidence.resultState) &&
      !evidence.firstResultVisible
    ) {
      return outcome(
        BUSINESS_VERDICTS.PASS,
        'DELETED_MODEL_NOT_FOUND',
        '删除模型搜索无结果，符合预期',
        details,
      );
    }
    return outcome(
      BUSINESS_VERDICTS.FAIL,
      'DELETION_NOT_PROVEN',
      '搜索页未明确显示无结果，无法确认模型已经删除',
      details,
    );
  }

  if (!evidence.firstResultVisible) {
    if (NO_RESULT_STATES.has(evidence.resultState)) {
      return outcome(
        BUSINESS_VERDICTS.FAIL,
        'MODEL_NOT_FOUND',
        '搜索结果中没有对应模型',
        details,
      );
    }
    return outcome(
      BUSINESS_VERDICTS.FAIL,
      'RESULT_CARD_MISSING',
      '搜索结果中没有可见的第一张模型卡片',
      details,
    );
  }
  if (!evidence.firstResultTitle) {
    return outcome(
      BUSINESS_VERDICTS.FAIL,
      'MODEL_TEXT_MISSING',
      '第一张结果卡片没有对应的模型文字信息',
      details,
    );
  }
  if (!titleMatched) {
    return outcome(
      BUSINESS_VERDICTS.FAIL,
      'MODEL_TEXT_MISMATCH',
      `第一张结果卡片名称“${evidence.firstResultTitle}”与发布模型不一致`,
      details,
    );
  }
  if (!imageLoaded) {
    return outcome(
      BUSINESS_VERDICTS.FAIL,
      'MODEL_IMAGE_NOT_LOADED',
      '对应模型卡片图片缺失、仍在加载或为占位图',
      details,
    );
  }

  return outcome(
    BUSINESS_VERDICTS.PASS,
    'MODEL_TEXT_AND_IMAGE_MATCH',
    '对应模型名称匹配且模型图片已正常加载',
    details,
  );
}

export function verdictLabel(verdict) {
  if (verdict === BUSINESS_VERDICTS.PASS) return '通过';
  if (verdict === BUSINESS_VERDICTS.FAIL) return '不通过';
  if (verdict === BUSINESS_VERDICTS.ERROR) return '执行异常';
  return '未自动判断';
}
