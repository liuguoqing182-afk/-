import fs from 'node:fs/promises';
import path from 'node:path';

import { planAppScreenshotTasks } from '../src/app-screenshot-task-planner.mjs';
import { parsePublishNotification } from '../src/message-parser.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[token.slice(2)] = true;
      continue;
    }
    result[token.slice(2)] = next;
    index += 1;
  }
  return result;
}

const SECTION_NAMES = Object.freeze({
  tabs: 'TABS',
  ai_video_tabs: 'AI_VIDEO_TABS',
  ai_filter_tabs: 'AI_FILTER_TABS',
});

function targetSnapshot(report) {
  const modelsById = new Map();
  const groups = [];
  for (const group of report.groups ?? []) {
    const section = SECTION_NAMES[group.section];
    if (!section) continue;
    const modelIds = [];
    for (const model of group.models ?? []) {
      const id = String(model.model_id ?? '').trim();
      if (!id) continue;
      modelIds.push(id);
      if (model.found && model.model_name && !modelsById.has(id)) {
        modelsById.set(id, {
          id,
          name: String(model.model_name).trim(),
        });
      }
    }
    groups.push({
      section,
      name: group.group_name,
      modelIds,
    });
  }
  return {
    groups,
    models: [...modelsById.values()],
  };
}

function restrictToTagModelTasks(plan, tagName = null) {
  const tasks = plan.tasks.filter(
    (task) =>
      task.objectType === 'tag' &&
      task.tagModelVerdictEnabled &&
      (!tagName || task.objectName === tagName),
  );
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const automationModules = plan.automationModules
    .map((module) => {
      const moduleTasks = module.tasks.filter((task) => taskIds.has(task.taskId));
      return {
        ...module,
        tasks: moduleTasks,
        screenshotCount: moduleTasks.reduce(
          (sum, task) => sum + task.screenshotTotal,
          0,
        ),
      };
    })
    .filter((module) => module.tasks.length > 0);
  return {
    ...plan,
    automationModules,
    tasks,
    totals: {
      moduleCount: automationModules.length,
      changedModuleCount: automationModules.length,
      taskCount: tasks.length,
      screenshotCount: tasks.reduce(
        (sum, task) => sum + task.screenshotTotal,
        0,
      ),
    },
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.notification) {
  throw new Error('--notification <publish-notification.txt> is required');
}
if (!args['pro-report']) {
  throw new Error('--pro-report <home-report.json> is required');
}
if (!args.output) {
  throw new Error('--output <screenshot-plan.json> is required');
}

const notificationPath = path.resolve(args.notification);
const reportPath = path.resolve(args['pro-report']);
const outputPath = path.resolve(args.output);
const notificationText = await fs.readFile(notificationPath, 'utf8');
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
const parsed = parsePublishNotification(notificationText);
if (!parsed.valid || !parsed.fullyParsed) {
  throw new Error(
    `publish notification is not fully parseable: ${JSON.stringify({
      errors: parsed.errors,
      unparsedLines: parsed.unparsedLines,
    })}`,
  );
}
let plan = planAppScreenshotTasks(parsed, {
  messageId: args['message-id'] || 'manual-tag-model-validation',
  notificationPath,
  targetSnapshot: targetSnapshot(report),
});
if (args['tag-only'] || args.tag) {
  plan = restrictToTagModelTasks(plan, args.tag || null);
}
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify({
    output: outputPath,
    taskCount: plan.tasks.length,
    tasks: plan.tasks.map((task) => ({
      module: task.module,
      objectName: task.objectName,
      modelAssertions: task.modelAssertions,
    })),
    planningWarnings: plan.planningWarnings,
  }),
);
