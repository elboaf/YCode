// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListycodeSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunycodeProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  YCodeApp,
  YCodeAppOptions,
  ycodeModelOption,
} from "./app/types.js";
export * from "./auth-login.js";
export {
  inspectycodeCustomCommand,
  listycodeCustomCommands,
  loadycodeCustomCommand,
} from "./custom-commands.js";
export type {
  InspectycodeCustomCommandOptions,
  ListycodeCustomCommandsOptions,
  ycodeCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addycodePluginMarketplace,
  getycodePluginsOverview,
  installycodeMarketplacePlugin,
  listycodePlugins,
  removeycodePluginMarketplace,
  resolveycodePlugins,
  setycodePluginEnabled,
  uninstallycodeMarketplacePlugin,
  updateycodeMarketplacePlugin,
  updateycodePluginMarketplace,
  validateycodePluginPath,
} from "./plugins.js";
export type {
  AddycodeMarketplaceOptions,
  InstallycodeMarketplacePluginOptions,
  ListycodePluginsOptions,
  RemoveycodeMarketplaceOptions,
  ResolveycodePluginsOptions,
  SetycodePluginEnabledOptions,
  SetycodePluginEnabledResult,
  UninstallycodeMarketplacePluginOptions,
  UpdateycodeMarketplaceOptions,
  UpdateycodeMarketplacePluginOptions,
  ValidateycodePluginPathOptions,
  ycodeAvailablePluginData,
  ycodeInstalledPluginData,
  ycodeMarketplaceSummaryData,
  ycodeMarketplaceUpdateData,
  ycodePluginInstallData,
  ycodePluginUpdateData,
  ycodePluginsOverviewData,
} from "./plugins.js";
export { runycodeProtocolAgent } from "./ycode-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./ycode-protocol/session-mapper.js";
export { prepareycodeTelemetryEnv, shutdownycodeTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listycodeSessions, resolveLatestSession } from "./sessions.js";
export { inspectycodeSkill, listycodeSkills } from "./skills.js";
export type {
  InspectycodeSkillOptions,
  ListycodeSkillsOptions,
  ycodeSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedycodeSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
