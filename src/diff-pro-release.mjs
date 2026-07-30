import fs from 'node:fs/promises';
import path from 'node:path';

import { diffProRelease } from './config-diff.mjs';

const [, , beforeDirectory, afterDirectory, outputPath] = process.argv;
if (!beforeDirectory || !afterDirectory) {
  console.error(
    'Usage: node src/diff-pro-release.mjs <before-pro-dir> <after-pro-dir> [output.json]',
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

const [before, after] = await Promise.all([
  readSnapshot(beforeDirectory),
  readSnapshot(afterDirectory),
]);
const report = diffProRelease({ before, after });
const json = JSON.stringify(report, null, 2) + '\n';

if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  await fs.writeFile(resolvedOutputPath, json, 'utf8');
  console.log(JSON.stringify({
    outputPath: resolvedOutputPath,
    hasChanges: report.hasChanges,
    summary: report.summary,
  }, null, 2));
} else {
  process.stdout.write(json);
}
