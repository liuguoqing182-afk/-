import fs from 'node:fs/promises';
import path from 'node:path';
import { parsePublishNotification } from '../src/message-parser.mjs';
import { planAppScreenshotTasks } from '../src/app-screenshot-task-planner.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    values[name] = argv[index + 1];
    index += 1;
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
if (!args.notification) {
  throw new Error('--notification <path> is required');
}
if (!args.output) {
  throw new Error('--output <path> is required');
}

const notificationPath = path.resolve(args.notification);
const outputPath = path.resolve(args.output);
const notification = await fs.readFile(notificationPath, 'utf8');
const parsed = parsePublishNotification(notification);
if (!parsed.valid || !parsed.fullyParsed) {
  throw new Error(
    `Publish notification is not fully parseable: ${JSON.stringify({
      errors: parsed.errors,
      unparsedLines: parsed.unparsedLines,
    })}`,
  );
}

const plan = planAppScreenshotTasks(parsed, {
  messageId: args['message-id'] ?? null,
  notificationPath,
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      outputPath,
      totals: plan.totals,
      ignoredManualModules: plan.ignoredManualModules,
      planningWarnings: plan.planningWarnings,
    },
    null,
    2,
  ),
);
