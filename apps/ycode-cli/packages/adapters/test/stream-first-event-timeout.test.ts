import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL_FIRST_EVENT_TIMEOUT_MS,
  readNextWithStreamIdleTimeout,
  resolveModelFirstEventTimeoutMs,
  resolveStreamReadTimeoutMs,
} from "../src/model/stream-idle-timeout.js";

const env = (values: Record<string, string>): Record<string, string | undefined> => values;

test("resolveModelFirstEventTimeoutMs defaults to 1h and honors explicit/env values", () => {
  assert.equal(resolveModelFirstEventTimeoutMs({ env: {} }), DEFAULT_MODEL_FIRST_EVENT_TIMEOUT_MS);
  assert.equal(resolveModelFirstEventTimeoutMs({}), 3_600_000);
  assert.equal(
    resolveModelFirstEventTimeoutMs({ env: env({ YCODE_MODEL_FIRST_EVENT_TIMEOUT_MS: "600000" }) }),
    600_000,
  );
  assert.equal(resolveModelFirstEventTimeoutMs({ baseTimeoutMs: 30_000 }), 30_000);
  assert.equal(
    resolveModelFirstEventTimeoutMs({
      baseTimeoutMs: 30_000,
      env: env({ YCODE_MODEL_FIRST_EVENT_TIMEOUT_MS: "600000" }),
    }),
    30_000,
  );
  assert.equal(
    resolveModelFirstEventTimeoutMs({ env: env({ YCODE_MODEL_FIRST_EVENT_TIMEOUT_MS: "junk" }) }),
    DEFAULT_MODEL_FIRST_EVENT_TIMEOUT_MS,
  );
});

test("resolveModelFirstEventTimeoutMs: zero disables the first-event cap", () => {
  assert.equal(resolveModelFirstEventTimeoutMs({ baseTimeoutMs: 0 }), 0);
  assert.equal(
    resolveModelFirstEventTimeoutMs({ env: env({ YCODE_MODEL_FIRST_EVENT_TIMEOUT_MS: "0" }) }),
    0,
  );
});

test("stream read timeout: prefill uses first-event cap, post-first-event uses idle cap", () => {
  assert.equal(
    resolveStreamReadTimeoutMs({
      firstEventReceived: false,
      firstEventTimeoutMs: 3_600_000,
      streamIdleTimeoutMs: 600_000,
    }),
    3_600_000,
  );
  assert.equal(
    resolveStreamReadTimeoutMs({
      firstEventReceived: true,
      firstEventTimeoutMs: 3_600_000,
      streamIdleTimeoutMs: 600_000,
    }),
    600_000,
  );
  // 禁用值原样传递，由 readNextWithStreamIdleTimeout 按禁用处理。
  assert.equal(
    resolveStreamReadTimeoutMs({
      firstEventReceived: false,
      firstEventTimeoutMs: 0,
      streamIdleTimeoutMs: 600_000,
    }),
    0,
  );
});

test("readNextWithStreamIdleTimeout still aborts a stream that never emits", async () => {
  const never = (): AsyncIterator<string> => ({
    next: () => new Promise<IteratorResult<string>>(() => {}),
  });
  const controller = new AbortController();
  const startedAt = Date.now();

  await assert.rejects(
    readNextWithStreamIdleTimeout(never(), {
      abortController: controller,
      timeoutMs: 50,
    }),
    (error: unknown) => {
      // 首事件前的 stall 也复用 ModelStreamIdleTimeoutError，分类与遥测字段保持现状。
      assert.equal((error as { name?: string }).name, "ModelStreamIdleTimeoutError");
      assert.equal((error as { timeoutMs?: number }).timeoutMs, 50);
      assert.ok(Date.now() - startedAt >= 45);
      return true;
    },
  );
});

test("readNextWithStreamIdleTimeout returns events before the cap", async () => {
  let yielded = false;
  const once: AsyncIterator<string> = {
    next: async () => {
      if (yielded) return { done: true, value: undefined };
      yielded = true;
      return { done: false, value: "event" };
    },
  };
  const controller = new AbortController();
  const next = await readNextWithStreamIdleTimeout(once, {
    abortController: controller,
    timeoutMs: 1_000,
  });
  assert.equal(next.done, false);
  assert.equal(next.value, "event");
});
