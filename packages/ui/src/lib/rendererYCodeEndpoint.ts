import {
  buildRuntimeYCodeEndpointUrls,
  YCODE_ENV,
  type RuntimeYCodeEndpointEnv,
} from "@ycode/shared";

interface RendererImportMetaEnv {
  VITE_YCODE_BASE_URL?: string;
  VITE_YCODE_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererYCodeEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeYCodeEndpointEnv {
  return {
    YCODE_ENV,
    // UI 侧的 ycode-plan 占位 provider 以前只看 YCODE_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    YCODE_BASE_URL: env.VITE_YCODE_BASE_URL,
    YCODE_ENDPOINT_ORIGIN: env.VITE_YCODE_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_YCODE_ENDPOINT_URLS = buildRuntimeYCodeEndpointUrls(
  createRendererYCodeEndpointEnv(),
);
