export class OperationTimeoutError extends Error {
  constructor(label, timeoutMs, options = {}) {
    super(`${label} timed out after ${timeoutMs}ms`, options);
    this.name = 'OperationTimeoutError';
    this.code = 'OPERATION_TIMEOUT';
    this.timeoutMs = timeoutMs;
  }
}

export async function runAbortableOperation({
  label,
  timeoutMs,
  operation,
  onAbortRequested,
  onAbortSettled,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive finite number');
  }
  if (typeof operation !== 'function') {
    throw new TypeError('operation must be a function');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    onAbortRequested?.();
  }, timeoutMs);

  try {
    const result = await operation(controller.signal);
    if (timedOut) {
      throw new OperationTimeoutError(label, timeoutMs);
    }
    return result;
  } catch (error) {
    if (timedOut && !(error instanceof OperationTimeoutError)) {
      throw new OperationTimeoutError(label, timeoutMs, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (timedOut) onAbortSettled?.();
  }
}

export function createExclusiveOperationGate() {
  let tail = Promise.resolve();
  let inFlight = 0;

  return {
    get inFlight() {
      return inFlight;
    },
    async run(operation) {
      const previous = tail.catch(() => {});
      let release;
      tail = new Promise((resolve) => {
        release = resolve;
      });

      await previous;
      inFlight += 1;
      try {
        return await operation();
      } finally {
        inFlight -= 1;
        release();
      }
    },
  };
}
