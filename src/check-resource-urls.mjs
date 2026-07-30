import fs from 'node:fs/promises';
import path from 'node:path';

import {
  checkChangedResourceUrls,
  renderResourceUrlTextReport,
} from './resource-url-checker.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const positional = args.filter((argument) => argument !== '--strict');
const [diffPath, outputPath] = positional;

if (!diffPath) {
  console.error(
    'Usage: node src/check-resource-urls.mjs ' +
      '<diff.json> [output.json|output.txt] [--strict]',
  );
  process.exit(2);
}

const diff = JSON.parse(await fs.readFile(diffPath, 'utf8'));
const report = await checkChangedResourceUrls(diff);
const json = JSON.stringify(report, null, 2) + '\n';

if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  const format = path.extname(resolvedOutputPath).toLowerCase() === '.txt'
    ? 'text'
    : 'json';
  const content = format === 'text'
    ? renderResourceUrlTextReport(report)
    : json;
  await fs.writeFile(resolvedOutputPath, content, 'utf8');
  console.log(JSON.stringify({
    outputPath: resolvedOutputPath,
    format,
    passed: report.passed,
    summary: report.summary,
  }, null, 2));
} else {
  process.stdout.write(json);
}

if (strict && !report.passed) process.exitCode = 1;
