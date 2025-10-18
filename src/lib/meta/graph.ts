import { env } from "@/env";

const DEFAULT_GRAPH_VERSION = "v24.0";

export function getMetaGraphVersion(): string {
  const serverVersion = env.server.META_GRAPH_VERSION;
  if (serverVersion && serverVersion.length) {
    return serverVersion;
  }

  const clientVersion = env.client.NEXT_PUBLIC_META_GRAPH_VERSION;
  if (clientVersion && clientVersion.length) {
    return clientVersion;
  }

  return DEFAULT_GRAPH_VERSION;
}

export function getMetaGraphApiBase(): string {
  return `https://graph.facebook.com/${getMetaGraphVersion()}`;
}

export function getMetaOAuthBase(): string {
  return `https://www.facebook.com/${getMetaGraphVersion()}`;
}
