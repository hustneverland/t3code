// @effect-diagnostics-next-line nodeBuiltinImport:off -- HttpClient cannot switch the process-wide proxy that fetch and http(s) follow.
import * as NodeHttp from "node:http";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

import type * as Undici from "undici";

// undici is external to the CLI bundle; Node single-executables can load it from disk only with require.
const requireUndici = NodeModule.createRequire(import.meta.url);

/** Node 26 bundles h2-capable undici 8; Node 22/24 and Electron stay on HTTP/1.1 with 6/7. */
export const builtinFetchUsesHttp2 = (bundledUndiciVersion: string | undefined) =>
  Number.parseInt(bundledUndiciVersion ?? "", 10) >= 8;

/** Preserves the EnvHttpProxyAgent installed by --use-env-proxy / NODE_USE_ENV_PROXY. */
export function installHttp1FetchDispatcher(): void {
  const undici = requireUndici("undici") as typeof Undici;
  // Node's agent comes from its internal undici copy, so `instanceof` against the npm class is false.
  const usesEnvProxy = undici.getGlobalDispatcher().constructor.name === "EnvHttpProxyAgent";
  undici.setGlobalDispatcher(
    usesEnvProxy
      ? new undici.EnvHttpProxyAgent({
          allowH2: false,
          // ProxyAgent's connector forces h2 and ignores allowH2; replace it for HTTPS proxies.
          clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
        })
      : new undici.Agent({ allowH2: false }),
  );
}

/** Avoids uncaught idle-timeout errors on h2 streams (https://github.com/nodejs/undici/issues/5936). */
export function keepOutboundFetchOnHttp1(): void {
  if (builtinFetchUsesHttp2(process.versions.undici)) installHttp1FetchDispatcher();
}

// @types/node does not declare setTypeOfService yet.
type TypeOfServiceSocket = {
  setTypeOfService?: (this: NodeNet.Socket, typeOfService: number) => NodeNet.Socket;
};

// Bundled undici calls this from a socket callback without catching. On macOS,
// EINVAL after a peer reset must not exit the server over an optional QoS hint.
export function ignoreMacosTypeOfServiceEinval(
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Runs before ACP dispatch without loading the Effect graph.
  platform = process.platform,
  socketPrototype: TypeOfServiceSocket = NodeNet.Socket.prototype as TypeOfServiceSocket,
): void {
  if (platform !== "darwin") return;
  const setTypeOfService = socketPrototype.setTypeOfService;
  if (typeof setTypeOfService !== "function") return;
  socketPrototype.setTypeOfService = function (...args) {
    try {
      return setTypeOfService.apply(this, args);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EINVAL") return this;
      throw error;
    }
  };
}

/**
 * Node's 250 ms Happy Eyeballs attempt timeout abandons a working-but-slow IPv4
 * connect when IPv6 is advertised but unroutable, which broke the ACP registry
 * fetch. A larger `--network-family-autoselection-attempt-timeout` still wins.
 */
export function extendConnectionAttemptTimeout(): void {
  NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(
    Math.max(NodeNet.getDefaultAutoSelectFamilyAttemptTimeout(), 1_000),
  );
}

/** What Node's built-in proxy support reads; the names match `http.Agent`'s `proxyEnv`. */
export interface EnvProxy {
  readonly HTTP_PROXY?: string;
  readonly HTTPS_PROXY?: string;
  readonly NO_PROXY: string;
}

const LOOPBACK_NO_PROXY = ["localhost", "127.0.0.1", "::1"] as const;

// Node's built-in support speaks to HTTP and HTTPS proxies only; a SOCKS URL stays unused.
const usableProxyUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
};

/** The proxy the environment names, lowercase first as curl does, with loopback always direct. */
export function resolveEnvProxy(
  env: Readonly<Record<string, string | undefined>>,
): EnvProxy | undefined {
  const httpProxy = usableProxyUrl(env.http_proxy) ?? usableProxyUrl(env.HTTP_PROXY);
  const httpsProxy = usableProxyUrl(env.https_proxy) ?? usableProxyUrl(env.HTTPS_PROXY);
  if (!httpProxy && !httpsProxy) return undefined;
  const direct = (env.no_proxy ?? env.NO_PROXY ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return {
    ...(httpProxy ? { HTTP_PROXY: httpProxy } : {}),
    ...(httpsProxy ? { HTTPS_PROXY: httpsProxy } : {}),
    NO_PROXY: [...new Set([...direct, ...LOOPBACK_NO_PROXY])].join(","),
  };
}

// @types/node does not declare setGlobalProxyFromEnv yet; Node 22 and early 24 lack it.
type HttpWithGlobalProxy = {
  setGlobalProxyFromEnv?: (proxyEnv?: EnvProxy) => () => void;
};

export type EnvProxyOutcome = "unchanged" | "followed" | "cleared" | "unsupported";

/**
 * Node ignores HTTPS_PROXY unless it starts with NODE_USE_ENV_PROXY, and a desktop app's shell
 * variables arrive after the server has started. Call this at startup and again whenever the
 * environment changes; fetch and http(s) requests then follow the proxy it names.
 */
export function makeFollowEnvProxy(
  http: HttpWithGlobalProxy = NodeHttp as HttpWithGlobalProxy,
): (env: Readonly<Record<string, string | undefined>>) => EnvProxyOutcome {
  let followed: string | undefined;
  let restore: (() => void) | undefined;
  return (env) => {
    const proxy = resolveEnvProxy(env);
    const next = proxy ? JSON.stringify(proxy) : "";
    // Node set the proxy up itself when it started with the flag; leave that configuration alone.
    if (followed === undefined && env.NODE_USE_ENV_PROXY === "1") {
      followed = next;
      return "unchanged";
    }
    if (next === (followed ?? "")) {
      followed = next;
      return "unchanged";
    }
    if (typeof http.setGlobalProxyFromEnv !== "function") return "unsupported";
    followed = next;
    // Nothing of ours to undo: Node's own startup configuration cannot be withdrawn from here.
    if (!proxy && restore === undefined) return "unchanged";
    restore?.();
    restore = proxy ? http.setGlobalProxyFromEnv(proxy) : undefined;
    return proxy ? "followed" : "cleared";
  };
}

/** One per process: the global agent and fetch dispatcher it switches are process-wide. */
export const followEnvProxy = makeFollowEnvProxy();
