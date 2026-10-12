import assert from "node:assert/strict";
import test from "node:test";

import { classifyModelFailure } from "../src/model/failure-classifier.js";
import { getErrorCode, isTimeoutFailure } from "../src/model/failure-inspection.js";
import {
  createModelRequestTimeoutFetch,
  DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
  ModelRequestTimeoutError,
  resolveModelRequestTimeoutMs,
} from "../src/model/model-request-timeout.js";

const env = (values: Record<string, string>): Record<string, string | undefined> => values;

function neverSettlingFetch(): typeof globalThis.fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      // 模拟慢 prefill：服务器不返回 header、body 或任何事件；
      // 与真实传输一致，信号中止时 reject（node:http / undici 都如此）。
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason ?? new Error("aborted")),
        { once: true },
      );
    });
}

/** 模拟真实传输：fetch 信号中止时销毁响应体流（与 node:http / undici 行为一致）。 */
function hangingBodyFetch(): typeof globalThis.fetch {
  return (_input, init) => {
    const signal = init?.signal;
    return new Promise<Response>((resolve) => {
      resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              signal?.addEventListener(
                "abort",
                () => {
                  controller.error(signal.reason);
                },
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      );
    });
  };
}

test("resolveModelRequestTimeoutMs defaults to 1h when nothing is configured", () => {
  assert.equal(resolveModelRequestTimeoutMs({ env: {} }), DEFAULT_MODEL_REQUEST_TIMEOUT_MS);
  assert.equal(resolveModelRequestTimeoutMs({}), DEFAULT_MODEL_REQUEST_TIMEOUT_MS);
  assert.equal(resolveModelRequestTimeoutMs({ env: env({}) }), 3_600_000);
});

test("resolveModelRequestTimeoutMs: explicit option wins over env, invalid env falls back", () => {
  assert.equal(
    resolveModelRequestTimeoutMs({ baseTimeoutMs: 5_000, env: env({ YCODE_MODEL_REQUEST_TIMEOUT_MS: "9000" }) }),
    5_000,
  );
  assert.equal(
    resolveModelRequestTimeoutMs({ env: env({ YCODE_MODEL_REQUEST_TIMEOUT_MS: "7200000" }) }),
    7_200_000,
  );
  assert.equal(
    resolveModelRequestTimeoutMs({ env: env({ YCODE_MODEL_REQUEST_TIMEOUT_MS: "not-a-number" }) }),
    DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
  );
});

test("resolveModelRequestTimeoutMs: zero disables the cap", () => {
  assert.equal(resolveModelRequestTimeoutMs({ baseTimeoutMs: 0 }), 0);
  assert.equal(resolveModelRequestTimeoutMs({ env: env({ YCODE_MODEL_REQUEST_TIMEOUT_MS: "0" }) }), 0);
});

test("total timeout aborts a request that never responds, classified as retryable timeout", async () => {
  const startedAt = Date.now();
  const fetch = createModelRequestTimeoutFetch({
    fetch: neverSettlingFetch(),
    timeoutMs: 50,
  });

  await assert.rejects(
    fetch("http://llama.local:8080/v1/chat/completions", { method: "POST" }),
    (error: unknown) => {
      assert.ok(error instanceof ModelRequestTimeoutError);
      assert.equal(error.name, "ModelRequestTimeoutError");
      assert.equal(error.code, "MODEL_REQUEST_TIMEOUT");
      assert.ok(Date.now() - startedAt >= 45);
      // 与 failure-classifier 对 undici 300s 事故相同的 retryable Timeout 分类。
      const classified = classifyModelFailure(error, undefined);
      assert.equal(classified.code, "model_request_timeout");
      assert.equal(classified.reason, "timeout");
      assert.equal(classified.retryable, true);
      return true;
    },
  );
});

test("timeout error stays classifiable through an AI SDK style wrapper (cause chain)", () => {
  const timeoutError = new ModelRequestTimeoutError(50);
  const wrapped = {
    name: "AI_APICallError",
    message: "request failed",
    cause: timeoutError,
  };
  const code = getErrorCode(wrapped);
  assert.equal(code, "MODEL_REQUEST_TIMEOUT");
  assert.equal(isTimeoutFailure(wrapped, code, undefined), true);
});

test("external abort passes through with its own reason (Stop stays Cancelled)", async () => {
  const controller = new AbortController();
  const fetch = createModelRequestTimeoutFetch({
    fetch: neverSettlingFetch(),
    timeoutMs: 1_000,
  });

  const pending = fetch("http://llama.local:8080/v1/chat/completions", {
    method: "POST",
    signal: controller.signal,
  });
  const stopReason = new Error("user pressed stop");
  setTimeout(() => controller.abort(stopReason), 10);

  await assert.rejects(pending, (error: unknown) => {
    assert.equal(error, stopReason);
    return true;
  });
});

test("pre-aborted external signal is passed through untouched", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already stopped"));
  let sawSignal: AbortSignal | undefined;
  const fetch = createModelRequestTimeoutFetch({
    fetch: (_input, init) => {
      sawSignal = init?.signal;
      return Promise.reject(init?.signal?.reason ?? new Error("aborted"));
    },
    timeoutMs: 1_000,
  });

  await assert.rejects(
    fetch("http://llama.local:8080/v1/chat/completions", { signal: controller.signal }),
    /already stopped/,
  );
  // 透传路径不得替换外部信号。
  assert.equal(sawSignal, controller.signal);
});

test("response body consumed before the cap is not aborted afterwards", async () => {
  const fetch = createModelRequestTimeoutFetch({
    fetch: () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    timeoutMs: 60,
  });

  const response = await fetch("http://llama.local:8080/v1/models");
  const body = await response.text();
  assert.equal(body, "data: hello\n\n");
  // 响应体已结束、计时器已清除：等到超过上限也不得再出错。
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(response.status, 200);
});

test("stalled response body is aborted at the cap", async () => {
  const fetch = createModelRequestTimeoutFetch({
    fetch: hangingBodyFetch(),
    timeoutMs: 60,
  });

  const response = await fetch("http://llama.local:8080/v1/chat/completions", {
    method: "POST",
  });
  await assert.rejects(response.text(), (error: unknown) => {
    assert.ok(error instanceof ModelRequestTimeoutError);
    return true;
  });
});

test("zero timeout disables the cap entirely", async () => {
  const fetch = createModelRequestTimeoutFetch({
    fetch: neverSettlingFetch(),
    timeoutMs: 0,
  });
  const pending = fetch("http://llama.local:8080/v1/chat/completions", { method: "POST" });
  const result = await Promise.race([
    pending.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"still-pending">((resolve) => setTimeout(() => resolve("still-pending"), 120)),
  ]);
  assert.equal(result, "still-pending");
});
