import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderSettingsModelsProber,
  joinModelsProbeUrl,
  parseOpenAiModelsResponse,
  resolveProviderModelsProbeConnection,
} from "../src/model-provider/providerModelsProbe.js";

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("joinModelsProbeUrl appends /models to the API base URL", () => {
  assert.equal(joinModelsProbeUrl("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1/models");
  assert.equal(joinModelsProbeUrl("http://127.0.0.1:8080/v1/"), "http://127.0.0.1:8080/v1/models");
  assert.equal(joinModelsProbeUrl("https://gw.example/api/x"), "https://gw.example/api/x/models");
});

test("joinModelsProbeUrl rejects missing or non-http endpoints", () => {
  assert.throws(() => joinModelsProbeUrl("   "), /No endpoint configured/);
  assert.throws(() => joinModelsProbeUrl("localhost:8080/v1"), /http\(s\) URL/);
  assert.throws(() => joinModelsProbeUrl("ftp://host/v1"), /http\(s\) URL/);
  assert.throws(() => joinModelsProbeUrl("not a url"), /absolute URL/);
});

test("parseOpenAiModelsResponse accepts the OpenAI list shape and bare arrays", () => {
  assert.deepEqual(
    parseOpenAiModelsResponse({
      object: "list",
      data: [{ id: "b" }, { id: "a" }, { id: "b" }, { id: "  " }, {}, "junk"],
    }),
    ["b", "a"],
  );
  assert.deepEqual(parseOpenAiModelsResponse([{ id: "only" }]), ["only"]);
  assert.deepEqual(parseOpenAiModelsResponse({ data: [] }), []);
});

test("parseOpenAiModelsResponse rejects unexpected shapes", () => {
  assert.throws(() => parseOpenAiModelsResponse({}), /unexpected response shape/);
  assert.throws(() => parseOpenAiModelsResponse("junk"), /unexpected response shape/);
  assert.throws(() => parseOpenAiModelsResponse(null), /unexpected response shape/);
});

test("prober sends GET to the joined URL with auth only when a key exists", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(200, JSON.stringify({ data: [{ id: "qwen3-4b" }] }));
  }) as typeof fetch;
  const prober = createProviderSettingsModelsProber({ fetchImpl });

  const withKey = await prober({
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "test-key",
  });
  assert.deepEqual(withKey.models, ["qwen3-4b"]);
  assert.equal(calls[0].url, "http://127.0.0.1:8080/v1/models");
  assert.equal(calls[0].init.method, "GET");
  const headersWithKey = new Headers(calls[0].init.headers);
  assert.equal(headersWithKey.get("Authorization"), "Bearer test-key");

  const withoutKey = await prober({ baseUrl: "http://127.0.0.1:8080/v1" });
  assert.deepEqual(withoutKey.models, ["qwen3-4b"]);
  const headersWithoutKey = new Headers(calls[1].init.headers);
  assert.equal(headersWithoutKey.get("Authorization"), null);
});

test("prober surfaces HTTP and transport failures with context", async () => {
  const statusFetch = (async () => jsonResponse(401, '{"error":"bad key"}')) as typeof fetch;
  await assert.rejects(
    createProviderSettingsModelsProber({ fetchImpl: statusFetch })({
      baseUrl: "http://127.0.0.1:8080/v1",
    }),
    /HTTP 401/,
  );

  const junkFetch = (async () => jsonResponse(200, "not json")) as typeof fetch;
  await assert.rejects(
    createProviderSettingsModelsProber({ fetchImpl: junkFetch })({
      baseUrl: "http://127.0.0.1:8080/v1",
    }),
    /invalid JSON/,
  );

  const brokenFetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  await assert.rejects(
    createProviderSettingsModelsProber({ fetchImpl: brokenFetch })({
      baseUrl: "http://127.0.0.1:8080/v1",
    }),
    /Models endpoint request failed: ECONNREFUSED/,
  );
});

test("resolveProviderModelsProbeConnection reads OpenAI-format facts and rejects others", () => {
  const connection = resolveProviderModelsProbeConnection({
    api: { type: "openai-chat-completions", baseUrl: "http://127.0.0.1:8080/v1" },
    access: { type: "api-key", apiKeyRequired: false },
  });
  assert.deepEqual(connection, { baseUrl: "http://127.0.0.1:8080/v1" });

  const keyed = resolveProviderModelsProbeConnection({
    api: { type: "openai-responses", baseUrl: "https://gw.example/v1" },
    access: { type: "api-key", apiKey: "test-key" },
  });
  assert.deepEqual(keyed, { baseUrl: "https://gw.example/v1", apiKey: "test-key" });

  assert.throws(
    () =>
      resolveProviderModelsProbeConnection({
        api: { type: "anthropic-messages", baseUrl: "http://127.0.0.1:8080" },
      }),
    /OpenAI-compatible/,
  );
  assert.throws(
    () => resolveProviderModelsProbeConnection({ api: { type: "openai-chat-completions" } }),
    /No endpoint configured/,
  );
});
