import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context, Next } from "hono";
import type { Env } from "./types";
import { recordAccessSession, sessionEvidenceId, type AccessEvidence } from "./access-operations";

export const roles = ["admin", "builder", "owner", "operator", "reviewer", "viewer", "consumer"] as const;
export type Role = (typeof roles)[number];

export interface AuthVariables {
  tenantId: string;
  actorId: string;
  actorEmail: string;
  actorName: string;
  role: Role;
}

interface MemberRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  role: Role;
  identity_type: "human" | "service";
}
type ResolvedIdentity = MemberRow & { accessEvidence: AccessEvidence };

type AppContext = Context<{ Bindings: Env; Variables: AuthVariables }>;

export async function requireIdentity(c: AppContext, next: Next): Promise<Response | void> {
  const identity = await resolveIdentity(c);
  if (!identity) return c.json({ error: "Authenticated organization membership is required" }, 401);
  c.set("tenantId", identity.tenant_id);
  c.set("actorId", identity.id);
  c.set("actorEmail", identity.email);
  c.set("actorName", identity.display_name);
  c.set("role", identity.role);
  const identityTable = identity.identity_type === "service" ? "access_service_principals" : "tenant_members";
  const now = new Date().toISOString();
  c.executionCtx.waitUntil(Promise.all([
    c.env.DB.prepare(`UPDATE ${identityTable} SET last_seen_at = ? WHERE id = ?
      AND (last_seen_at IS NULL OR datetime(last_seen_at) <= datetime(?, '-15 minutes'))`)
      .bind(now, identity.id, now).run(),
    recordAccessSession(c.env, c.req.raw, identity, identity.accessEvidence)
  ]).catch((error) => {
    console.error(JSON.stringify({ event: "access_evidence_write_failed", error: String(error) }));
  }));
  await next();
}

async function resolveIdentity(c: AppContext): Promise<ResolvedIdentity | null> {
  const localDevelopment = c.env.ENVIRONMENT === "development" && c.env.LOCAL_DEV === "true";
  if (c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD && !localDevelopment) {
    const token = c.req.header("cf-access-jwt-assertion");
    if (!token) return null;
    try {
      const issuer = normalizeIssuer(c.env.ACCESS_TEAM_DOMAIN);
      const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)), {
        issuer,
        audience: c.env.ACCESS_AUD
      });
      const principal = await resolveAccessPrincipal(c.env, payload);
      if (!principal) return null;
      const issuedAt = typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : null;
      const expiresAt = typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;
      const sessionId = await sessionEvidenceId([
        principal.tenant_id, principal.id, payload.sub, payload.iat,
        typeof payload.common_name === "string" ? payload.common_name : null, c.env.ACCESS_AUD
      ]);
      return { ...principal, accessEvidence: {
        sessionId, issuedAt, expiresAt, identityType: principal.identity_type
      } };
    } catch (error) {
      console.warn(JSON.stringify({ event: "access_token_rejected", error: error instanceof Error ? error.message : String(error) }));
      return null;
    }
  }

  if (c.env.ENVIRONMENT !== "development") return null;
  const email = c.req.header("x-workrr-user") ?? "shawnbure@outlook.com";
  const member = await membershipByEmail(c.env, email);
  if (member) return withLocalEvidence(member, c.req.raw);

  // Local-only compatibility for a newly bootstrapped developer database.
  const tenantId = c.req.header("x-workrr-tenant") ?? "demo";
  const requestedRole = c.req.header("x-workrr-role");
  const role: Role = requestedRole && roles.includes(requestedRole as Role) ? requestedRole as Role : "admin";
  return withLocalEvidence({ id: "local-admin", tenant_id: tenantId, email,
    display_name: "Local Administrator", role, identity_type: "human" }, c.req.raw);
}

async function membershipByEmail(env: Env, email: string): Promise<MemberRow | null> {
  return env.DB.prepare(`SELECT id, tenant_id, email, display_name, role, 'human' identity_type FROM tenant_members
    WHERE email = ? COLLATE NOCASE AND status = 'active' ORDER BY created_at LIMIT 1`)
    .bind(email).first<MemberRow>();
}

export async function resolveAccessPrincipal(env: Env, payload: Record<string, unknown>): Promise<MemberRow | null> {
  if (typeof payload.email === "string" && payload.email.trim()) {
    return membershipByEmail(env, payload.email);
  }
  if (typeof payload.common_name !== "string" || !payload.common_name.trim()) return null;
  return env.DB.prepare(`SELECT id, tenant_id, 'service:' || access_common_name email, display_name, role,
      'service' identity_type FROM access_service_principals
    WHERE access_common_name = ? AND status = 'active' LIMIT 1`)
    .bind(payload.common_name.trim()).first<MemberRow>();
}

function normalizeIssuer(value: string): string {
  return value.startsWith("https://") ? value.replace(/\/$/, "") : `https://${value.replace(/\/$/, "")}`;
}

async function withLocalEvidence(member: MemberRow, request: Request): Promise<ResolvedIdentity> {
  return { ...member, accessEvidence: {
    sessionId: await sessionEvidenceId([
      "local-development", member.tenant_id, member.id, request.headers.get("user-agent")
    ]),
    issuedAt: null,
    expiresAt: null,
    identityType: member.identity_type
  } };
}

export function requireRoles(...allowed: Role[]) {
  return async (c: AppContext, next: Next): Promise<Response | void> => {
    if (!allowed.includes(c.get("role"))) return c.json({ error: "You do not have permission to perform this action" }, 403);
    await next();
  };
}

export async function requireSameOrigin(c: AppContext, next: Next): Promise<Response | void> {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("origin");
  if (!origin) return next();
  const requestOrigin = new URL(c.req.url).origin;
  const localDev = c.env.ENVIRONMENT === "development" &&
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
  if (origin !== requestOrigin && !localDev) return c.json({ error: "Cross-origin mutation rejected" }, 403);
  await next();
}
