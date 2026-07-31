import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { fetchHomeSnapshot } from './am-home-client.mjs';
import {
  isFormalAppScreenshotTarget,
  normalizeAppScreenshotReportTarget,
} from './app-screenshot-report-target.mjs';
import { planAppScreenshotTasks } from './app-screenshot-task-planner.mjs';
import { parsePublishNotification } from './message-parser.mjs';

const execFileAsync = promisify(execFile);

function safePathSegment(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 160);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(temporaryPath, filePath);
}

export function summarizeIncompleteScreenshotTasks(execution) {
  const taskResults = Array.isArray(execution?.taskResults)
    ? execution.taskResults
    : [];
  return taskResults
    .filter((task) => task?.executionState === 'SCREENSHOT_INCOMPLETE')
    .map((task) => {
      const attemptCount = Array.isArray(task.attempts)
        ? task.attempts.length
        : 0;
      return {
        module: String(task.module ?? ''),
        objectName: String(task.objectName ?? ''),
        attemptCount,
        retryCount: Math.max(0, attemptCount - 1),
        reasonCode: String(
          task.verdictReasonCode ?? 'AUTOMATION_EXECUTION_ERROR',
        ),
        reason: String(
          task.verdictReason ??
            task.finalError ??
            '截图任务执行失败，未记录具体原因',
        ),
      };
    });
}

async function runProcess(command, args, options = {}) {
  const stdoutPath = path.resolve(options.stdoutPath);
  const stderrPath = path.resolve(options.stderrPath);
  await fs.mkdir(path.dirname(stdoutPath), { recursive: true });
  const stdout = await fs.open(stdoutPath, 'a');
  const stderr = await fs.open(stderrPath, 'a');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: true,
        stdio: ['ignore', stdout.fd, stderr.fd],
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `${path.basename(command)} exited with code ${code}` +
              (signal ? `, signal ${signal}` : ''),
          ),
        );
      });
    });
  } finally {
    await Promise.allSettled([stdout.close(), stderr.close()]);
  }
}

