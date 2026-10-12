# Spec：模型请求 Prefill 安全超时与重试字节稳定性

状态：已评审（2026-10-12）。范围：`apps/ycode-cli/packages/adapters` 的 model 与 network 层。
本 spec 是后续行为变更的唯一变更依据；行为调整必须先改本文件。

## 背景

自托管 OpenAI 兼容端点（llama.cpp / llama-swap，见 `llama-cpp-preset-and-model-probe.md`）的
prompt prefill 速度可能只有 ~40 tok/s（CPU-expert MoE）。32k prompt 的 prefill 约 13.5 分钟，
期间服务器 **不返回任何 HTTP header、任何 body 字节、任何 SSE 事件**，这是正常行为而非挂起。

2026-10-11/12 事故（`http://192.168.1.170:8080/v1`，providerId `llama-cpp`）中 ycode 日志显示：

1. **非流式 `generateText`（`project_memory_extract`）**：每次尝试固定在 ~307.7s 失败，reason
   `timeout`。该路径直连（无代理）时走 `globalThis.fetch`（undici），其默认
   `headersTimeout`/`bodyTimeout` 为 300s，慢 prefill 必然触发。
2. **流式 `main_turn`**：两种死法 —— 服务器立即回 header 但 prefill 期间无 SSE 事件时，
   在 600,011ms 处死于 `stream_idle_timeout`（`DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS`）；
   服务器把 header 保留到首个 token 时，undici `headersTimeout` 在 ~307.5s 先行触发。
3. 两种失败都被 `failure-classifier` 判为 retryable，按 `retry-policy` 退避重试；同时一个查询
   与另一查询（memory extract / main turn）在单个 llama slot 上交替换入，互相驱逐对方已
   prefill 的缓存（`n_prompt_tokens_cache` 恒为 8192，即仅静态系统头部命中），每个周期都
   从头重新 prefill —— 自我放大，永不收敛。

已确认事实（用于限定本 spec 范围）：

- 模型请求链路是
  `optionFetch → createProviderBusinessErrorFetch → createOfficialCodingPlanGatewayFetch →
createNetworkProxyFetch → globalThis.fetch | fetchWithAgent`，
  **不经过** `http/index.ts` 的 `NodeHttpClientAdapter`（其 `DEFAULT_TIMEOUT_MS = 180_000`
  只服务 webfetch / 插件 / 探测等短请求，与本问题无关）。
- 重试的 prompt 已是字节稳定的：`runGenerateText` / `runStreamText` 的
  `requestMessages` 在 attempt 间不变，唯一例外是 Anthropic 签名修复（等长替换，
  anthropic-only）。事故中的缓存驱逐来自 **两个不同查询交替占用同一 slot**，不是重试改写
  prompt。禁止在重试间给 prompt 附加错误文本 / 部分输出（现状无此行为，本 spec 将其定为
  不变量防止回归）。
- AI SDK 调用固定 `maxRetries: 0`，重试完全由 adapter 拥有。

## 产品规则

### R1 模型传输脱离 undici 默认超时

- `createNetworkProxyFetch` 新增选项 `alwaysUseAgentTransport?: boolean`。为 true 且 **未注入**
  自定义 `fetch` 时，即使无代理、无自定义 CA，也一律走 `fetchWithAgent`（node:http(s) 请求），
  不再使用 undici `globalThis.fetch`（其 300s 默认超时不可按请求覆盖）。
- 仅模型传输链路（`createProviderTransportFetch`）开启该选项；MCP HTTP transport 等
  其他共用方保持现状。
- 注入自定义 `fetch`（测试、宿主注入）时该选项不生效：注入方自带超时语义，不得被改道。
- 无代理/无 CA 的新路径复用模块级 keep-alive `http.Agent`/`https.Agent` 单例，避免每次
  请求新建连接池。
- 连接失败没有独立的应用层计时，依赖 OS TCP 语义（通常 ~20s 内报错）；这属于
  `network_error`，由现有重试策略处理。

### R2 模型请求总超时上限

- 模型传输链路最外层新增 `createModelRequestTimeoutFetch`：用 AbortController 包住
  整个请求（含 gateway/proxy hop、header 等待与响应体消费），到点以
  `ModelRequestTimeoutError`（`code = "MODEL_REQUEST_TIMEOUT"`）中止。
- 默认 3,600,000ms（1h，覆盖 128k prompt @ 40 tok/s 的 ~55min 最坏 prefill + 余量）；
  环境变量 `YCODE_MODEL_REQUEST_TIMEOUT_MS` 可覆盖；≤0 视为禁用。
- 计时器在 **响应体流结束 / 出错 / 被取消** 时清除（响应体被包装探测结束事件），因此：
  非流式响应哪怕 header 早到、body 迟到也被覆盖；流式响应的总时长同样受此上限约束
  （单条模型回复超过上限属病态，可通过 env 关闭上限后依赖 idle 机制）。
