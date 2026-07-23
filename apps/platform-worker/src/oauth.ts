import type { Env } from "./types";

const MICROSOFT_AUTHORIZE = "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
const MICROSOFT_ME = "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";
const BASE_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read"];
const CAPABILITY_SCOPES = {
  mail: "Mail.ReadBasic",
  mail_send: "Mail.Send",
  calendar: "Calendars.ReadBasic",
  calendar_write: "Calendars.ReadWrite",
  files: "Files.Read"
} as const;
export type MicrosoftCapability = keyof typeof CAPABILITY_SCOPES;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface OAuthStateRow {
  tenant_id: string;
  actor_id: string;
  verifier_ciphertext: string;
  verifier_iv: string;
  capabilities_json: string;
  redirect_uri: string;
}
interface OAuthConnectionRow {
  id: string;
  connection_id: string;
  account_email: string | null;
  account_name: string | null;
  scopes_json: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
}

export async function startMicrosoftOAuth(env: Env, tenantId: string, actorId: string, capabilities: string[]) {
  assertMicrosoftConfiguration(env);
  const selected = normalizeCapabilities(capabilities);
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const encrypted = await encryptSecret(env.OAUTH_TOKEN_ENCRYPTION_KEY!, verifier);
  const redirectUri = `https://${env.APP_DOMAIN}/oauth/microsoft/callback`;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.prepare(`INSERT INTO oauth_states
    (state_hash, tenant_id, actor_id, provider, verifier_ciphertext, verifier_iv, capabilities_json, redirect_uri, expires_at)
    VALUES (?, ?, ?, 'microsoft', ?, ?, ?, ?, ?)`)
    .bind(await sha256(state), tenantId, actorId, encrypted.ciphertext, encrypted.iv, JSON.stringify(selected), redirectUri, expiresAt).run();
  const scopes = [...BASE_SCOPES, ...selected.map((item) => CAPABILITY_SCOPES[item])];
  const url = new URL(MICROSOFT_AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();
  return { authorizationUrl: url.toString(), capabilities: selected, scopes, expiresAt };
}

export async function completeMicrosoftOAuth(env: Env, state: string, code: string, fetcher: typeof fetch = fetch) {
  assertMicrosoftConfiguration(env);
  if (!state || !code) throw new Error("Microsoft authorization response is incomplete");
  const stateHash = await sha256(state);
  const row = await env.DB.prepare(`SELECT * FROM oauth_states
    WHERE state_hash = ? AND provider = 'microsoft' AND used_at IS NULL AND expires_at > ?`)
    .bind(stateHash, new Date().toISOString()).first<OAuthStateRow>();
  if (!row) throw new Error("Microsoft authorization state is invalid or expired");
  const claimed = await env.DB.prepare("UPDATE oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL")
    .bind(new Date().toISOString(), stateHash).run();
  if (claimed.meta.changes !== 1) throw new Error("Microsoft authorization state was already used");
  const verifier = await decryptSecret(env.OAUTH_TOKEN_ENCRYPTION_KEY!, row.verifier_ciphertext, row.verifier_iv);
  const token = await tokenRequest(env, {
    client_id: env.MICROSOFT_CLIENT_ID!,
    client_secret: env.MICROSOFT_CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
    redirect_uri: row.redirect_uri,
    code_verifier: verifier
  }, fetcher);
  if (!token.access_token || !token.refresh_token) throw new Error("Microsoft did not return the required delegated tokens");
  const profileResponse = await fetcher(MICROSOFT_ME, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error(`Microsoft profile check failed (${profileResponse.status})`);
  const profile = await profileResponse.json() as { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
  if (!profile.id) throw new Error("Microsoft profile response did not include an account identifier");
  const encrypted = await encryptSecret(env.OAUTH_TOKEN_ENCRYPTION_KEY!, token.refresh_token);
  const connectionId = await ensureMicrosoftConnection(env, row.tenant_id);
  const id = `oauth-microsoft-${row.tenant_id}`;
  const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [...BASE_SCOPES,
    ...normalizeCapabilities(JSON.parse(row.capabilities_json) as string[]).map((item) => CAPABILITY_SCOPES[item])];
  const tokenExpiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in ?? 3600)) * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO oauth_connections
      (id, tenant_id, connection_id, provider, provider_tenant_id, provider_subject, account_email, account_name,
       scopes_json, refresh_token_ciphertext, refresh_token_iv, token_expires_at, status, last_checked_at, last_error, connected_by)
      VALUES (?, ?, ?, 'microsoft', NULL, ?, ?, ?, ?, ?, ?, ?, 'connected', CURRENT_TIMESTAMP, NULL, ?)
      ON CONFLICT(tenant_id, provider) DO UPDATE SET connection_id=excluded.connection_id,
       provider_subject=excluded.provider_subject, account_email=excluded.account_email, account_name=excluded.account_name,
       scopes_json=excluded.scopes_json, refresh_token_ciphertext=excluded.refresh_token_ciphertext,
       refresh_token_iv=excluded.refresh_token_iv, token_expires_at=excluded.token_expires_at, status='connected',
       last_checked_at=CURRENT_TIMESTAMP, last_error=NULL, connected_by=excluded.connected_by, connected_at=CURRENT_TIMESTAMP,
       updated_at=CURRENT_TIMESTAMP`)
      .bind(id, row.tenant_id, connectionId, profile.id, profile.mail ?? profile.userPrincipalName ?? null,
        profile.displayName ?? null, JSON.stringify(scopes), encrypted.ciphertext, encrypted.iv, tokenExpiresAt, row.actor_id),
    env.DB.prepare(`UPDATE connections SET status='healthy', secret_configured=1, scopes_json=?, access_mode=?,
      last_checked_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(JSON.stringify(scopes.filter((scope) => !BASE_SCOPES.includes(scope))),
        scopes.some((scope) => scope.toLowerCase() === "mail.send") ? "read_write" : "read",
        connectionId, row.tenant_id),
    audit(env, row.tenant_id, row.actor_id, "connection.oauth_connected", connectionId, {
      provider: "microsoft", account: profile.mail ?? profile.userPrincipalName ?? null, scopes
    })
  ]);
  return { tenantId: row.tenant_id, connectionId, accountEmail: profile.mail ?? profile.userPrincipalName ?? null };
}

