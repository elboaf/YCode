import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelConfigRules,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
} from "@ycode/provider";

// Registry 只发布带可执行模型的 Provider；这里补一个完整模型配置作为成员。
const completeModelData = {
  enabled: true,
  properties: {
    requiresMfjsToolSchema: false,
    contextWindow: 131072,
    inputFormat: {
      supportsText: true,
      supportsImage: false,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: false,
    },
    outputFormat: { supportsText: true },
    supportsToolCall: true,
    supportsJsonSchemaOutput: false,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: false,
  },
  optionSpecs: {
    reasoningLevel: { values: ["disabled", "enabled"], map: "{}" },
    maxOutputTokens: { max: 32768, map: "{}" },
  },
} as const;

function accessIssues(access: { apiKey?: string; apiKeyRequired?: boolean }): string[] {
  const config = new ProviderConfig({
    group: "standard-personal",
    api: new ProviderApiConfig({
      type: "openai-chat-completions",
      baseUrl: "http://127.0.0.1:8080/v1",
    }),
    access: new ApiKeyAccessConfig({ type: "api-key", ...access }),
  });
  return config
    .validateComplete(["providers", "test"])
    .filter((issue) => issue.path.includes("access"))
    .map((issue) => issue.code);
}

test("complete validation keeps requiring an api key for regular api-key providers", () => {
  assert.deepEqual(accessIssues({}), ["required-field-missing"]);
  assert.deepEqual(accessIssues({ apiKey: "" }), ["required-field-missing"]);
  assert.deepEqual(accessIssues({ apiKey: "   " }), ["required-field-missing"]);
  assert.deepEqual(accessIssues({ apiKey: "test-key" }), []);
});

test("apiKeyRequired false admits providers without a stored key", () => {
  assert.deepEqual(accessIssues({ apiKeyRequired: false }), []);
  assert.deepEqual(accessIssues({ apiKeyRequired: false, apiKey: "" }), []);
  assert.deepEqual(accessIssues({ apiKeyRequired: false, apiKey: "test-key" }), []);
  // 显式 true 与未声明等价：Key 仍然必填。
  assert.deepEqual(accessIssues({ apiKeyRequired: true }), ["required-field-missing"]);
});

test("overlay preserves apiKeyRequired across saves", () => {
  const keyless = new ApiKeyAccessConfig({ type: "api-key", apiKeyRequired: false });
  const withKey = new ApiKeyAccessConfig({ type: "api-key", apiKey: "test-key" });
  assert.equal(keyless.overlay(withKey).apiKeyRequired, false);
  assert.equal(keyless.overlay(withKey).apiKey, "test-key");
  assert.equal(withKey.overlay(keyless).apiKeyRequired, false);
});

test("registry publishes a keyless llama.cpp-style provider", () => {
  const resolver = new ProviderConfigResolver();
  const resolution = resolver.resolve({
    ycodeBuiltinProviders: ProviderConfigMap.empty(),
    personalProviders: new ProviderConfigMap([
      [
        "llama-cpp",
        new ProviderConfig({
          group: "standard-personal",
          access: new ApiKeyAccessConfig({ type: "api-key", apiKeyRequired: false }),
          api: new ProviderApiConfig({
            type: "openai-chat-completions",
            baseUrl: "http://127.0.0.1:8080/v1",
          }),
          personalModelIds: ["qwen3-4b"],
        }),
      ],
    ]),
    ycodeBuiltinModelRules: ModelConfigRules.empty(),
    personalModels: new ModelConfigRules([
      {
        type: "manual-provider-model",
        providerId: "llama-cpp",
        modelId: "qwen3-4b",
        config: ModelConfig.fromData(completeModelData),
      },
    ]),
    accountProviders: ProviderConfigMap.empty(),
  });
  assert.deepEqual(resolution.issues, []);
  assert.equal(resolution.resolvedProviders.length, 1);
  assert.deepEqual(resolution.resolvedProviders[0].providerIssues, []);
  assert.equal(resolution.registryProviders.length, 1);
  assert.equal(resolution.registryProviders[0].providerId, "llama-cpp");
  assert.equal(resolution.registryProviders[0].models[0]?.modelId, "qwen3-4b");
});

test("registry still refuses an api-key provider without a key and without the flag", () => {
  const resolver = new ProviderConfigResolver();
  const resolution = resolver.resolve({
    ycodeBuiltinProviders: ProviderConfigMap.empty(),
    personalProviders: new ProviderConfigMap([
      [
        "needs-key",
        new ProviderConfig({
          group: "standard-personal",
          access: new ApiKeyAccessConfig({ type: "api-key" }),
          api: new ProviderApiConfig({
            type: "openai-chat-completions",
            baseUrl: "http://127.0.0.1:8080/v1",
          }),
        }),
      ],
    ]),
    ycodeBuiltinModelRules: ModelConfigRules.empty(),
    personalModels: ModelConfigRules.empty(),
    accountProviders: ProviderConfigMap.empty(),
  });
  assert.ok(resolution.issues.some((issue) => issue.code === "required-field-missing"));
  assert.equal(resolution.registryProviders.length, 0);
});
