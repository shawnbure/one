import type { Env } from "./types";
import { getMicrosoftAccessToken } from "./oauth";

const definitions = {
  profile: {
    label: "Connected account profile",
    scope: "User.Read",
    endpoint: "https://graph.microsoft.com/v1.0/me?$select=id",
  },
  mail: {
    label: "Recent mail metadata",
    scope: "Mail.ReadBasic",
    endpoint: "https://graph.microsoft.com/v1.0/me/messages?$select=id&$top=1",
  },
  calendar: {
    label: "Upcoming calendar metadata",
    scope: "Calendars.ReadBasic",
    endpoint: "https://graph.microsoft.com/v1.0/me/events?$select=id&$top=1",
  },
} as const;

type Capability = keyof typeof definitions;
type TokenProvider = typeof getMicrosoftAccessToken;

export async function getProviderAcceptance(env: Env, tenantId: string) {
  const [connection, latest] = await Promise.all([
    env.DB.prepare(`SELECT c.id, c.status, c.secret_configured, o.account_email, o.account_name, o.scopes_json
      FROM connections c LEFT JOIN oauth_connections o ON o.connection_id=c.id AND o.tenant_id=c.tenant_id
        AND o.provider='microsoft' AND o.status!='disconnected'
      WHERE c.tenant_id=? AND c.name='Microsoft 365'`).bind(tenantId).first<Record<string, unknown>>(),
    env.DB.prepare(`SELECT id, connection_id, status, requested_json, results_json, started_by,
      started_at, completed_at FROM provider_acceptance_runs
      WHERE tenant_id=? AND provider='microsoft' ORDER BY datetime(completed_at) DESC LIMIT 1`)
      .bind(tenantId).first<Record<string, unknown>>(),
  ]);
  return {
    provider: "microsoft",
    connected: Boolean(connection && Number(connection.secret_configured) === 1),
    connection: connection ? {
      id: String(connection.id),
      status: String(connection.status),
      account: connection.account_email ?? connection.account_name ?? null,
      scopes: safeArray(connection.scopes_json),
    } : null,
    latest: latest ? {
      id: String(latest.id),
      status: String(latest.status),
      requested: safeArray(latest.requested_json),
      results: safeResults(latest.results_json),
      startedBy: String(latest.started_by),
      startedAt: String(latest.started_at),
      completedAt: String(latest.completed_at),
    } : null,
  };
}

export async function runMicrosoftAcceptance(
  env: Env,
  tenantId: string,
  actorId: string,
  requested: string[],
  fetcher: typeof fetch = fetch,
  tokenProvider: TokenProvider = getMicrosoftAccessToken,
) {
  if (!Array.isArray(requested) || requested.some((item) => !["mail", "calendar"].includes(item))) {
    throw new Error("Provider acceptance supports only mail and calendar read capabilities");
  }
  const capabilities = ["profile", ...new Set(requested)] as Capability[];
  const connection = await env.DB.prepare(`SELECT c.id, o.scopes_json FROM connections c
    JOIN oauth_connections o ON o.connection_id=c.id AND o.tenant_id=c.tenant_id
      AND o.provider='microsoft' AND o.status='connected'
    WHERE c.tenant_id=? AND c.name='Microsoft 365' AND c.secret_configured=1`)
    .bind(tenantId).first<{ id: string; scopes_json: string }>();
  if (!connection) throw new Error("Microsoft 365 is not connected");
  const granted = safeArray(connection.scopes_json).map((scope) => scope.toLowerCase());
  const results: Array<Record<string, unknown>> = [];
  let accessToken: string | null = null;
  for (const capability of capabilities) {
    const definition = definitions[capability];
    if (!granted.includes(definition.scope.toLowerCase())) {
      results.push({
        capability, label: definition.label, scope: definition.scope,
        status: "not_granted", httpStatus: null, latencyMs: null,
        detail: `Reconnect Microsoft 365 with ${definition.scope} permission`,
      });
      continue;
    }
    const started = performance.now();
    try {
      if (!accessToken) {
        accessToken = (await tokenProvider(
          env, tenantId, "User.Read", fetcher, connection.id
        )).accessToken;
      }
      const response = await fetcher(definition.endpoint, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
          "user-agent": "Workrr-One-Acceptance/1.0",
        },
      });
      await response.body?.cancel();
      results.push({
        capability, label: definition.label, scope: definition.scope,
        status: response.ok ? "passed" : "failed",
        httpStatus: response.status,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        detail: response.ok ? "Fixed read-only endpoint accepted the delegated token"
          : `Microsoft Graph returned HTTP ${response.status}`,
      });
    } catch (error) {
      results.push({
        capability, label: definition.label, scope: definition.scope,
        status: "failed", httpStatus: null,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        detail: safeError(error),
      });
    }
  }
  const status = results.every((result) => result.status === "passed") ? "passed" : "failed";
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const completedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO provider_acceptance_runs
    (id, tenant_id, connection_id, provider, status, requested_json, results_json,
     started_by, started_at, completed_at)
    VALUES (?, ?, ?, 'microsoft', ?, ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, connection.id, status, JSON.stringify(capabilities),
      JSON.stringify(results), actorId, startedAt, completedAt).run();
  return { id, provider: "microsoft", connectionId: connection.id, status,
    requested: capabilities, results, startedAt, completedAt };
}

function safeArray(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function safeResults(value: unknown): Array<Record<string, unknown>> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch { return []; }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}
