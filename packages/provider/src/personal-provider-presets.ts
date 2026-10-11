import { ApiKeyAccessConfig, ProviderApiConfig, ProviderConfig } from "./config/index.js";

/** 预设 ID 既是 UI 入口标识，也是 Provider ID 的种子；新增预设必须同步更新 spec。 */
export const LLAMA_CPP_PROVIDER_PRESET_ID = "llama-cpp";

/**
 * 预设由代码持有，不进 config/provider/ycode-builtin.json 模板目录：
 * 目录会被远端下发的高 revision 整体覆盖，本地常驻能力不允许被远端目录回收。
 * 只定义连接事实（api/access）；名称去重、providerId 播种由 createPersonalProvider 负责。
 */
const LLAMA_CPP_PROVIDER_PRESET = new ProviderConfig({
  access: new ApiKeyAccessConfig({ type: "api-key", apiKeyRequired: false }),
  api: new ProviderApiConfig({
    type: "openai-chat-completions",
    baseUrl: "http://127.0.0.1:8080/v1",
  }),
});

const PERSONAL_PROVIDER_PRESETS: ReadonlyMap<string, ProviderConfig> = new Map([
  [LLAMA_CPP_PROVIDER_PRESET_ID, LLAMA_CPP_PROVIDER_PRESET],
]);

export function resolvePersonalProviderPreset(presetId: string): ProviderConfig | undefined {
  return PERSONAL_PROVIDER_PRESETS.get(presetId);
}

export function resolvePersonalProviderPresetName(presetId: string): string | undefined {
  return presetId === LLAMA_CPP_PROVIDER_PRESET_ID ? "llama.cpp" : undefined;
}
