# Spec：llama.cpp 预设 Provider 与模型列表探测（Model Probe）

状态：已评审（2026-10-10）。范围：`packages/provider`、`packages/services`、`packages/ui` 的设置页。
本 spec 是后续行为变更的唯一变更依据；行为调整必须先改本文件。

## 背景

自定义（Personal）Provider 面向 OpenAI 兼容端点，但存在两个缺口：

1. **模型必须手工逐个录入**：系统从不请求端点的 `GET {baseUrl}/models`，用户无法知道服务器实际提供哪些模型 ID。
2. **API Key 强制非空**：Registry 准入要求 `access.apiKey` 非空（`completeApiKeyAccessDataSchema`）。llama.cpp 等本地服务器不校验鉴权，用户被迫填入假 Key，否则该 Provider 的模型永远不可选（`resolver.ts` 中 `providerExecutable` 因 `providerIssues` 恒为 false）。

历史依据：旧版 ycode CLI 配置已有 `options.apiKeyRequired === false` 语义（`legacy-cli-personal-provider-config-importer.ts` 目前将其识别为“不支持的免鉴权形态”而拒绝导入）。本 spec 把该语义纳入现代 Provider Config。

## 产品规则

### R1 llama.cpp 预设 Provider

- 设置页“添加供应商”流中提供 **llama.cpp** 卡片（与“自定义端点”并列，位于非智谱分组）。点击后调用
  `createPersonalProvider({ presetId: "llama-cpp", locale })`。
- 预设由 **代码持有**（`packages/provider/src/config/personal-provider-presets.ts`），不进入
  `config/provider/ycode-builtin.json` 模板目录：模板目录会被远端下发的高 revision 整体覆盖
  （`NodeYCodeBuiltinProviderConfigSource.selectReleaseCandidate` 取 revision 更高者），
  本地常驻能力不允许被远端目录回收。
- 预设内容：`access = { type: "api-key", apiKeyRequired: false }`；
  `api = { type: "openai-chat-completions", baseUrl: "http://127.0.0.1:8080/v1" }`
  （llama-server 默认端口；用户可在卡片内修改）。
- 预设只影响新实例的初始值；创建后即属 Personal 层，用户编辑不再回写预设。

### R2 可选 API Key（`apiKeyRequired: false`）

- `ApiKeyAccessConfig` 新增可选字段 `apiKeyRequired?: boolean`，默认视为 `true`（未声明即保持现状）。
- **完整校验规则**：`apiKeyRequired !== false` 时 `apiKey` 必须非空（维持现状）；
  `apiKeyRequired === false` 时 `apiKey` 可以为空/缺失。
- 运行时请求侧不变：key 缺失时 `toAiSdkProviderConfig` 不注入 `Authorization`（现状已如此）。
- UI：`apiKeyRequired === false` 时 API Key 输入框展示“可选”提示；用户仍可填写
  （覆盖 llama-server `--api-key`、llama-swap 鉴权等场景），填写后按普通 Key 发送。
- 只有 llama.cpp 预设会产出 `apiKeyRequired: false` 的实例；通用自定义端点暂不提供开关（后续可扩展）。

### R3 模型列表探测（Model Probe）

- 入口：模型区标题行、“添加模型”旁的 **获取模型** 按钮。
- **可见性**：Provider 的 API 格式为 `openai-chat-completions` 或 `openai-responses` 时显示
  （Anthropic Messages 端点的模型列表协议与鉴权头不同，v1 不支持）。
- **顺序约束**：点击后必须先提交卡片未保存草稿（`commitPendingDraft`，与“测试连接”一致），
  Host 始终以 **已落盘** 的 `api.baseUrl` / `access.apiKey` 探测；不接受 Renderer 自报连接事实。
- **请求**：`GET {baseUrl}/models`（baseUrl 去尾斜杠后拼接；baseUrl 已含 `/v1`）。
  有 Key 时带 `Authorization: Bearer <key>`；无 Key 时不带任何鉴权头。
  超时 10s；使用 Host 的 `hostApiNetworkTransport.fetch`（继承用户代理与自定义 CA）。
