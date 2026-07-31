import {
  APP_SCREENSHOT_REPORT_TARGETS,
  normalizeAppScreenshotReportTarget,
} from './app-screenshot-report-target.mjs';
import { MODEL_EXPECTED_STATES } from './model-search-verdict.mjs';

const AUTOMATION_MODULES = [
  {
    module: '模版修改',
    objectType: 'model',
    screenshotTotal: 1,
    acceptedTypes: new Set([
      'MODEL_CATALOG_ADD',
      'MODEL_CATALOG_DELETE',
      'MODEL_IMAGE_CHANGE',
      'MODEL_COVER_SERIES_CHANGE',
      'MODEL_FIELD_CHANGE',
    ]),
  },
  {
    module: '新首页配置',
    objectType: 'tag',
    screenshotTotal: 2,
    acceptedTypes: new Set([
      'MODEL_ADD',
      'MODEL_DELETE',
      'MODEL_REORDER',
      'GROUP_COVER_CHANGE',
      'GROUP_ADD',
      'GROUP_DELETE',
    ]),
  },
  {
    module: 'More Style Video配置',
    objectType: 'tag',
    screenshotTotal: 2,
    acceptedTypes: new Set([
      'MODEL_ADD',
      'MODEL_DELETE',
      'MODEL_REORDER',
      'GROUP_COVER_CHANGE',
      'GROUP_ADD',
      'GROUP_DELETE',
    ]),
  },
  {
    module: 'More Style AI Filter配置',
    objectType: 'tag',
    screenshotTotal: 2,
    acceptedTypes: new Set([
      'MODEL_ADD',
      'MODEL_DELETE',
      'MODEL_REORDER',
      'GROUP_COVER_CHANGE',
      'GROUP_ADD',
      'GROUP_DELETE',
    ]),
  },
];

export const MANUAL_ONLY_MODULES = [
  '新手引导页配置',
  'More Style Editor配置',
];

function taskFlow(module, objectName) {
  if (module === '模版修改') return 'MODEL_SEARCH';
  if (module === '新首页配置' && objectName === 'New') return 'HOME_NEW';
  if (module === '新首页配置') return 'HOME_TAG';
  if (module === 'More Style Video配置') return 'VIDEO_TAG';
  if (module === 'More Style AI Filter配置') return 'FILTER_TAG';
  throw new Error(`Unsupported screenshot module: ${module}`);
}

