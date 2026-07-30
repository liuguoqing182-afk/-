import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OperationTimeoutError,
  createExclusiveOperationGate,
  runAbortableOperation,
} from '../src/abortable-operation.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('timeout aborts and waits for the underlying operation to settle', async () => {
  let abortObserved = false;
  let cleanupFinished = false;
  const startedAt = Date.now();

  await assert.rejects(
    runAbortableOperation({
      label: 'reader',
      timeoutMs: 10,
      operation: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              abortObserved = true;
              setTimeout(() => {
                cleanupFinished = true;
                reject(new Error('aborted'));
              }, 25);
            },
            { once: true },
          );
        }),
    }),
    (error) =>
      error instanceof OperationTimeoutError &&
      error.code === 'OPERATION_TIMEOUT',
  );

  assert.equal(abortObserved, true);
  assert.equal(cleanupFinished, true);
  assert.ok(Date.now() - startedAt >= 30);
});

test('an operation that resolves after its deadline is still a timeout', async () => {
  await assert.rejects(
    runAbortableOperation({
      label: 'late-reader',
      timeoutMs: 5,
      operation: async () => {
        await delay(20);
        return 'late value';
      },
    }),
    /late-reader timed out after 5ms/,
  );
});

test('exclusive gate never starts the next operation before cleanup finishes', async () => {
  const gate = createExclusiveOperationGate();
  const order = [];

  const first = gate.run(async () => {
    order.push('first-start');
    await delay(20);
    order.push('first-end');
  });
  const second = gate.run(async () => {
    order.push('second-start');
    order.push('second-end');
  });

  await Promise.all([first, second]);
  assert.deepEqual(order, [
    'first-start',
    'first-end',
    'second-start',
    'second-end',
  ]);
  assert.equal(gate.inFlight, 0);
});