async function androidVersionLabel(deviceId, packageName) {
  try {
    const { stdout } = await execFileAsync(
      process.env.ADB || 'adb',
      ['-s', deviceId, 'shell', 'dumpsys', 'package', packageName],
      { timeout: 20_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    );
    const versionName = stdout.match(/versionName=([^\s]+)/)?.[1] ?? '?';
    const versionCode = stdout.match(/versionCode=(\d+)/)?.[1] ?? '?';
    return `${versionName} (${versionCode})`;
  } catch {
    return 'unknown';
  }
}

export class AppScreenshotTestPipeline {
  constructor(options = {}) {
    this.root = path.resolve(options.root ?? process.cwd());
    this.reportTarget = normalizeAppScreenshotReportTarget(
      options.reportTarget,
    );
    this.formalGroupOutputEnabled = isFormalAppScreenshotTarget(
      this.reportTarget,
    );
    this.releaseRoot = path.resolve(
      options.releaseRoot ??
        path.join(
          this.root,
          'data-app-screenshot',
          this.formalGroupOutputEnabled
            ? 'formal-group-releases'
            : 'test-group-releases',
        ),
    );
    this.deviceId = String(
      options.deviceId ?? process.env.AM_DEVICE_ID ?? 'R38M805JQHM',
    ).trim();
    this.packageName = String(
      options.packageName ??
        process.env.AM_PACKAGE_NAME ??
        'com.ai.polyverse.mirror',
    ).trim();
    this.python = String(options.python ?? process.env.PYTHON ?? 'python');
    this.activeMessageIds = new Set();
  }

  async run(candidate) {
    const messageId = String(candidate?.messageId ?? '').trim();
    const notificationText = String(
      candidate?.notificationText ?? candidate?.text ?? '',
    ).trim();
    if (!messageId) throw new Error('messageId is required');
    if (!notificationText) throw new Error('notificationText is required');
    if (this.activeMessageIds.has(messageId)) {
      return { skipped: true, reason: 'ALREADY_RUNNING', messageId };
    }

    const releaseDir = path.join(
      this.releaseRoot,
      safePathSegment(messageId) || 'message',
    );
    const statusPath = path.join(releaseDir, 'pipeline-status.json');
    const previousStatus = await readJsonIfExists(statusPath);
    if (
      previousStatus?.state === 'DELIVERED' ||
      previousStatus?.state === 'DELIVERED_WITH_INCOMPLETE'
    ) {
      return {
        skipped: true,
        reason: 'ALREADY_DELIVERED',
        messageId,
        releaseDir,
      };
    }
    if (previousStatus?.state === 'FAILED') {
      return {
        skipped: true,
        reason: 'PREVIOUSLY_FAILED',
        messageId,
        releaseDir,
      };
    }

    this.activeMessageIds.add(messageId);
    const startedAt = new Date().toISOString();
    const notificationPath = path.join(releaseDir, 'publish-notification.txt');
    const planPath = path.join(releaseDir, 'screenshot-plan.json');
    const executionDir = path.join(releaseDir, 'execution');
    const executionPath = path.join(executionDir, 'execution.json');
    const collagePath = path.join(
      releaseDir,
      'AIMirror-首屏配置自动化截图总图.jpg',
    );
    const receiptPath = path.join(
      releaseDir,
      this.formalGroupOutputEnabled
        ? 'formal-group-delivery-receipt.json'
        : 'test-group-delivery-receipt.json',
    );

    const updateStatus = async (state, extra = {}) => {
      await writeJsonAtomic(statusPath, {
        pipelineType: this.formalGroupOutputEnabled
          ? 'AM_FORMAL_GROUP_APP_SCREENSHOT_PIPELINE_V1'
          : 'AM_TEST_GROUP_APP_SCREENSHOT_PIPELINE_V1',
        reportTarget: this.reportTarget,
        state,
        messageId,
        releaseDir,
        startedAt,
        updatedAt: new Date().toISOString(),
        ...extra,
      });
    };

    try {
      await fs.mkdir(releaseDir, { recursive: true });
      await fs.writeFile(notificationPath, `${notificationText}\n`, 'utf8');
      await updateStatus('PLANNING');

      const parsed = parsePublishNotification(notificationText);
      if (!parsed.valid || !parsed.fullyParsed) {
        throw new Error(
          `publish notification is not fully parseable: ${JSON.stringify({
            errors: parsed.errors,
            unparsedLines: parsed.unparsedLines,
          })}`,
        );
      }
      let targetSnapshot = null;
      let targetSnapshotWarning = null;
      try {
        const uid = String(process.env.AM_INSPECT_UID ?? '').trim();
        if (!uid) throw new Error('AM_INSPECT_UID is not configured');
        const targetHome = await fetchHomeSnapshot(parsed.targetEnvironment, {
          uid,
        });
        targetSnapshot = targetHome.snapshot;
      } catch (error) {
        targetSnapshotWarning =
          `目标环境模型目录读取失败，标签模型名称将标记为无法映射：${
            error?.message || error
          }`;
      }
      const planningContext = {
        messageId,
        notificationPath,
        targetSnapshot,
        reportTarget: this.reportTarget,
      };
      const plan = planAppScreenshotTasks(parsed, planningContext);
      if (targetSnapshotWarning) {
        plan.planningWarnings.unshift(targetSnapshotWarning);
      }
      if (plan.totals.taskCount < 1) {
        throw new Error('publish notification generated no screenshot tasks');
      }
      await writeJsonAtomic(planPath, plan);
      await updateStatus('SCREENSHOTTING', {
        taskCount: plan.totals.taskCount,
        expectedScreenshotCount: plan.totals.screenshotCount,
      });

      await runProcess(
        process.execPath,
        [
          path.join(this.root, 'scripts', 'run-app-screenshot-plan.mjs'),
          '--plan',
          planPath,
          '--output',
          executionDir,
          '--device-id',
          this.deviceId,
          '--package',
          this.packageName,
        ],
        {
          cwd: this.root,
          stdoutPath: path.join(executionDir, 'runner.stdout.log'),
          stderrPath: path.join(executionDir, 'runner.stderr.log'),
          env: {
            ...process.env,
            FEISHU_NOTIFY_ENABLED: '0',
            FEISHU_CHAT_ID: '',
          },
        },
      );

      const execution = await readJsonIfExists(executionPath);
      if (!execution?.summary) {
        throw new Error('screenshot execution did not produce a summary');
      }
      const incompleteTasks = summarizeIncompleteScreenshotTasks(execution);
      await updateStatus('BUILDING_COLLAGE', {
        executionSummary: execution.summary,
        incompleteTasks,
      });

      const appVersion = await androidVersionLabel(
        this.deviceId,
        this.packageName,
      );
      await runProcess(
        this.python,
        [
          path.join(this.root, 'scripts', 'build-app-screenshot-collage.py'),
          '--execution',
          executionPath,
          '--output',
          collagePath,
          '--operator',
          plan.operator || '—',
          '--release',
          `${plan.sourceEnvironment || '?'} → ${plan.targetEnvironment || '?'}`,
          '--app-version',
          appVersion,
          '--message-id',
          messageId,
        ],
        {
          cwd: this.root,
          stdoutPath: path.join(releaseDir, 'collage.stdout.log'),
          stderrPath: path.join(releaseDir, 'collage.stderr.log'),
        },
      );

      await updateStatus('DELIVERING', {
        executionSummary: execution.summary,
        incompleteTasks,
        collagePath,
      });
      await runProcess(
        process.execPath,
        [
          path.join(
            this.root,
            'scripts',
            'send-app-screenshot-collage-to-test-group.mjs',
          ),
          '--image',
          collagePath,
          '--receipt',
          receiptPath,
          '--root',
          this.root,
          '--target',
          this.reportTarget,
        ],
        {
          cwd: this.root,
          stdoutPath: path.join(releaseDir, 'delivery.stdout.log'),
          stderrPath: path.join(releaseDir, 'delivery.stderr.log'),
        },
      );
      const receipt = await readJsonIfExists(receiptPath);
      const deliveredState =
        incompleteTasks.length > 0
          ? 'DELIVERED_WITH_INCOMPLETE'
          : 'DELIVERED';
      await updateStatus(deliveredState, {
        completedAt: new Date().toISOString(),
        executionSummary: execution.summary,
        incompleteTasks,
        collagePath,
        deliveryMessageId: receipt?.messageId ?? null,
      });
      return {
        skipped: false,
        messageId,
        releaseDir,
        plan,
        executionSummary: execution.summary,
        incompleteTasks,
        deliveredState,
        collagePath,
        deliveryMessageId: receipt?.messageId ?? null,
      };
    } catch (error) {
      await updateStatus('FAILED', {
        failedAt: new Date().toISOString(),
        error: error?.stack || error?.message || String(error),
      }).catch(() => {});
      throw error;
    } finally {
      this.activeMessageIds.delete(messageId);
    }
  }
}
