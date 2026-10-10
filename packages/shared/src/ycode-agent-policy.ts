import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { ZCodeProvider } from "./ycode-task-types-core.js";

export const YCODE_AGENT_PROVIDER = "glm" satisfies ZCodeProvider;
export const YCODE_AGENT_PROVIDER_LABEL = "YCode Agent";
export const YCODE_COMMAND_AGENT_SOURCE = "zcodeAgent" satisfies CommandAgentSource;

export const zcodeAgentProviderSchema = z.literal(YCODE_AGENT_PROVIDER);

export const YCODE_COMMAND_AGENT_SOURCES = [
  YCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToZCodeAgent(
  _provider?: ZCodeProvider | null,
): ZCodeProvider {
  return YCODE_AGENT_PROVIDER;
}

export function isZCodeAgentProvider(
  provider: ZCodeProvider | null | undefined,
): provider is typeof YCODE_AGENT_PROVIDER {
  return provider === YCODE_AGENT_PROVIDER;
}