export async function checkMicrosoftConnection(env: Env, tenantId: string, actorId: string, fetcher: typeof fetch = fetch) {
  assertMicrosoftConfiguration(env);
  const row = await env.DB.prepare(`SELECT o.*, c.id connection_id FROM oauth_connections o
    JOIN connections c ON c.id=o.connection_id AND c.tenant_id=o.tenant_id
    WHERE o.tenant_id=? AND o.provider='microsoft' AND o.status!='disconnected'`)
    .bind(tenantId).first<OAuthConnectionRow>();
  if (!row) throw new Error("Microsoft 365 is not connected");
  try {
    const refreshToken = await decryptSecret(env.OAUTH_TOKEN_ENCRYPTION_KEY!, row.refresh_token_ciphertext, row.refresh_token_iv);
    const token = await tokenRequest(env, {
      client_id: env.MICROSOFT_CLIENT_ID!,
      client_secret: env.MICROSOFT_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: (JSON.parse(row.scopes_json) as string[]).join(" ")
    }, fetcher);
    if (!token.access_token) throw new Error("Microsoft token refresh did not return an access token");
    const profileResponse = await fetcher(MICROSOFT_ME, { headers: { authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new Error(`Microsoft profile check failed (${profileResponse.status})`);
    const profile = await profileResponse.json() as { displayName?: string; mail?: string; userPrincipalName?: string };
    const rotated = token.refresh_token ? await encryptSecret(env.OAUTH_TOKEN_ENCRYPTION_KEY!, token.refresh_token) : null;
    await env.DB.batch([
      env.DB.prepare(`UPDATE oauth_connections SET status='connected', account_email=?, account_name=?,
        refresh_token_ciphertext=COALESCE(?,refresh_token_ciphertext), refresh_token_iv=COALESCE(?,refresh_token_iv),
        token_expires_at=?, last_checked_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=?`)
        .bind(profile.mail ?? profile.userPrincipalName ?? row.account_email, profile.displayName ?? row.account_name,
          rotated?.ciphertext ?? null, rotated?.iv ?? null,
          new Date(Date.now() + Math.max(60, Number(token.expires_in ?? 3600)) * 1000).toISOString(), row.id, tenantId),
      env.DB.prepare("UPDATE connections SET status='healthy', last_checked_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?")
        .bind(row.connection_id, tenantId),
      audit(env, tenantId, actorId, "connection.oauth_checked", row.connection_id, { provider: "microsoft", status: "healthy" })
    ]);
    return { id: row.connection_id, status: "healthy", detail: `Microsoft 365 connected as ${profile.mail ?? profile.userPrincipalName ?? profile.displayName ?? "delegated account"}` };
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await env.DB.batch([
      env.DB.prepare("UPDATE oauth_connections SET status='attention', last_checked_at=CURRENT_TIMESTAMP, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?")
        .bind(detail, row.id, tenantId),
      env.DB.prepare("UPDATE connections SET status='attention', last_checked_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?")
        .bind(row.connection_id, tenantId)
    ]);
    throw new Error(detail);
  }
}

export async function getMicrosoftAccessToken(
  env: Env,
  tenantId: string,
  requiredScope: string,
  fetcher: typeof fetch = fetch,
  expectedConnectionId?: string,
) {
  assertMicrosoftConfiguration(env);
  const row = await env.DB.prepare(`SELECT o.*, c.id connection_id FROM oauth_connections o
    JOIN connections c ON c.id=o.connection_id AND c.tenant_id=o.tenant_id
    WHERE o.tenant_id=? AND o.provider='microsoft' AND o.status!='disconnected'
      AND c.status='healthy' AND c.secret_configured=1
      AND (? IS NULL OR c.id=?)`)
    .bind(tenantId, expectedConnectionId ?? null, expectedConnectionId ?? null).first<OAuthConnectionRow>();
  if (!row) throw new Error("Microsoft 365 is not connected");
  const scopes = JSON.parse(row.scopes_json) as string[];
  if (!scopes.some((scope) => scope.toLowerCase() === requiredScope.toLowerCase())) {
    throw new Error(`Microsoft 365 must be reconnected with ${requiredScope} permission`);
  }
  try {
    const refreshToken = await decryptSecret(env.OAUTH_TOKEN_ENCRYPTION_KEY!, row.refresh_token_ciphertext, row.refresh_token_iv);
    const token = await tokenRequest(env, {
      client_id: env.MICROSOFT_CLIENT_ID!,
      client_secret: env.MICROSOFT_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    }, fetcher);
    if (!token.access_token) throw new Error("Microsoft token refresh did not return an access token");
    const returnedScopes = token.scope?.split(/\s+/).filter(Boolean) ?? scopes;
    if (!returnedScopes.some((scope) => scope.toLowerCase() === requiredScope.toLowerCase())) {
      throw new Error(`Microsoft token does not grant ${requiredScope}`);
    }
    const rotated = token.refresh_token ? await encryptSecret(env.OAUTH_TOKEN_ENCRYPTION_KEY!, token.refresh_token) : null;
    await env.DB.batch([
      env.DB.prepare(`UPDATE oauth_connections SET status='connected', scopes_json=?,
        refresh_token_ciphertext=COALESCE(?,refresh_token_ciphertext), refresh_token_iv=COALESCE(?,refresh_token_iv),
        token_expires_at=?, last_checked_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=?`)
        .bind(JSON.stringify(returnedScopes), rotated?.ciphertext ?? null, rotated?.iv ?? null,
          new Date(Date.now() + Math.max(60, Number(token.expires_in ?? 3600)) * 1000).toISOString(), row.id, tenantId),
      env.DB.prepare(`UPDATE connections SET status='healthy', scopes_json=?, access_mode=?,
        last_checked_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
        .bind(JSON.stringify(returnedScopes.filter((scope) => !BASE_SCOPES.includes(scope))),
          returnedScopes.some((scope) => scope.toLowerCase() === "mail.send") ? "read_write" : "read",
          row.connection_id, tenantId),
    ]);
    return { accessToken: token.access_token, accountEmail: row.account_email, connectionId: row.connection_id };
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await env.DB.batch([
      env.DB.prepare(`UPDATE oauth_connections SET status='attention', last_checked_at=CURRENT_TIMESTAMP,
        last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`).bind(detail, row.id, tenantId),
      env.DB.prepare(`UPDATE connections SET status='attention', last_checked_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=?`).bind(row.connection_id, tenantId),
    ]);
    throw new Error(detail);
  }
}

export async function disconnectMicrosoft(env: Env, tenantId: string, actorId: string) {
  const row = await env.DB.prepare("SELECT id, connection_id FROM oauth_connections WHERE tenant_id=? AND provider='microsoft'")
    .bind(tenantId).first<{ id: string; connection_id: string }>();
  if (!row) return { disconnected: false };
  await env.DB.batch([
    env.DB.prepare(`UPDATE oauth_connections SET status='disconnected', refresh_token_ciphertext='revoked',
      refresh_token_iv='revoked', last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`).bind(row.id, tenantId),
    env.DB.prepare("UPDATE connections SET status='disconnected', secret_configured=0, last_checked_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?")
      .bind(row.connection_id, tenantId),
    audit(env, tenantId, actorId, "connection.oauth_disconnected", row.connection_id, { provider: "microsoft" })
  ]);
  return { disconnected: true, connectionId: row.connection_id };
}

export async function encryptSecret(encodedKey: string, plaintext: string) {
  const key = await encryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return { ciphertext: base64Url(ciphertext), iv: base64Url(iv) };
}

export async function decryptSecret(encodedKey: string, ciphertext: string, encodedIv: string) {
  const key = await encryptionKey(encodedKey);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(encodedIv) }, key, fromBase64Url(ciphertext));
  return new TextDecoder().decode(clear);
}

function normalizeCapabilities(capabilities: string[]): MicrosoftCapability[] {
  return [...new Set(capabilities)].filter((item): item is MicrosoftCapability => item in CAPABILITY_SCOPES);
}

async function tokenRequest(env: Env, values: Record<string, string>, fetcher: typeof fetch) {
  const response = await fetcher(MICROSOFT_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString()
  });
  const token = await response.json() as TokenResponse;
  if (!response.ok || token.error) throw new Error(token.error_description || token.error || `Microsoft token exchange failed (${response.status})`);
  return token;
}

async function ensureMicrosoftConnection(env: Env, tenantId: string) {
  const existing = await env.DB.prepare("SELECT id FROM connections WHERE tenant_id=? AND name='Microsoft 365'")
    .bind(tenantId).first<{ id: string }>();
  if (existing) return existing.id;
  const id = `conn-microsoft-${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO connections
    (id, tenant_id, name, kind, owner, status, access_mode, scopes_json, secret_configured)
    VALUES (?, ?, 'Microsoft 365', 'oauth', 'Platform Administration', 'disconnected', 'read', '[]', 0)`)
    .bind(id, tenantId).run();
  return id;
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, targetId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'connection', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, targetId, JSON.stringify(detail));
}

function assertMicrosoftConfiguration(env: Env): asserts env is Env & Required<
  Pick<Env, "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "OAUTH_TOKEN_ENCRYPTION_KEY">
> {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.OAUTH_TOKEN_ENCRYPTION_KEY) {
    throw new Error("Microsoft OAuth secrets are not configured");
  }
}

async function encryptionKey(encoded: string) {
  let raw: Uint8Array;
  try { raw = fromBase64Url(encoded); }
  catch { throw new Error("OAuth token encryption key must be 32 bytes"); }
  if (raw.byteLength !== 32) throw new Error("OAuth token encryption key must be 32 bytes");
  return crypto.subtle.importKey("raw", Uint8Array.from(raw).buffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomBase64Url(bytes: number) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
