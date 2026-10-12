import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { ProxyAgent } from "proxy-agent";
import {
  loadTlsCaCertificates,
  resolveProxyUrlForRequest,
  resolveTlsCaCertFile,
} from "./http-config.js";

type NetworkFetch = typeof globalThis.fetch;

interface NetworkProxyFetchOptions {
  caCertFile?: string;
  env?: Record<string, string | undefined>;
  fetch?: NetworkFetch;
  httpProxy?: string;
  noProxy?: string;
  /**
   * 强制走 node:http(s) agent 传输（仅当未注入自定义 fetch 时生效）。
   *
   * 原因：直连时 undici global fetch 的 headersTimeout/bodyTimeout 默认 300s，
   * 自托管慢 prefill（如 llama.cpp CPU MoE，32k prompt ≈ 13.5min 无任何字节）
   * 必然被中止；node http 请求无默认超时，由上层模型请求总上限接管。
   * 依据 docs/specs/model-provider/model-request-prefill-safe-timeouts.md R1。
   */
  alwaysUseAgentTransport?: boolean;
}

interface NormalizedFetchRequest {
  body?: Buffer;
  headers: Headers;
  method: string;
  signal?: AbortSignal | null;
  url: URL;
}

export function createNetworkProxyFetch(options: NetworkProxyFetchOptions): NetworkFetch {
  const directFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  // 注入自定义 fetch（测试、宿主）时不改道：注入方自带超时语义。
  const forceAgentTransport =
    options.alwaysUseAgentTransport === true && options.fetch === undefined;
  if (!forceAgentTransport && !hasNetworkFetchPolicy(options)) {
    return directFetch;
  }

  let tlsCaCertificates: Buffer | undefined;
  let tlsCaCertificatesLoaded = false;

  const getTlsCaCertificates = (): Buffer | undefined => {
    if (!tlsCaCertificatesLoaded) {
      tlsCaCertificates = loadTlsCaCertificates(options);
      tlsCaCertificatesLoaded = true;
    }
    return tlsCaCertificates;
  };

  return async (input, init) => {
    const requestUrl = readFetchInputUrl(input);
    if (!requestUrl || (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:")) {
      return directFetch(input, init);
    }

    const proxyUrl = resolveProxyUrlForRequest(requestUrl, options);
    const caCertFile = resolveTlsCaCertFile(options);
    if (!proxyUrl && !caCertFile && !forceAgentTransport) {
      return directFetch(input, init);
    }

    const request = await normalizeFetchRequest(input, init);
    return fetchWithAgent(request, {
      ca: caCertFile ? getTlsCaCertificates() : undefined,
      proxyUrl,
    });
  };
}

function hasNetworkFetchPolicy(options: NetworkProxyFetchOptions): boolean {
  return Boolean(options.caCertFile || options.env || options.httpProxy || options.noProxy);
}

function readFetchInputUrl(input: Parameters<NetworkFetch>[0]): URL | undefined {
  try {
    if (input instanceof URL) {
      return input;
    }
    if (input instanceof Request) {
      return new URL(input.url);
    }
    return new URL(String(input));
  } catch {
    return undefined;
  }
}

async function normalizeFetchRequest(
  input: Parameters<NetworkFetch>[0],
  init: Parameters<NetworkFetch>[1],
): Promise<NormalizedFetchRequest> {
  const request = new Request(input, init);
  const method = request.method.toUpperCase();
  const arrayBuffer =
    method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const body = arrayBuffer && arrayBuffer.byteLength > 0 ? Buffer.from(arrayBuffer) : undefined;

  return {
    body,
    headers: request.headers,
    method,
    signal: request.signal,
    url: new URL(request.url),
  };
}

function fetchWithAgent(
  request: NormalizedFetchRequest,
  options: { ca?: Buffer; proxyUrl?: string },
): Promise<Response> {
  const transport = request.url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const signal = request.signal ?? undefined;
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    let settled = false;
    let responseMessage: http.IncomingMessage | undefined;
    let clientRequest: http.ClientRequest | undefined;

    const cleanupAll = (): void => {
      signal?.removeEventListener("abort", onAbort);
      clientRequest?.off("error", onRequestError);
      clientRequest?.off("close", onRequestClose);
      responseMessage?.off("close", cleanupAll);
      responseMessage?.off("error", onResponseError);
    };
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanupAll();
      reject(error);
    };
    const onRequestError = (error: Error): void => {
      rejectOnce(error);
    };
    const onRequestClose = (): void => {
      if (!responseMessage && settled) cleanupAll();
    };
    const onResponseError = (): void => {
      // The web Response body receives the stream error through Readable.toWeb;
      // this listener only prevents Node from treating abort destroy as unhandled.
    };
    const onAbort = (): void => {
      const error = abortReason(signal);
      responseMessage?.destroy(error);
      clientRequest?.destroy(error);
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    clientRequest = transport.request(
      {
        agent: createRequestAgent(request.url, options),
        headers: headersToOutgoing(request.headers),
        hostname: request.url.hostname,
        method: request.method,
        path: `${request.url.pathname}${request.url.search}`,
        port: request.url.port || undefined,
        protocol: request.url.protocol,
      },
      (message) => {
        responseMessage = message;
        responseMessage.once("close", cleanupAll);
        responseMessage.once("error", onResponseError);
        const headers = new Headers();
        for (const [name, value] of Object.entries(message.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              headers.append(name, item);
            }
          } else if (value !== undefined) {
            headers.append(name, String(value));
          }
        }

        settled = true;
        resolve(
          new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, {
            headers,
            status: message.statusCode ?? 502,
            statusText: message.statusMessage,
          }),
        );
      },
    );

    clientRequest.once("error", onRequestError);
    clientRequest.once("close", onRequestClose);
    clientRequest.end(request.body);
  });
}

function abortReason(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

// 无代理/无自定义 CA 的 agent 传输复用 keep-alive 连接池；
// new http.Agent() 默认 keepAlive=false，逐请求新建会让每个模型请求都重建 TCP。
let sharedPlainHttpAgent: http.Agent | undefined;
let sharedPlainHttpsAgent: https.Agent | undefined;

function plainKeepAliveAgent(secure: boolean): http.Agent | https.Agent {
  if (secure) {
    sharedPlainHttpsAgent ??= new https.Agent({ keepAlive: true });
    return sharedPlainHttpsAgent;
  }
  sharedPlainHttpAgent ??= new http.Agent({ keepAlive: true });
  return sharedPlainHttpAgent;
}

function createRequestAgent(
  url: URL,
  options: { ca?: Buffer; proxyUrl?: string },
): http.Agent | https.Agent | ProxyAgent {
  if (options.proxyUrl) {
    return new ProxyAgent({
      ca: options.ca,
      getProxyForUrl: () => options.proxyUrl ?? "",
      httpsAgent: options.ca ? new https.Agent({ ca: options.ca }) : undefined,
    }) as unknown as http.Agent;
  }

  if (url.protocol === "https:") {
    return options.ca ? new https.Agent({ ca: options.ca }) : plainKeepAliveAgent(true);
  }
  return plainKeepAliveAgent(false);
}

function headersToOutgoing(headers: Headers): http.OutgoingHttpHeaders {
  const outgoing: http.OutgoingHttpHeaders = {};
  headers.forEach((value, key) => {
    outgoing[key] = value;
  });
  return outgoing;
}
