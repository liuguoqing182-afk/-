const CHANGE_PATTERNS = [
  {
    type: 'MODEL_CATALOG_ADD',
    pattern: /^新增模型\s*[：:]\s*(.+)$/,
    build: (match) => ({ modelName: match[1].trim() }),
  },
  {
    type: 'MODEL_CATALOG_DELETE',
    pattern: /^删除模型\s*[：:]\s*(.+)$/,
    build: (match) => ({ modelName: match[1].trim() }),
  },
  {
    type: 'INSPIRATION_REORDER',
    pattern: /^inspire\s*[：:]\s*(?:✨\s*)?Inspiration的排序改变$/i,
    build: () => ({ inspirationName: 'Inspiration' }),
  },
  {
    type: 'MODEL_ADD',
    pattern: /^新增了模型[（(]所属标签(.+?)[）)]\s*[\[【]([\d,，\s]+)[\]】]$/,
    build: (match) => ({ tagName: match[1].trim(), modelIds: parseIds(match[2]) }),
  },
  {
    type: 'MODEL_DELETE',
    pattern: /^删除了模型[（(]所属标签(.+?)[）)]\s*[\[【]([\d,，\s]+)[\]】]$/,
    build: (match) => ({ tagName: match[1].trim(), modelIds: parseIds(match[2]) }),
  },
  {
    type: 'MODEL_REORDER',
    pattern: /^标签(.+?)的模型排序改变$/,
    build: (match) => ({ tagName: match[1].trim() }),
  },
  {
    type: 'GROUP_COVER_CHANGE',
    pattern: /^标签(.+?)的组封面修改$/,
    build: (match) => ({ tagName: match[1].trim() }),
  },
  {
    type: 'GROUP_ADD',
    pattern: /^增加标签\s*[：:]\s*(.+)$/,
    build: (match) => ({ tagName: match[1].trim() }),
  },
  {
    type: 'GROUP_DELETE',
    pattern: /^删除标签\s*[：:]\s*(.+)$/,
    build: (match) => ({ tagName: match[1].trim() }),
  },
  {
    type: 'MODEL_IMAGE_CHANGE',
    pattern: /^模型(.+?)图片改变$/,
    build: (match) => ({ modelName: match[1].trim() }),
  },
  {
    type: 'MODEL_COVER_SERIES_CHANGE',
    pattern: /^模型(.+?)的封面图系列有改动$/,
    build: (match) => ({ modelName: match[1].trim() }),
  },
  {
    type: 'MODEL_FIELD_CHANGE',
    pattern: /^模型(.+?)有字段改动$/,
    build: (match) => ({ modelName: match[1].trim() }),
  },
  {
    type: 'INTRO_REORDER',
    pattern: /^新手引导页顺序发生了变化$/,
    build: () => ({}),
  },
  {
    type: 'INTRO_DELETE',
    pattern: /^删除新手引导页\s*[：:]\s*(.+)$/,
    build: (match) => ({ introId: match[1].trim() }),
  },
  {
    type: 'INTRO_MODIFY',
    pattern: /^修改了新手引导页\s*[：:]\s*(.+)$/,
    build: (match) => ({ introId: match[1].trim() }),
  },
];

const SECTION_PATTERNS = [
  [/^模[版板]修改\s*[：:]$/, '模版修改'],
  [/^More Style AI Filter配置\s*[：:]$/i, 'More Style AI Filter配置'],
  [/^国际化配置\s*[：:]$/, '国际化配置'],
  [/^新首页配置\s*[：:]$/, '新首页配置'],
  [/^More Style Video配置\s*[：:]$/i, 'More Style Video配置'],
  [/^More Style Editor配置\s*[：:]$/i, 'More Style Editor配置'],
  [/^新手引导页配置\s*[：:]$/, '新手引导页配置'],
];

const IGNORED_SECTIONS = new Set(['国际化配置']);

const INLINE_SECTION_PATTERN =
  /^[ \t]*(模[版板]修改|More Style AI Filter配置|国际化配置|新首页配置|More Style Video配置|More Style Editor配置|新手引导页配置)[ \t]*([：:])[ \t]*(\S.*)$/gim;

const FLATTENED_BOUNDARY_PATTERNS = [
  '模[版板]修改\\s*[：:]',
  'More Style AI Filter配置\\s*[：:]',
  '国际化配置\\s*[：:]',
  '新首页配置\\s*[：:]',
  'More Style Video配置\\s*[：:]',
  'More Style Editor配置\\s*[：:]',
  '新手引导页配置\\s*[：:]',
  '新增模型\\s*[：:]',
  '删除模型\\s*[：:]',
  '新增国际化模型\\s*[：:]',
  '修改了国际化模型\\s*[：:]',
  'inspire\\s*[：:]\\s*(?:✨\\s*)?Inspiration的排序改变',
  '新增了模型[（(]',
  '删除了模型[（(]',
  '(?:增加|删除)标签\\s*[：:]',
  '标签[^,，\\n]+?的(?:模型排序改变|组封面修改)',
  '模型[^,，\\n]+?(?:图片改变|的封面图系列有改动|有字段改动)',
  '新手引导页顺序发生了变化',
  '删除新手引导页\\s*[：:]',
  '修改了新手引导页\\s*[：:]',
  '操作人\\s*[：:]',
  '发布环境\\s*[：:]',
  '\\[图片\\]',
  '展开\\s*$',
];

