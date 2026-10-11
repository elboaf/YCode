import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ycode-llama-preset-"));
  setDataBaseDir(dir);
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const personalPath = join(configDir, "personal.json");
  const runtime = createProviderConfigRuntime({
    ycodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/ycode-builtin.json", import.meta.url),
    ),
    personalFilePath: personalPath,
    personalPollingIntervalMs: false,
    watch: false,
    readLegacyProviders: async () => [],
  });
  return {
    runtime,
    async dispose() {
      runtime.dispose();
      setDataBaseDir(null);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("llama.cpp preset creates a keyless OpenAI-compatible personal provider", async () => {
  const fixture = await setup();
  try {
    await fixture.runtime.start();
    const created = await fixture.runtime.configService.createPersonalProvider({
      presetId: "llama-cpp",
    });
    const config = await fixture.runtime.configService.read();
    const rule = config.personalProviders.getRule(created.providerId);
    assert.ok(rule);
    assert.equal(rule.providerName, "llama.cpp");
    assert.equal(rule.config.api?.type, "openai-chat-completions");
    assert.equal(rule.config.api?.baseUrl, "http://127.0.0.1:8080/v1");
    assert.equal(rule.config.access?.type, "api-key");
    assert.equal(rule.config.access?.apiKeyRequired, false);
    assert.equal(rule.config.access?.apiKey, undefined);
    // 免鉴权实例必须直接通过完整校验，否则模型永远不会进入 Registry。
    assert.deepEqual(rule.config.validateComplete(["providers", created.providerId]), []);
  } finally {
    await fixture.dispose();
  }
});

test("llama.cpp preset rejects unknown ids and template conflicts", async () => {
  const fixture = await setup();
  try {
    await fixture.runtime.start();
    await assert.rejects(
      fixture.runtime.configService.createPersonalProvider({ presetId: "nope" }),
      /预设不存在/,
    );
    await assert.rejects(
      fixture.runtime.configService.createPersonalProvider({
        presetId: "llama-cpp",
        templateId: "openai",
      }),
      /不能同时指定/,
    );
  } finally {
    await fixture.dispose();
  }
});
