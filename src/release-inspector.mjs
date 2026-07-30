import { findMissingModelReferences, fetchHomeSnapshot } from './am-home-client.mjs';
import { diffDevPro, diffProRelease } from './config-diff.mjs';
import { checkDeclarationConsistency } from './declaration-consistency.mjs';
import { checkForNewDifferences } from './known-difference-baseline.mjs';
import { parseNotification } from './notification-parser.mjs';
import { checkChangedResourceUrls } from './resource-url-checker.mjs';

function unverifiedI18nCount(notification) {
  return notification.declaredChanges.filter(({ type }) => type === 'I18N_MODEL_ADD')
    .length;
}

export async function inspectRelease(options = {}) {
  const notificationText = String(options.notificationText ?? '');
  const notification = parseNotification(notificationText);
  if (!notification.valid || !notification.fullyParsed) {
    return {
      status: 'PARSE_FAILED',
      passed: false,
      notification,
      errors: [
        ...notification.errors,
        ...notification.unparsedLines.map((line) => '无法解析：' + line),
      ],
    };
  }

  const fetchSnapshotImpl = options.fetchSnapshotImpl ?? fetchHomeSnapshot;
  const fetchOptions = { ...(options.fetchOptions ?? {}), uid: options.uid };
  const [devResult, proResult] = await Promise.all([
    fetchSnapshotImpl('DEV', fetchOptions),
    fetchSnapshotImpl('PRO', fetchOptions),
  ]);
  const devProDiff = diffDevPro({
    dev: devResult.snapshot,
    pro: proResult.snapshot,
  });
  const beforePro = options.beforePro ?? null;
  const proReleaseDiff = beforePro
    ? diffProRelease({ before: beforePro, after: proResult.snapshot })
    : null;
  const declaration = proReleaseDiff
    ? checkDeclarationConsistency({ notification, diff: proReleaseDiff })
    : null;
  const resources = proReleaseDiff
    ? await checkChangedResourceUrls(proReleaseDiff, options.resourceCheckOptions)
    : null;
  const devMissing = devResult.missingModelReferences ??
    findMissingModelReferences(devResult.snapshot);
  const proMissing = proResult.missingModelReferences ??
    findMissingModelReferences(proResult.snapshot);
  const newDifferenceCheck = options.knownDifferences
    ? checkForNewDifferences({
        baseline: options.knownDifferences,
        devProDiff,
        proMissingModelReferences: proMissing,
      })
    : null;
  const baselineAvailable = Boolean(beforePro);
  const environmentAccepted = newDifferenceCheck
    ? newDifferenceCheck.passed
    : !devProDiff.hasChanges;
  const passed = Boolean(
    baselineAvailable &&
    environmentAccepted &&
    declaration?.consistent &&
    resources?.passed,
  );

  return {
    status: baselineAvailable ? (passed ? 'PASSED' : 'FAILED') : 'BASELINE_CREATED',
    passed,
    notification,
    checks: {
      notificationParsed: true,
      baselineAvailable,
      devProAligned: !devProDiff.hasChanges,
      noNewEnvironmentDifferences: environmentAccepted,
      declarationConsistent: declaration?.consistent ?? null,
      resourcesPassed: resources?.passed ?? null,
    },
    notes: {
      unverifiedI18nDeclarations: unverifiedI18nCount(notification),
      devMissingModelReferences: devMissing.count,
      proMissingModelReferences: proMissing.count,
    },
    devProDiff,
    proReleaseDiff,
    declaration,
    resources,
    newDifferenceCheck,
    current: {
      devEnvironment: devResult,
      proEnvironment: proResult,
      devSnapshot: devResult.snapshot,
      proSnapshot: proResult.snapshot,
      devMissingModelReferences: devMissing,
      proMissingModelReferences: proMissing,
    },
  };
}

function resultLabel(status) {
  return {
    PASSED: '通过 ✅',
    FAILED: '不通过 ❌',
    BASELINE_CREATED: '只建立了基线 ⚠️',
    PARSE_FAILED: '通知解析失败 ❌',
  }[status] ?? status;
}

function yesNo(value) {
  if (value === null || value === undefined) return '未执行';
  return value ? '通过' : '不通过';
}

export function renderFeishuInspectionSummary(result) {
  const lines = [
    'AIMirror 首屏配置巡检：' + resultLabel(result.status),
    '操作人：' + (result.notification?.operator ?? '未知'),
  ];
  if (result.status === 'PARSE_FAILED') {
    lines.push(...result.errors.map((error) => '问题：' + error));
    return lines.join('\n');
  }
  lines.push(
    '发布声明：' + yesNo(result.checks.notificationParsed),
    'PRO 前后差异基线：' + (result.checks.baselineAvailable ? '已使用' : '首次运行，无旧基线'),
    '声明与实际变更：' + yesNo(result.checks.declarationConsistent),
    '变更资源 URL：' + yesNo(result.checks.resourcesPassed),
    'PRO 实际变化：' + (result.proReleaseDiff?.summary.totalChanges ?? '未比较'),
  );
  if (result.newDifferenceCheck) {
    const summary = result.newDifferenceCheck.summary;
    lines.push(
      'DEV/PRO 新增差异：' + summary.newDevProDifferences +
        '（当前 ' + summary.currentDevProDifferences +
        '，已知 ' + summary.knownDevProDifferences + '）',
      'PRO 新增缺失引用：' + summary.newMissingModelReferences +
        '（当前 ' + summary.currentMissingModelReferences +
        '，已知 ' + summary.knownMissingModelReferences + '）',
    );
  } else {
    lines.push(
      'DEV/PRO 一致性：' + yesNo(result.checks.devProAligned),
      'DEV/PRO 差异：' + result.devProDiff.summary.totalChanges,
      'PRO 缺失模型引用：' + result.notes.proMissingModelReferences,
    );
  }
  if (result.notes.unverifiedI18nDeclarations > 0) {
    lines.push(
      '提示：' + result.notes.unverifiedI18nDeclarations +
      ' 条国际化声明已识别，需后续接多语言接口核验。',
    );
  }
  if (result.status === 'BASELINE_CREATED') {
    lines.push('提示：监听器需在下一次发布前保持运行，下一次才能比较 PRO 发布前后变化。');
  }
  return lines.join('\n');
}
