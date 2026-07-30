const CHANGE_TYPE_LABELS = {
  GROUP_ADD: '新增分组',
  GROUP_DELETE: '删除分组',
  GROUP_REORDER: '分组排序变化',
  GROUP_COVER_CHANGE: '分组封面变化',
  GROUP_FIELD_CHANGE: '分组字段变化',
  MODEL_ADD: '标签新增模型',
  MODEL_DELETE: '标签删除模型',
  MODEL_REORDER: '标签内模型排序变化',
  MODEL_CATALOG_ADD: '模型目录新增模型',
  MODEL_CATALOG_DELETE: '模型目录删除模型',
  I18N_MODEL_ADD: '新增国际化模型',
  MODEL_IMAGE_CHANGE: '模型图片变化',
  MODEL_FIELD_CHANGE: '模型字段变化',
  MODEL_RENAME: '模型名称变化',
  INTRO_ADD: '新增新手引导页',
  INTRO_DELETE: '删除新手引导页',
  INTRO_REORDER: '新手引导页排序变化',
  INTRO_MODIFY: '修改新手引导页',
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '未提供') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).replace(/[\r\n]+/g, ' ');
}

function fieldSuffix(change) {
  if (!Array.isArray(change.fieldPaths) || change.fieldPaths.length === 0) {
    return '';
  }
  return '；字段：' + change.fieldPaths.join('、');
}

export function describeConsistencyChange(change) {
  const label = CHANGE_TYPE_LABELS[change.type] ?? change.type ?? '未知变化';
  switch (change.type) {
    case 'MODEL_ADD':
    case 'MODEL_DELETE':
      return (
        label +
        '；标签「' + text(change.tagName) +
        '」；模型 ID：' + text(change.modelId)
      );
    case 'MODEL_REORDER':
    case 'GROUP_COVER_CHANGE':
    case 'GROUP_REORDER':
    case 'GROUP_FIELD_CHANGE':
      return label + '；标签「' + text(change.tagName) + '」' + fieldSuffix(change);
    case 'GROUP_ADD':
    case 'GROUP_DELETE':
      return (
        label +
        '；分组：' + text(change.tagName ?? change.key) +
        '；分组 ID：' + text(change.groupId)
      );
    case 'MODEL_IMAGE_CHANGE':
    case 'MODEL_FIELD_CHANGE':
      return (
        label +
        '；模型：' + text(change.modelName) +
        (change.modelId ? '；模型 ID：' + text(change.modelId) : '') +
        fieldSuffix(change)
      );
    case 'MODEL_RENAME':
      return (
        label +
        '；模型 ID：' + text(change.modelId) +
        '；「' + text(change.beforeName) +
        '」→「' + text(change.afterName) + '」'
      );
    case 'MODEL_CATALOG_ADD':
    case 'MODEL_CATALOG_DELETE':
      return (
        label +
        '；模型：' + text(change.modelName) +
        '；模型 ID：' + text(change.modelId)
      );
    case 'I18N_MODEL_ADD':
      return label + '；模型 ID：' + text(change.modelId);
    case 'INTRO_DELETE':
    case 'INTRO_MODIFY':
    case 'INTRO_ADD':
      return (
        label +
        '；引导页 ID：' + text(change.introId) +
        (change.title ? '；标题：' + text(change.title) : '') +
        fieldSuffix(change)
      );
    case 'INTRO_REORDER':
      return label;
    default:
      return label + fieldSuffix(change);
  }
}

function addNumberedSection(lines, title, items, formatter) {
  lines.push('', title + '（' + items.length + '）', '-'.repeat(48));
  if (items.length === 0) {
    lines.push('无');
    return;
  }
  items.forEach((item, index) => {
    lines.push(String(index + 1) + '. ' + formatter(item));
  });
}

/** Render a declaration consistency result as a human-readable Chinese report. */
export function renderConsistencyTextReport(report) {
  if (!isRecord(report)) {
    throw new TypeError('Consistency report must be an object');
  }
  if (!isRecord(report.summary)) {
    throw new TypeError('Consistency report summary is required');
  }
  for (const field of ['matches', 'missingDeclarations', 'unexpectedChanges']) {
    if (!Array.isArray(report[field])) {
      throw new TypeError('Consistency report ' + field + ' must be an array');
    }
  }

  const lines = [
    'AIMirror 发布声明一致性检查报告',
    '='.repeat(48),
    '检查结论：' + (report.consistent ? '一致' : '不一致'),
    '',
    '通知信息',
    '-'.repeat(48),
    '操作人：' + text(report.notification?.operator),
    '发布方向：' +
      text(report.notification?.sourceEnvironment) +
      ' → ' +
      text(report.notification?.targetEnvironment),
    '通知声明变更数：' + text(report.notification?.declaredChanges, '0'),
    '',
    '核验统计',
    '-'.repeat(48),
    '声明核验项：' + text(report.summary.declaredAssertions, '0'),
    '实际变化项：' + text(report.summary.actualAssertions, '0'),
    '已匹配：' + text(report.summary.matchedAssertions, '0'),
    '声明但未观察到：' + text(report.summary.missingDeclarations, '0'),
    '实际发生但未声明：' + text(report.summary.unexpectedChanges, '0'),
  ];

  addNumberedSection(lines, '已匹配声明', report.matches, (match) =>
    '声明：' +
    describeConsistencyChange(match.declared) +
    '\n   实际：' +
    describeConsistencyChange(match.actual),
  );
  addNumberedSection(
    lines,
    '声明但未观察到',
    report.missingDeclarations,
    describeConsistencyChange,
  );
  addNumberedSection(
    lines,
    '实际发生但未声明',
    report.unexpectedChanges,
    describeConsistencyChange,
  );

  lines.push('', '判定说明', '-'.repeat(48));
  if (report.consistent) {
    lines.push('通知声明与发布前后 PRO 实际变化逐项一致。');
  } else {
    lines.push('通知声明与发布前后 PRO 实际变化不一致，请核对上述明细。');
    if (
      report.diff?.hasChanges === false &&
      Number(report.summary.declaredAssertions) > 0
    ) {
      lines.push(
        '当前 PRO Diff 未检测到实际变化，请确认使用的是同一次发布前、发布后抓取的数据。',
      );
    }
  }
  return lines.join('\n') + '\n';
}
