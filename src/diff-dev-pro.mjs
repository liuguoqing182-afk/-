import fs from 'node:fs/promises';
import path from 'node:path';

import { diffDevPro } from './config-diff.mjs';

const [, , devDirectory, proDirectory, outputPath] = process.argv;
if (!devDirectory || !proDirectory) {
  console.error(
    'Usage: node src/diff-dev-pro.mjs <dev-dir> <pro-dir> [output.json]',
  );
  process.exit(2);
}

async function readSnapshot(directory) {
  const [configText, modelsText] = await Promise.all([
    fs.readFile(path.join(directory, 'home-config.raw.json'), 'utf8'),
    fs.readFile(path.join(directory, 'models.raw.json'), 'utf8'),
  ]);
  return { config: JSON.parse(configText), models: JSON.parse(modelsText) };
}

const [dev, pro] = await Promise.all([
  readSnapshot(devDirectory),
  readSnapshot(proDirectory),
]);
const report = diffDevPro({ dev, pro });
const json = JSON.stringify(report, null, 2) + '\n';

if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  await fs.writeFile(resolvedOutputPath, json, 'utf8');
  console.log(JSON.stringify({
    outputPath: resolvedOutputPath,
    hasChanges: report.hasChanges,
    summary: report.summary,
    ignoredDifferences: report.ignoredDifferences,
  }, null, 2));
} else {
  process.stdout.write(json);
}