- **响应解析**：接受 `{ data: [{ id }, ...] }` 或裸数组 `[{ id }, ...]`；`id` 取字符串、去空、去重、
  保持服务端顺序。空列表视为有效结果（UI 提示“服务器未返回模型”）。
- **失败语义**：网络不可达、非 2xx、JSON 解析失败都以错误反馈呈现（含简短原因），不改任何配置状态。
  探测是 **无状态读操作**：不写 Provider 配置，不进入 Registry，不产生持久化副作用。
- **导入**：探测结果在对话框中勾选导入；已存在于该 Provider 的模型 ID 禁用勾选。
  导入 = 逐个 `addPersonalModel(providerId, modelId, {}, useRecommendedConfig: true)`
  （智能配置规则，`enabled` 默认 true）。导入按顺序串行执行；单个失败立即中止并反馈，
  已成功的保留（幂等边界：重复 ID 在服务端被拒绝，UI 预先过滤已存在 ID）。
- 远程 workspace：`IProviderSettingsService` 按目标 Environment 解析（与其他 Provider 设置操作一致），
  探测发往该 Environment 所在网络。

## 状态所有者

| 状态                                         | 唯一所有者                                      | 其他层如何访问                                                              |
| -------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Provider 连接配置（baseUrl/apiType/access）  | `ProviderConfigService` Personal 层（落盘仓库） | Renderer 经 `IProviderSettingsService` 读写；Host 探测时经 facade View 读取 |
| 已启用模型（personalModelIds + model rules） | `ProviderConfigService` Personal 层             | 同上                                                                        |
| 探测结果（一次请求返回的模型 ID 列表）       | 无持久化所有者；仅存活于当次 UI 对话框状态      | 不广播、不落盘                                                              |
| 服务器实际模型清单                           | llama.cpp/llama-swap 服务器                     | 唯一读取途径是探测请求                                                      |

## 接口契约

- `CreatePersonalProviderInput.presetId?: string`（当前仅 `"llama-cpp"`；未知值抛错）。
- `ApiKeyAccessConfig.apiKeyRequired?: boolean`（序列化进 config 仓库；模板 schema 经
  `apiKeyAccessDataSchema.omit({apiKey:true})` 自动获得该字段，但内置模板暂不使用）。
- `IProviderSettingsService.probeProviderModels(input: { providerId }): Promise<{ models: readonly string[] }>`。
  错误以 `Error` 抛出（消息含原因），复用现有反馈通道展示。

## 验收场景

1. llama.cpp 预设创建后 **不填 Key、不改 baseUrl**：Provider 进入 Registry，`GET http://127.0.0.1:8080/v1/models`
   探测成功，勾选导入的模型出现在 composer 模型列表并可直接对话。
2. llama-server 以 `--api-key` 启动：在预设实例中填入 Key 保存后，探测与对话请求均携带
   `Authorization: Bearer <key>`。
3. 普通 `api-key` Provider（未声明 `apiKeyRequired: false`）不填 Key：维持现状 —— 不入 Registry、模型不可选。
4. 探测目标不可达 / 返回 401 / 返回非 JSON：按钮反馈失败原因，Provider 配置与模型列表无变化。
5. 对已导入的模型再次探测：该 ID 在对话框中禁用；导入按钮数量不含重复项。
6. API 格式为 `anthropic-messages` 的自定义 Provider：不显示“获取模型”按钮。
7. `openai-responses` 自定义 Provider：显示按钮，探测与导入行为与 chat-completions 一致。

## 显式不做（后续项）

- llama.cpp 专属 logo 素材（v1 使用通用 Package 图标）。
- 通用自定义端点的“免鉴权”开关。
- 重新启用旧配置导入器的 `apiKeyRequired === false` 路径。
- Anthropic 格式端点的模型探测。
