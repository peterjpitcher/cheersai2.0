export interface MetaGraphErrorDetails {
  status: number | null;
  phase: string | null;
  message: string;
  type: string | null;
  code: number | null;
  subcode: number | null;
  fbtrace_id: string | null;
  raw: unknown;
}

export class MetaGraphApiError extends Error {
  readonly graph: MetaGraphErrorDetails;

  constructor(status: number | null, payload: unknown, phase: string, fallbackMessage = "Meta Graph API request failed") {
    const graph = parseMetaGraphError(status, payload, phase, fallbackMessage);
    super(formatMetaGraphError(graph));
    this.name = "MetaGraphApiError";
    this.graph = graph;
  }
}

export function parseMetaGraphError(
  status: number | null,
  payload: unknown,
  phase: string | null,
  fallbackMessage = "Meta Graph API request failed",
): MetaGraphErrorDetails {
  const error = readObject(readObject(payload)?.error);
  const message = readString(error?.message) ?? readString(payload) ?? fallbackMessage;

  return {
    status,
    phase,
    message,
    type: readString(error?.type),
    code: readNumber(error?.code),
    subcode: readNumber(error?.error_subcode),
    fbtrace_id: readString(error?.fbtrace_id),
    raw: payload,
  };
}

export function getMetaGraphErrorDetails(error: unknown): MetaGraphErrorDetails | null {
  if (error instanceof MetaGraphApiError) {
    return error.graph;
  }

  if (error && typeof error === "object" && "graph" in error) {
    const graph = (error as { graph?: unknown }).graph;
    if (isMetaGraphErrorDetails(graph)) {
      return graph;
    }
  }

  return null;
}

export function compactMetaGraphError(graph: MetaGraphErrorDetails | null | undefined) {
  if (!graph) return null;
  return {
    status: graph.status,
    phase: graph.phase,
    type: graph.type,
    code: graph.code,
    subcode: graph.subcode,
    fbtrace_id: graph.fbtrace_id,
  };
}

export function isExplicitMetaConnectionFailure(graph: MetaGraphErrorDetails | null | undefined): boolean {
  if (!graph) return false;

  if (graph.status === 401 || graph.status === 403) {
    return true;
  }

  if (graph.code === 190 || graph.subcode === 190 || graph.subcode === 463 || graph.subcode === 467) {
    return true;
  }

  if (graph.code === 10 || graph.code === 200) {
    return true;
  }

  const message = graph.message.toLowerCase();
  return (
    /permission(?:s)? (?:missing|denied|required|error)/i.test(message) ||
    /does not have (?:the )?permission/i.test(message) ||
    /requires .*permission/i.test(message) ||
    /not authorized to (?:perform|access|publish)/i.test(message)
  );
}

export function isAmbiguousMetaAuthorizationFailure(graph: MetaGraphErrorDetails | null | undefined, message: string): boolean {
  if (!graph) {
    return /authori[sz]ation|authenticat|permission/i.test(message);
  }

  if (isExplicitMetaConnectionFailure(graph)) {
    return false;
  }

  if (graph.code === 100 && /authori[sz]ation|permission/i.test(graph.message)) {
    return true;
  }

  return /authori[sz]ation|authenticat|permission/i.test(message);
}

export function isRetryableMetaGraphFailure(graph: MetaGraphErrorDetails | null | undefined): boolean {
  if (!graph) return false;
  if (isExplicitMetaConnectionFailure(graph)) return false;
  if (graph.status !== null && graph.status >= 500) return true;
  if (graph.code === 1 || graph.code === 2 || graph.code === 4 || graph.code === 17 || graph.code === 613) return true;
  return graph.code === 100 && /authori[sz]ation/i.test(graph.message);
}

function formatMetaGraphError(graph: MetaGraphErrorDetails): string {
  const phase = graph.phase ? `[${graph.phase}] ` : "";
  const status = graph.status !== null ? `status=${graph.status} ` : "";
  const type = graph.type ? `${graph.type}: ` : "";
  const codeParts = [
    graph.code !== null ? `code ${graph.code}` : null,
    graph.subcode !== null ? `subcode ${graph.subcode}` : null,
  ].filter(Boolean);
  const code = codeParts.length ? ` (${codeParts.join(", ")})` : "";
  const trace = graph.fbtrace_id ? ` trace=${graph.fbtrace_id}` : "";

  return `${phase}${status}${type}${graph.message}${code}${trace}`.trim();
}

function isMetaGraphErrorDetails(value: unknown): value is MetaGraphErrorDetails {
  const record = readObject(value);
  return Boolean(record && typeof record.message === "string" && "status" in record);
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
