import type { ToolPolicy } from "@workrr/contracts";
import { applyDlp, DlpBlockedError } from "./dlp";
import { getMicrosoftAccessToken } from "./oauth";
import type { Env } from "./types";

export const boundAdapterCatalog = {
  "microsoft.profile.get": {
    label: "Microsoft · My profile",
    adapterKind: "microsoft",
    scope: "User.Read",
    inputSchema: { type: "object", additionalProperties: false }
  },
  "microsoft.mail.list": {
    label: "Microsoft · Recent mail metadata",
    adapterKind: "microsoft",
    scope: "Mail.ReadBasic",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 10 } }
    }
  },
  "microsoft.calendar.list": {
    label: "Microsoft · Upcoming calendar metadata",
    adapterKind: "microsoft",
    scope: "Calendars.ReadBasic",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 10 } }
    }
  }
} as const;

export type BoundAdapterKey = keyof typeof boundAdapterCatalog;

export function listBoundAdapters() {
  return Object.entries(boundAdapterCatalog).map(([key, definition]) => ({ key, ...definition }));
}

export function isBoundAdapter(key: string | null | undefined): key is BoundAdapterKey {
  return Boolean(key && key in boundAdapterCatalog);
}

export async function invokeBoundAdapter(env: Env, tenantId: string, executionId: string,
  policy: ToolPolicy, input: unknown, fetcher: typeof fetch = fetch) {
  if (!isBoundAdapter(policy.handlerKey) || policy.adapterKind !== "microsoft") {
    throw new Error("No registered adapter implementation matches this tool");
  }
  if (!policy.connectionId || !policy.connectionReady) throw new Error("Tool connection is not ready");
  if (policy.accessMode !== "read" || policy.riskLevel !== "low") {
    throw new Error("Bound execution is limited to low-risk read tools");
  }
  const adapter = boundAdapterCatalog[policy.handlerKey];
  const token = await getMicrosoftAccessToken(env, tenantId, adapter.scope, fetcher, policy.connectionId);
  const endpoint = graphEndpoint(policy.handlerKey, input);
  const started = performance.now();
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        accept: "application/json",
        "user-agent": "Workrr-One-Tool/1.0"
      }
    });
  } catch (error) {
    await recordGraphLog(env, tenantId, executionId, endpoint, 0, started);
    throw error;
  }
  await recordGraphLog(env, tenantId, executionId, endpoint, response.status, started);
  if (!response.ok) throw new Error(`Microsoft Graph returned HTTP ${response.status}`);
  const raw = await readBoundedJson(response, 64 * 1024);
  const serialized = JSON.stringify(raw);
  const protectedOutput = await applyDlp(env, tenantId, serialized, {
    direction: "output", stage: "tool_result", executionId
  });
  if (protectedOutput.blocked) throw new DlpBlockedError(protectedOutput.blockedDetectors);
  const base = {
    status: "completed",
    adapter: policy.handlerKey,
    connectionId: token.connectionId
  };
  return {
    modelOutput: { ...base, data: parseProtectedJson(protectedOutput.modelText) },
    evidenceOutput: { ...base, data: parseProtectedJson(protectedOutput.safeText) }
  };
}

function graphEndpoint(key: BoundAdapterKey, input: unknown) {
  if (key === "microsoft.profile.get") {
    return "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";
  }
  const limit = boundedLimit(input);
  if (key === "microsoft.mail.list") {
    return `https://graph.microsoft.com/v1.0/me/messages?$select=id,subject,receivedDateTime,from,isRead&$top=${limit}&$orderby=receivedDateTime%20desc`;
  }
  const now = encodeURIComponent(new Date().toISOString());
  return `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${now}&endDateTime=${encodeURIComponent(
    new Date(Date.now() + 7 * 86_400_000).toISOString()
  )}&$select=id,subject,start,end,location,isCancelled&$top=${limit}&$orderby=start/dateTime`;
}

function boundedLimit(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return 5;
  const value = Number((input as Record<string, unknown>).limit ?? 5);
  return Number.isInteger(value) ? Math.max(1, Math.min(10, value)) : 5;
}

async function readBoundedJson(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Tool response exceeded the 64 KB limit");
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Tool response exceeded the 64 KB limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error("Tool response was not valid JSON"); }
}

function parseProtectedJson(value: string) {
  try { return JSON.parse(value) as unknown; }
  catch { return { redactedText: value }; }
}

async function recordGraphLog(env: Env, tenantId: string, executionId: string, endpoint: string,
  status: number, started: number) {
  const url = new URL(endpoint);
  await env.DB.prepare(`INSERT INTO api_logs
    (id, tenant_id, actor_id, trace_id, direction, method, path, status, duration_ms, target)
    VALUES (?, ?, 'system', ?, 'outbound', 'GET', ?, ?, ?, 'https://graph.microsoft.com')`)
    .bind(crypto.randomUUID(), tenantId, executionId, url.pathname, status,
      Math.round(performance.now() - started)).run();
}
