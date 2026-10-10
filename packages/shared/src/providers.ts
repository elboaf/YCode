import { z } from "zod";

/**
 * YCode agent 提供方的单一真源。
 *
 * 类型 ZCodeProvider、运行时 schema zcodeProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / ycode-protocol 等无环引用。
 */
const YCODE_PROVIDERS = ["glm"] as const;

export const zcodeProviderSchema = z.enum(YCODE_PROVIDERS);

export type ZCodeProvider = (typeof YCODE_PROVIDERS)[number];
