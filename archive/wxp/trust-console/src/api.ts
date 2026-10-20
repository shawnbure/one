// Thin client for the Workrr Exchange (WXP) REST surface. The trust console is
// just another client — everything here is a plain HTTP call the same as any
// agent makes. Moderator/admin actions (resolve disputes, grant credits,
// list-all) use a bearer token; operator reads use the same token.

export interface Auth {
  base: string; // "" means same-origin (dev proxy), or a full origin
  token: string; // admin/moderator/operator bearer token
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T = any>(auth: Auth, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(auth.base + path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await r.text();
  const body = text ? JSON.parse(text) : {};
  if (!r.ok) throw new ApiError(r.status, body.error || `HTTP ${r.status}`);
  return body as T;
}

export const api = {
  discovery: (auth: Auth) => req(auth, "/api/v1/discovery"),
  capabilities: (auth: Auth, tag?: string) =>
    req(auth, `/api/v1/exchange/capabilities${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`),
  jobs: (auth: Auth) => req(auth, "/api/v1/exchange/jobs?all=true"),
  job: (auth: Auth, id: string) => req(auth, `/api/v1/exchange/jobs/${id}`),
  approvals: (auth: Auth) => req(auth, "/api/v1/exchange/approvals?all=true"),
  disputes: (auth: Auth) => req(auth, "/api/v1/exchange/disputes"),
  resolveDispute: (auth: Auth, id: string, decision: string, providerBps?: number) =>
    req(auth, `/api/v1/exchange/disputes/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision, ...(providerBps != null ? { providerBps } : {}) }),
    }),
  ledger: (auth: Auth, owner: string) => req(auth, `/api/v1/exchange/accounts/${owner}/ledger`),
  grant: (auth: Auth, operator: string, amount: string) =>
    req(auth, "/api/v1/exchange/credits/grant", { method: "POST", body: JSON.stringify({ operator, amount }) }),
  reputation: (auth: Auth, id: string) => req(auth, `/api/v1/exchange/reputation/${id}`),
};
