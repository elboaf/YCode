import { DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS } from "@ycode/contracts";

export { DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS } from "@ycode/contracts";

const MODEL_STREAM_IDLE_TIMEOUT_RETRY_INCREMENT_MS = 30_000;

/**
 * 流式首事件超时默认值：慢 prefill（自托管 llama.cpp CPU MoE ~40 tok/s）在首个
 * provider 事件前不会有任何 SSE 事件，idle timeout 的 600s 不够；上限覆盖最坏
 * prefill + 余量。首事件到达后回退 idle 语义（spec R3）。
 */
export const DEFAULT_MODEL_FIRST_EVENT_TIMEOUT_MS = 3_600_000;

const ENV_MODEL_FIRST_EVENT_TIMEOUT_MS = "YCODE_MODEL_FIRST_EVENT_TIMEOUT_MS";

type EnvRecord = Record<string, string | undefined>;

export function resolveModelFirstEventTimeoutMs(options: {
  baseTimeoutMs?: number;
  env?: EnvRecord;
}): number {
  const fromEnv = parseTimeoutMs(options.env?.[ENV_MODEL_FIRST_EVENT_TIMEOUT_MS]);
  const resolved =
    options.baseTimeoutMs ?? fromEnv ?? DEFAULT_MODEL_FIRST_EVENT_TIMEOUT_MS;
  if (!Number.isFinite(resolved)) {
    return DEFAULT_MODEL_FIRST_EVENT_TIMEOUT_MS;
  }
  // ≤0 视为禁用：首个事件到达前不限时，由传输层总上限兜底。
  return resolved;
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.floor(parsed);
}

/**
 * 单次流读取的超时选择：首个 provider 事件前用首事件超时（prefill 容忍），
 * 到达后回退 idle 超时。≤0 值由 readNextWithStreamIdleTimeout 按“禁用”处理。
 */
export function resolveStreamReadTimeoutMs(input: {
  firstEventReceived: boolean;
  firstEventTimeoutMs: number;
  streamIdleTimeoutMs: number;
}): number {
  return input.firstEventReceived ? input.streamIdleTimeoutMs : input.firstEventTimeoutMs;
}

export function resolveModelStreamIdleTimeoutMs(options: {
  baseTimeoutMs?: number;
  retryNumber?: number;
}): number {
  const baseTimeoutMs =
    options.baseTimeoutMs === undefined || !Number.isFinite(options.baseTimeoutMs)
      ? DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS
      : options.baseTimeoutMs;
  if (baseTimeoutMs <= 0) {
    return baseTimeoutMs;
  }

  const retryNumber =
    options.retryNumber === undefined || !Number.isFinite(options.retryNumber)
      ? 0
      : Math.max(0, Math.floor(options.retryNumber));
  return baseTimeoutMs + retryNumber * MODEL_STREAM_IDLE_TIMEOUT_RETRY_INCREMENT_MS;
}

class ModelStreamIdleTimeoutError extends Error {
  readonly code = "MODEL_STREAM_IDLE_TIMEOUT";
  readonly idleMs: number;
  readonly timeoutMs: number;

  constructor(options: { idleMs: number; timeoutMs: number }) {
    super(`Model stream stalled: no event received for ${options.timeoutMs}ms.`);
    this.name = "ModelStreamIdleTimeoutError";
    this.idleMs = options.idleMs;
    this.timeoutMs = options.timeoutMs;
  }
}

export function isModelStreamIdleTimeoutError(
  error: unknown,
): error is ModelStreamIdleTimeoutError {
  if (error instanceof ModelStreamIdleTimeoutError) {
    return true;
  }

  if (error === null || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  return (
    record.code === "MODEL_STREAM_IDLE_TIMEOUT" || record.name === "ModelStreamIdleTimeoutError"
  );
}

interface LinkedAbortController {
  controller: AbortController;
  signal: AbortSignal;
  cleanup(): void;
}

export function createLinkedAbortController(parentSignal?: AbortSignal): LinkedAbortController {
  const controller = new AbortController();

  if (!parentSignal) {
    return {
      controller,
      signal: controller.signal,
      cleanup() {},
    };
  }

  if (parentSignal.aborted) {
    controller.abort(parentSignal.reason);
    return {
      controller,
      signal: controller.signal,
      cleanup() {},
    };
  }

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal.reason);
    }
  };
  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  return {
    controller,
    signal: controller.signal,
    cleanup() {
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function readNextWithStreamIdleTimeout<T>(
  iterator: AsyncIterator<T>,
  options: {
    abortController: AbortController;
    onTimeout?: (error: ModelStreamIdleTimeoutError) => void | Promise<void>;
    timeoutMs: number;
  },
): Promise<IteratorResult<T>> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return iterator.next();
  }

  const readStartedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  let timedOut = false;
  let timeoutError: ModelStreamIdleTimeoutError | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      if (options.abortController.signal.aborted) {
        reject(options.abortController.signal.reason ?? new Error("Model stream aborted."));
        return;
      }
      timedOut = true;
      timeoutError = new ModelStreamIdleTimeoutError({
        idleMs: Math.max(0, Date.now() - readStartedAt),
        timeoutMs: options.timeoutMs,
      });
      options.abortController.abort(timeoutError);
      reject(timeoutError);
    }, options.timeoutMs);
  });
  const abortPromise = new Promise<never>((_, reject) => {
    const signal = options.abortController.signal;
    const rejectAbort = () => {
      reject(signal.reason ?? new Error("Model stream aborted."));
    };
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    // Stop 按钮会 abort 当前模型请求；如果底层 provider 没有让 iterator.next()
    // 立刻返回，这里必须主动结束等待，否则 UI 会一直卡到 idle timeout。
    signal.addEventListener("abort", rejectAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", rejectAbort);
  });

  try {
    return await Promise.race([iterator.next(), timeoutPromise, abortPromise]);
  } catch (error) {
    if (!timedOut) {
      throw error;
    }

    const idleError =
      timeoutError ??
      new ModelStreamIdleTimeoutError({
        idleMs: Math.max(0, Date.now() - readStartedAt),
        timeoutMs: options.timeoutMs,
      });
    await options.onTimeout?.(idleError);
    throw idleError;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    removeAbortListener?.();
  }
}
