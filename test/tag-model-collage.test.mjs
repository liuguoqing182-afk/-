import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const COLLAGE_SCRIPT = path.join(
  ROOT,
  'scripts',
  'build-app-screenshot-collage.py',
);

test('renders the automatic verdict with the same font as the report title', async () => {
  const source = await readFile(COLLAGE_SCRIPT, 'utf8');
  assert.match(
    source,
    /draw\.text\(\(MARGIN,\s*100\), verdict_text, fill=verdict_fill, font=F_TITLE\)/,
  );
});

test('renders expected, actual, found, and missing tag model names', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'am-tag-collage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const screenshotPath = path.join(
    ROOT,
    'docs',
    'assets',
    'am-screenshot-reference',
    'source-01.png',
  );
  const executionPath = path.join(directory, 'execution.json');
  const outputPath = path.join(directory, 'report.png');
  await writeFile(
    executionPath,
    `${JSON.stringify({
      taskResults: [
        {
          module: '新首页配置',
          objectName: 'Retro',
          screenshotTotal: 1,
          executionState: 'SCREENSHOTS_CAPTURED',
          businessVerdict: 'FAIL',
          verdictReasonCode: 'TAG_MODEL_NAME_MISMATCH',
          verdictReason: '未找到新增模型：Vintage Transit(1418)',
          attempts: [{ attempt: 1 }],
          modelAssertions: [
            {
              id: '1419',
              name: 'Station Wanderer',
              expectedState: 'PRESENT',
            },
            {
              id: '1418',
              name: 'Vintage Transit',
              expectedState: 'PRESENT',
            },
          ],
          evidence: {
            evidenceType: 'TAG_MODEL_NAME_SCAN',
            actualModelNames: ['Station Wanderer', 'Existing Style'],
            foundModelNames: ['Station Wanderer'],
            missingModels: [
              {
                id: '1418',
                name: 'Vintage Transit',
                expectedState: 'PRESENT',
              },
            ],
            unexpectedlyPresentModels: [],
            unresolvedModels: [],
            comparisons: [
              {
                id: '1419',
                expectedName: 'Station Wanderer',
                expectedState: 'PRESENT',
                actualName: 'Station Wanderer',
                result: 'FOUND',
              },
              {
                id: '1418',
                expectedName: 'Vintage Transit',
                expectedState: 'PRESENT',
                actualName: null,
                result: 'MISSING',
              },
            ],
            actualNameCollectionComplete: true,
            actualNameCollectionWarnings: [],
          },
          screenshots: [
            {
              sequence: 1,
              total: 1,
              label: '新首页配置｜Retro｜1/1截图｜不通过',
              path: screenshotPath,
            },
          ],
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );

  const processResult = spawnSync(
    'python',
    [
      COLLAGE_SCRIPT,
      '--execution',
      executionPath,
      '--output',
      outputPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(processResult.status, 0, processResult.stderr);
  const result = JSON.parse(processResult.stdout.trim());
  assert.equal(result.tagModelComparisons.length, 1);
  assert.deepEqual(result.tagModelComparisons[0].actualModelNames, [
    'Station Wanderer',
    'Existing Style',
  ]);
  assert.deepEqual(
    result.tagModelComparisons[0].missingModels.map((item) => item.name),
    ['Vintage Transit'],
  );
  assert.ok((await stat(outputPath)).size > 1_000);
});
