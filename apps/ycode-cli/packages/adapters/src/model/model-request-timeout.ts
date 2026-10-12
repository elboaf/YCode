import type { EnvRecord } from "./model-execution.js";

type ProviderFetch = typeof globalThis.fetch;

/**
 * 模型请求总超时默认值。
 *
 * 自托管 OpenAI 兼容端点（llama.cpp 等）的 prompt prefill 可能只有 ~40 tok/s，
 * 128k prompt 约 55 分钟且期间无任何 header/body/SSE 事件；上限必须覆盖最坏
 * prefill + 生成（见 docs/specs/model-provider/model-request-prefill-safe-timeouts.md）。
 */
export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 3_600_000;

const ENV_MODEL_REQUEST_TIMEOUT_MS = "YCODE_MODEL_REQUEST_TIMEOUT_MS";

/**
 * 总超时触发的类型化错误。name/code 独立于 AbortError，保证用户 Stop（Cancelled）
 * 与总超时（retryable Timeout）在 failure-inspection 的分类中不混淆。
 */
export class ModelRequestTimeoutError extends Error {
  readonly code = "MODEL_REQUEST_TIMEOUT";
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Model request timed out after ${timeoutMs}ms.`);
    this.name = "ModelRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 解析总超时：显式注入优先于环境变量，环境变量优先于默认值。
 * 值 ≤0 视为禁用（返回原值，由调用方按 ≤0 跳过计时）；非法值回退默认。
 */
export function resolveModelRequestTimeoutMs(options: {
  baseTimeoutMs?: number;
  env?: EnvRecord;
}): number {
  const fromEnv = parseTimeoutMs(options.env?.[ENV_MODEL_REQUEST_TIMEOUT_MS]);
  return normalizeTimeoutMs(
    options.baseTimeoutMs ?? fromEnv ?? DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
  );
}

function normalizeTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
  }
  return value;
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
 * 为模型传输链路套上总超时上限。
 *
 * 计时覆盖整个请求生命周期（gateway/proxy hop、header 等待、响应体消费）：
 * 非流式响应 header 早到但 body 迟到同样受约束；计时器在响应体结束、出错或
 * 被取消时清除。外部 abort signal（用户 Stop）以原 reason 直通，不被改写。
 */
export function createModelRequestTimeoutFetch(options: {
  fetch: ProviderFetch;
  timeoutMs: number;
}): ProviderFetch {
  const { timeoutMs } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return options.fetch;
  }

  return async (input, init) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const externalSignal = init?.signal ?? undefined;
    const finish = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      externalSignal?.removeEventListener("abort", onExternalAbort);
    };
    const onExternalAbort = (): void => {
      controller.abort(externalSignal?.reason);
    };

    if (externalSignal?.aborted) {
      // 外部已取消：直接透传，保持上层 Cancelled 语义。
      return options.fetch(input, init);
    }
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort(new ModelRequestTimeoutError(timeoutMs));
    }, timeoutMs);

    try {
      const response = await options.fetch(input, {
        ...init,
        signal: controller.signal,
      });
      // 成功路径不停表：计时器延伸到响应体消费完成，由包装流负责清除。
      return bindTimeoutToResponseBody(response, finish);
    } catch (error) {
      finish();
      // 计时器触发的 abort reason 是 ModelRequestTimeoutError；
      // 其他错误（含外部取消）原样上抛，分类保持现状。
      throw error;
    }
  };
}

/**
 * 用探测结束事件的包装流替换响应体：流结束 / 出错 / 取消时清除总超时计时器，
 * 并保留原始 status/headers 语义（body 为 null 的响应无需包装）。
 */
function bindTimeoutToResponseBody(response: Response, finish: () => void): Response {
  const body = response.body;
  if (!body) {
    finish();
    return response;
  }

  const reader = body.getReader();
  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      try {
        await reader.cancel(reason);
      } catch {
        // 取消失败不能覆盖上层正在处理的取消语义。
      }
    },
  });

  return new Response(wrapped, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}