function objectNameForChange(definition, change) {
  if (definition.objectType === 'model') return change.modelName?.trim() || null;
  return change.tagName?.trim() || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const TAG_SECTION_BY_MODULE = Object.freeze({
  '新首页配置': 'TABS',
  'More Style Video配置': 'AI_VIDEO_TABS',
  'More Style AI Filter配置': 'AI_FILTER_TABS',
});

function targetGroup(context, module, tagName) {
  const section = TAG_SECTION_BY_MODULE[module];
  return (context.targetSnapshot?.groups ?? []).find(
    (group) => group.section === section && group.name === tagName,
  );
}

function buildTagModelAssertions(task, context, planningWarnings) {
  if (!Object.prototype.hasOwnProperty.call(context, 'targetSnapshot')) {
    return [];
  }
  const statesById = new Map();
  for (const change of task.modelAssertionChanges) {
    const states = statesById.get(change.id) ?? new Set();
    states.add(change.expectedState);
    statesById.set(change.id, states);
  }

  if (task.changeTypes.includes('GROUP_ADD')) {
    const group = targetGroup(context, task.module, task.objectName);
    if (!group) {
      planningWarnings.push(
        `${task.module}｜${task.objectName} 是新增标签，但目标环境配置中未找到该标签，无法生成完整模型名称比对清单`,
      );
    } else {
      for (const id of group.modelIds ?? []) {
        const normalizedId = String(id);
        const states = statesById.get(normalizedId) ?? new Set();
        states.add('PRESENT');
        statesById.set(normalizedId, states);
      }
    }
  }

  const namesById = new Map(
    (context.targetSnapshot?.models ?? []).map((model) => [
      String(model.id),
      model.name ?? null,
    ]),
  );
  const assertions = [...statesById.entries()].map(([id, states]) => ({
    id,
    name: namesById.get(id) ?? null,
    expectedState:
      states.size > 1 ? 'CONFLICT' : [...states][0],
  }));
  const unresolved = assertions.filter((assertion) => !assertion.name);
  if (unresolved.length > 0) {
    planningWarnings.push(
      `${task.module}｜${task.objectName} 有模型ID无法映射名称：${unresolved
        .map((assertion) => assertion.id)
        .join(', ')}`,
    );
  }
  return assertions;
}

/**
 * Convert a parsed release notification into an APP screenshot plan.
 * Only 模版修改 enables an automatic business verdict. The other modules
 * remain screenshot evidence tasks.
 */
export function planAppScreenshotTasks(parsed, context = {}) {
  if (!parsed || typeof parsed !== 'object') {
    throw new TypeError('Parsed release notification is required');
  }
  if (!parsed.isPublishSuccess) {
    throw new Error('The notification is not an AIMirror publish-success message');
  }
  const reportTarget = normalizeAppScreenshotReportTarget(
    context.reportTarget,
  );
  const formalGroupOutputEnabled =
    reportTarget === APP_SCREENSHOT_REPORT_TARGETS.FORMAL_GROUP;

  const declaredChanges = Array.isArray(parsed.declaredChanges)
    ? parsed.declaredChanges
    : [];
  const templateSections = new Set(parsed.templateSections || []);
  const planningWarnings = [];

  const automationModules = AUTOMATION_MODULES.map((definition) => {
    const changed = templateSections.has(definition.module);
    const taskByObject = new Map();

    for (const change of declaredChanges) {
      if (change.template !== definition.module) continue;
      if (!definition.acceptedTypes.has(change.type)) continue;

      const objectName = objectNameForChange(definition, change);
      if (!objectName) {
        planningWarnings.push(
          `${definition.module} 的 ${change.type} 缺少${
            definition.objectType === 'model' ? '模型名' : '标签名'
          }`,
        );
        continue;
      }

      let task = taskByObject.get(objectName);
      if (!task) {
        task = {
          taskId: `${definition.module}::${objectName}`,
          module: definition.module,
          objectType: definition.objectType,
          objectName,
          flow: taskFlow(definition.module, objectName),
          screenshotTotal:
            taskFlow(definition.module, objectName) === 'HOME_NEW'
              ? 4
              : definition.screenshotTotal,
          changeTypes: [],
          sourceTexts: [],
          modelIds: [],
          modelAssertionChanges: [],
          businessVerdictEnabled: definition.module === '模版修改',
          tagModelVerdictEnabled: false,
          expectedState: null,
          deletionExpectedNoResult: false,
        };
        taskByObject.set(objectName, task);
      }

      task.changeTypes.push(change.type);
      task.sourceTexts.push(change.sourceText);
      task.modelIds.push(...(change.modelIds || []));
      if (change.type === 'MODEL_ADD' || change.type === 'MODEL_DELETE') {
        const expectedState =
          change.type === 'MODEL_ADD' ? 'PRESENT' : 'ABSENT';
        for (const id of change.modelIds ?? []) {
          task.modelAssertionChanges.push({
            id: String(id),
            expectedState,
          });
        }
      }
      if (change.type === 'MODEL_CATALOG_DELETE') {
        task.deletionExpectedNoResult = true;
      }
    }

    const tasks = [...taskByObject.values()].map((task) => {
      const changeTypes = unique(task.changeTypes);
      const hasDeletion = changeTypes.includes('MODEL_CATALOG_DELETE');
      const hasNonDeletion = changeTypes.some(
        (type) => type !== 'MODEL_CATALOG_DELETE',
      );
      const expectedState =
        definition.module !== '模版修改'
          ? null
          : hasDeletion && hasNonDeletion
            ? MODEL_EXPECTED_STATES.CONFLICT
            : hasDeletion
              ? MODEL_EXPECTED_STATES.ABSENT
              : MODEL_EXPECTED_STATES.PRESENT;
      task.changeTypes = changeTypes;
      const modelAssertions =
        definition.module === '模版修改'
          ? []
          : buildTagModelAssertions(task, context, planningWarnings);
      const tagModelVerdictEnabled = modelAssertions.length > 0;
      const flow =
        task.flow === 'HOME_NEW' && tagModelVerdictEnabled
          ? 'HOME_TAG'
          : task.flow;
      const screenshotTotal =
        task.flow === 'HOME_NEW' && tagModelVerdictEnabled
          ? definition.screenshotTotal
          : task.screenshotTotal;
      const { modelAssertionChanges, ...publicTask } = task;
      return {
        ...publicTask,
        flow,
        screenshotTotal,
        changeTypes,
        sourceTexts: unique(task.sourceTexts),
        modelIds: unique([
          ...task.modelIds,
          ...modelAssertions.map((assertion) => assertion.id),
        ]),
        modelAssertions,
        tagModelVerdictEnabled,
        expectedState,
        deletionExpectedNoResult:
          expectedState === MODEL_EXPECTED_STATES.ABSENT,
      };
    });

    if (changed && tasks.length === 0) {
      planningWarnings.push(
        `${definition.module} 出现在发布消息中，但没有生成可执行截图对象`,
      );
    }

    return {
      module: definition.module,
      changed,
      noChangeLabel: changed ? null : `${definition.module}｜本次无修改`,
      tasks,
      screenshotCount: tasks.reduce(
        (sum, task) => sum + task.screenshotTotal,
        0,
      ),
    };
  });

  const ignoredManualModules = MANUAL_ONLY_MODULES.filter((module) =>
    templateSections.has(module),
  );
  const tasks = automationModules.flatMap((module) => module.tasks);

  return {
    planType: 'AM_RELEASE_APP_SCREENSHOT_V2',
    messageId: context.messageId ?? null,
    notificationPath: context.notificationPath ?? null,
    operator: parsed.operator,
    sourceEnvironment: parsed.sourceEnvironment,
    targetEnvironment: parsed.targetEnvironment,
    generatedAt: context.generatedAt ?? new Date().toISOString(),
    policy: {
      screenshotOnly: false,
      businessVerdictEnabled: true,
      businessVerdictModules: ['模版修改'],
      tagModelVerdictEnabled: true,
      tagModelVerdictModules: [
        '新首页配置',
        'More Style Video配置',
        'More Style AI Filter配置',
      ],
      tagModelScanGroups: 2,
      tagBoundaryUnchangedSwipeCount: 3,
      screenshotOnlyModules: [
        '新首页配置',
        'More Style Video配置',
        'More Style AI Filter配置',
      ],
      imageLoadTimeoutMs: 120_000,
      retryMax: 2,
      attemptMax: 3,
      reportTarget,
      formalGroupOutputEnabled,
    },
    automationModules,
    ignoredManualModules,
    tasks,
    totals: {
      moduleCount: automationModules.length,
      changedModuleCount: automationModules.filter((module) => module.changed)
        .length,
      taskCount: tasks.length,
      screenshotCount: tasks.reduce(
        (sum, task) => sum + task.screenshotTotal,
        0,
      ),
    },
    planningWarnings,
  };
}