const FEISHU_DISPLAY_ARTIFACT_PATTERNS = [
  /^\[图片\]$/,
  /^展开$/,
];

function parseIds(value) {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanLine(line) {
  return line
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^(?:[-*•·]|\d+[.)、])\s*/, '')
    .replace(/[，,；;。]+$/, '')
    .trim();
}

/**
 * Feishu may put the first change directly after a section heading. Convert
 * only same-line content so ordinary section lines and subsequent lines keep
 * their original boundaries.
 */
export function normalizePublishNotification(input) {
  let normalized = input
    .replace(
      /(操作人\s*[：:])\s*\n\s*([^\n]+)/giu,
      '$1 $2',
    )
    .replace(
      /(发布环境\s*[：:])\s*\n\s*(从\s*[\w-]+\s*发布到\s*[\w-]+)/giu,
      '$1 $2',
    )
    .replace(
    /(AIMirror首屏配置发布成功[!！]?)[ \t]+/gi,
    '$1\n',
  );
  for (const boundaryPattern of FLATTENED_BOUNDARY_PATTERNS) {
    normalized = normalized.replace(
      new RegExp('[ \\t]+(?=' + boundaryPattern + ')', 'giu'),
      '\n',
    );
  }
  return normalized.replace(INLINE_SECTION_PATTERN, '$1$2\n$3');
}

function matchChange(line, section) {
  for (const rule of CHANGE_PATTERNS) {
    const match = line.match(rule.pattern);
    if (!match) continue;
    return {
      type: rule.type,
      template: section,
      ...rule.build(match),
      sourceText: line,
    };
  }
  return null;
}

/**
 * Parse an "AIMirror首屏配置发布成功" notification into stable JSON.
 * Model IDs remain strings so large IDs and cross-language JSON consumers are safe.
 */
export function parsePublishNotification(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Notification input must be a string');
  }

  const normalized = normalizePublishNotification(input);
  const lines = normalized.split(/\r\n?|\n/).map(cleanLine).filter(Boolean);
  const result = {
    messageType: 'AM_HOME_CONFIG_PUBLISHED',
    isPublishSuccess: false,
    operator: null,
    sourceEnvironment: null,
    targetEnvironment: null,
    templateSections: [],
    declaredChanges: [],
    unparsedLines: [],
    errors: [],
  };

  let currentSection = null;
  for (const line of lines) {
    if (/^AIMirror首屏配置发布成功[!！]?$/.test(line)) {
      result.isPublishSuccess = true;
      continue;
    }

    const operatorMatch = line.match(/^操作人\s*[：:]\s*(.+)$/);
    if (operatorMatch) {
      const operator = operatorMatch[1].trim();
      const mailLink = operator.match(/^\[([^\]]+)\]\(mailto:[^)]+\)$/i);
      result.operator = mailLink?.[1] ?? operator;
      continue;
    }

    const environmentMatch = line.match(
      /^发布环境\s*[：:]\s*从\s*([\w-]+)\s*发布到\s*([\w-]+)$/i,
    );
    if (environmentMatch) {
      result.sourceEnvironment = environmentMatch[1].toUpperCase();
      result.targetEnvironment = environmentMatch[2].toUpperCase();
      continue;
    }

    if (FEISHU_DISPLAY_ARTIFACT_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }

    let isSection = false;
    for (const [pattern, section] of SECTION_PATTERNS) {
      if (!pattern.test(line)) continue;
      currentSection = section;
      if (
        !IGNORED_SECTIONS.has(section) &&
        !result.templateSections.includes(section)
      ) {
        result.templateSections.push(section);
      }
      isSection = true;
      break;
    }
    if (isSection) continue;

    if (IGNORED_SECTIONS.has(currentSection)) continue;

    const change = matchChange(line, currentSection);
    if (change) {
      result.declaredChanges.push(change);
    } else {
      result.unparsedLines.push(line);
    }
  }

  if (!result.isPublishSuccess) result.errors.push('缺少发布成功标识');
  if (!result.operator) result.errors.push('缺少操作人');
  if (!result.sourceEnvironment || !result.targetEnvironment) {
    result.errors.push('缺少或无法解析发布环境');
  }
  if (
    result.sourceEnvironment &&
    result.targetEnvironment &&
    !(result.sourceEnvironment === 'DEV' && result.targetEnvironment === 'PRO')
  ) {
    result.errors.push(
      `当前仅支持 DEV→PRO，收到 ${result.sourceEnvironment}→${result.targetEnvironment}`,
    );
  }

  return {
    ...result,
    valid: result.errors.length === 0,
    fullyParsed: result.unparsedLines.length === 0,
  };
}
