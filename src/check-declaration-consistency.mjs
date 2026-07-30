import fs from 'node:fs/promises';
import path from 'node:path';

import { checkDeclarationConsistency } from './declaration-consistency.mjs';
import { renderConsistencyTextReport } from './consistency-text-report.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const positional = args.filter((argument) => argument !== '--strict');
const [notificationPath, diffPath, outputPath] = positional;

if (!notificationPath || !diffPath) {
  console.error(
    'Usage: node src/check-declaration-consistency.mjs ' +
      '<notification.txt> <pro-diff.json> [output.json|output.txt] [--strict]',
  );
  process.exit(2);
}

const [notification, diffText] = await Promise.all([
  fs.readFile(notificationPath, 'utf8'),
  fs.readFile(diffPath, 'utf8'),
]);
const report = checkDeclarationConsistency({
  notification,
  diff: JSON.parse(diffText),
});
const json = JSON.stringify(report, null, 2) + '\n';

if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  const format = path.extname(resolvedOutputPath).toLowerCase() === '.txt'
    ? 'text'
    : 'json';
  const content = format === 'text'
    ? renderConsistencyTextReport(report)
    : json;
  await fs.writeFile(resolvedOutputPath, content, 'utf8');
  console.log(JSON.stringify({
    outputPath: resolvedOutputPath,
    format,
    consistent: report.consistent,
    summary: report.summary,
  }, null, 2));
} else {
  process.stdout.write(json);
}

if (strict && !report.consistent) process.exitCode = 1;
