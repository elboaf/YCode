import {
  buildRuntimeZCodeEndpointUrls,
  YCODE_ENV,
  type RuntimeZCodeEndpointEnv,
} from "@ycode/shared";

interface RendererImportMetaEnv {
  VITE_ZCODE_BASE_URL?: string;
  VITE_ZCODE_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererZCodeEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeZCodeEndpointEnv {
  return {
    YCODE_ENV,
    // UI 侧的 ycode-plan 占位 provider 以前只看 YCODE_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    YCODE_BASE_URL: env.VITE_ZCODE_BASE_URL,
    YCODE_ENDPOINT_ORIGIN: env.VITE_ZCODE_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_ZCODE_ENDPOINT_URLS = buildRuntimeZCodeEndpointUrls(
  createRendererZCodeEndpointEnv(),
);
