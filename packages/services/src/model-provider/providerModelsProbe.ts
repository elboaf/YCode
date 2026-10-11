import { isApiKeyAccess, type ProviderConfigObject } from "@ycode/provider";

const MODELS_PROBE_TIMEOUT_MS = 10_000;
const MODELS_PROBE_ERROR_BODY_SNIPPET_LIMIT = 200;

/** 探测只读取已落盘的连接事实；Renderer 不得自报 baseUrl/apiKey。 */
export interface ProviderModelsProbeConnection {
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export interface ProviderModelsProbeResult {
  readonly models: readonly string[];
}

export type ProviderSettingsModelsProber = (
  connection: ProviderModelsProbeConnection,
) => Promise<ProviderModelsProbeResult>;

/** baseUrl 是 API 前缀（含 /v1）；模型列表挂在同一前缀下，不重复拼 /v1。 */
export function joinModelsProbeUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("No endpoint configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Provider endpoint must be an absolute URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Provider endpoint must be an http(s) URL: ${trimmed}`);
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/models${parsed.search}`;
}

/** 兼容 OpenAI `{data:[{id}]}` 与裸数组两种列表形态；空列表是有效结果。 */
export function parseOpenAiModelsResponse(payload: unknown): readonly string[] {
  const entries = readModelEntries(payload);
  if (!entries) {
    throw new Error("Models endpoint returned an unexpected response shape.");
  }
  const models: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = readEntryId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }
  return models;
}

function readModelEntries(payload: unknown): readonly unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (payload !== null && typeof payload === "object") {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data;
  }
  return null;
}

function readEntryId(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const id = (entry as Record<string, unknown>).id;
  return typeof id === "string" ? id.trim() || undefined : undefined;
}

/** Host 侧唯一发出探测请求的位置；复用 Host API 网络栈（代理/CA）与 testModelConnectivity 同环境。 */
export function createProviderSettingsModelsProber(dependencies: {
  readonly fetchImpl: typeof fetch;
}): ProviderSettingsModelsProber {
  return async (connection) => {
    const url = joinModelsProbeUrl(connection.baseUrl);
    const headers = new Headers({ Accept: "application/json" });
    if (connection.apiKey) {
      headers.set("Authorization", `Bearer ${connection.apiKey}`);
    }
    let response: Response;
    try {
      response = await dependencies.fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(MODELS_PROBE_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new Error(
        `Models endpoint request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Models endpoint request failed with HTTP ${response.status}: ${await readErrorSnippet(response)}`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new Error(
        `Models endpoint returned invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return { models: parseOpenAiModelsResponse(payload) };
  };
}

async function readErrorSnippet(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim();
    return body.length > MODELS_PROBE_ERROR_BODY_SNIPPET_LIMIT
      ? `${body.slice(0, MODELS_PROBE_ERROR_BODY_SNIPPET_LIMIT)}…`
      : body || "(empty body)";
  } catch {
    return "(body unavailable)";
  }
}

/** 从 Effective Config 提取探测连接事实；仅 OpenAI 兼容格式可探测。 */
export function resolveProviderModelsProbeConnection(
  config: ProviderConfigObject,
): ProviderModelsProbeConnection {
  const apiType = config.api?.type;
  if (apiType !== "openai-chat-completions" && apiType !== "openai-responses") {
    throw new Error(
      `Models probe only supports OpenAI-compatible providers, got: ${String(apiType)}`,
    );
  }
  const baseUrl = config.api?.baseUrl?.trim() ?? "";
  if (!baseUrl) {
    throw new Error("No endpoint configured");
  }
  return {
    baseUrl,
    ...(isApiKeyAccess(config.access) && config.access.apiKey
      ? { apiKey: config.access.apiKey }
      : {}),
  };
}
