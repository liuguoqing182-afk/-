import fs from 'node:fs/promises';

import { standardizeConfigSnapshot } from './config-standardizer.mjs';

const [, , configPath, modelsPath, environment] = process.argv;
if (!configPath || !modelsPath) {
  console.error(
    'Usage: node src/standardize-config.mjs <home-config.json> <models.json> [environment]',
  );
  process.exit(2);
}

const [configText, modelsText] = await Promise.all([
  fs.readFile(configPath, 'utf8'),
  fs.readFile(modelsPath, 'utf8'),
]);
const snapshot = standardizeConfigSnapshot({
  config: JSON.parse(configText),
  models: JSON.parse(modelsText),
  environment,
});

console.log(JSON.stringify(snapshot, null, 2));
if (!snapshot.valid) process.exitCode = 1;