- 外部 abort signal（用户 Stop）以原 reason 直通，不得被改成 Timeout；计时器触发的
  中止不得表现为 Cancelled。
- `failure-inspection.isTimeoutFailure` 识别 `MODEL_REQUEST_TIMEOUT` code 与
  `ModelRequestTimeoutError` name，保持 retryable Timeout 分类（与 undici
  `UND_ERR_HEADERS_TIMEOUT` 同路）。

### R3 流式首事件超时（prefill 容忍）

- 流式 attempt 的首个 provider 事件到达前，读超时使用 **首事件超时** 而非 idle timeout：
  默认 3,600,000ms；环境变量 `YCODE_MODEL_FIRST_EVENT_TIMEOUT_MS` 可覆盖；≤0 禁用。
- 首个 provider 事件到达后回退现有语义：`streamIdleTimeoutMs`（默认 600s，每次重试 +30s，
  由 `resolveModelStreamIdleTimeoutMs` 与 `modelStream.idleTimeoutMs` 配置负责，均不变）。
- 首事件超时不随重试递增：prompt 字节稳定时 prefill 时长不因重试变化。
- 非流式 `generateText` 无事件概念，由 R2 总上限兜底，不引入额外计时器。

### R4 重试字节稳定不变量

- 同一 query 的各 attempt 必须复用同一份 `messages`（现状）；不得在重试间追加错误说明、
  部分输出或重渲染历史。
- 允许的唯一改写仍是 Anthropic 签名修复（`repairReasoningHistoryAfterSignatureRejection`，
  等长替换、不占重试预算、一次性的现状）。
- 头部（system/tools）共享前缀的跨查询缓存友好性由 core 的上下文装配负责，不在本 spec
  范围内展开。

## 状态所有者

| 状态             | 唯一所有者                                                             | 其他层如何访问                                         |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| 总超时上限值     | `AiSdkModelExecution`（构造时从 options/env 解析一次，冻结在 binding） | 经 `AiSdkNetworkConfig.requestTimeoutMs` 注入          |
| 首事件超时值     | `AiSdkModelAdapter`（构造时解析，传入 `runStreamText`）                | 经 `AiSdkModelAdapterOptions.firstEventTimeoutMs` 注入 |
| attempt 级 abort | runner 的 `attemptAbortController`（现状不变）                         | transport 包装层只做信号合并，不另设状态               |
| 重试预算与退避   | `retry-policy` / `retry-budget`（现状不变）                            | —                                                      |

## 接口契约

- `AiSdkNetworkConfig.requestTimeoutMs?: number`；`AiSdkModelAdapterOptions.firstEventTimeoutMs?: number`。
  显式注入优先于 env，env 优先于默认值。
- 环境变量：`YCODE_MODEL_REQUEST_TIMEOUT_MS`、`YCODE_MODEL_FIRST_EVENT_TIMEOUT_MS`
  （非有限数字或 ≤0 → 禁用/默认的语义见 R2/R3；解析失败回退默认）。
- `ModelRequestTimeoutError`：`name = "ModelRequestTimeoutError"`、
  `code = "MODEL_REQUEST_TIMEOUT"`、message 含总时长。分类为
  `ModelErrorCode.ModelRequestTimeout` + `ModelFailureReason.Timeout`，retryable。
- 新纯函数：`resolveModelRequestTimeoutMs`、`resolveModelFirstEventTimeoutMs`、
  `resolveStreamReadTimeoutMs`（均为 (options, env) → number 或纯查表，便于单测）。

## 验收场景

1. 模型端点 10 分钟后才返回 header（慢 prefill）：非流式与流式请求都不在 ~300s/600s 被
   中止；首 token 正常到达（流式首事件超时生效，idle 退居其后的现状不变）。
2. 端点永不响应：总上限（默认 1h，测试用毫秒级值）到点抛 `ModelRequestTimeoutError`，
   分类为 retryable timeout，进入现有退避重试；不表现为 Cancelled。
3. 用户在长 prefill 中点 Stop：请求立即中止，分类仍为 Cancelled，不触发重试。
4. 注入自定义 `fetch` 的既有测试/宿主：不受 `alwaysUseAgentTransport` 影响，仍走注入实现。
5. `YCODE_MODEL_REQUEST_TIMEOUT_MS=0`：总上限禁用，流式 stalled 仍由 idle 机制兜底。
6. 同一 query 重试 N 次：AI SDK 请求体逐字节一致（`messages` 不变；现状回归保护）。

## 显式不做（后续项）

- Provider 级（per-provider）超时配置字段与设置页 UI —— 默认值已覆盖 LAN llama.cpp；
  需要时先扩展本 spec 再动 `ProviderConfig` schema。
- UI 展示 prompt token 数与 prefill 耗时。
- llama.cpp 侧 slot/缓存防抖（服务器侧行为）。
- 非流式 `generateText` 的分段（连接/首字节）精细计时。
