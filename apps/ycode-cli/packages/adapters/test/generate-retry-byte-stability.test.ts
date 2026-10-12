import assert from "node:assert/strict";
import test from "node:test";

import type { AiSdkModelTextRequest, ResolvedAiSdkModel } from "../src/model/runner-runtime.js";
import { runGenerateText } from "../src/model/runner-generate.js";
import { ModelRequestTimeoutError } from "../src/model/model-request-timeout.js";
import { resolveAiSdkModelRetryOptions } from "../src/model/retry-policy.js";

const resolved = {
  providerId: "llama-cpp",
  modelId: "qwen36-uncensored",
  providerKind: "openai-compatible",
  model: {},
  properties: {},
} as unknown as ResolvedAiSdkModel;

const request: AiSdkModelTextRequest = {
  messages: [
    { role: "system", content: "static system head" },
    { role: "user", content: "extract memory" },
  ],
};

test("generateText retries re-send a byte-identical prompt (no error context appended)", async () => {
  const capturedMessages: string[] = [];
  let attempts = 0;

  const result = await runGenerateText({
    env: {},
    request,
    resolveModel: () => resolved,
    resolved,
    retry: resolveAiSdkModelRetryOptions(
      { maxAttempts: 3, baseDelayMs: 1, jitter: false },
      {},
    ),
    runtime: {
      generateText: async (options) => {
        attempts += 1;
        capturedMessages.push(JSON.stringify(options.messages));
        if (attempts < 3) {
          // 慢 prefill 被总上限中止的现场：retryable Timeout。
          throw new ModelRequestTimeoutError(1_000);
        }
        return {
          text: "ok",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1 },
          toolCalls: [],
          toolResults: [],
          sources: [],
          reasoning: [],
        } as Awaited<ReturnType<typeof import("ai").generateText>>;
      },
      streamText: () => {
        throw new Error("streamText must not be used by runGenerateText");
      },
    },
    modelIoFullRetentionEnabled: false,
  });

  assert.equal(attempts, 3);
  assert.equal(result.text, "ok");
  // spec R4：attempt 间 messages 逐字节一致，重试不得附加错误文本或部分输出。
  assert.equal(capturedMessages.length, 3);
  assert.equal(capturedMessages[0], capturedMessages[1]);
  assert.equal(capturedMessages[1], capturedMessages[2]);
});
