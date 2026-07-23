import { describe, expect, it } from "vitest";
import { app } from "../src/index";

type Row = Record<string, unknown>;

function environment(role = "admin") {
  const queries: string[] = [];
  const member = { id: "member-1", tenant_id: "demo", email: "operator@example.com", display_name: "Operator", role };
  const DB = {
    prepare(sql: string) {
      queries.push(sql);
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first<T extends Row>() {
          if (sql.includes("FROM tenant_members")) return member as T;
          if (sql.includes("FROM tenants t")) return { name: "Customer One", accent_color: "#1f7a5b" } as T;
          if (sql.includes("SELECT p.channel, p.destination")) return {
            channel: "webhook", destination: "https://customer.example/events", secret_binding: "NOTIFICATION_WEBHOOK_SECRET"
          } as T;
          return null;
        },
        async run() { return { meta: { changes: 1 } }; },
        async all() { return { results: [] }; }
      };
      void bindings;
      return statement;
    }
  };
  return { env: { DB, ENVIRONMENT: "development", LOCAL_DEV: "true" }, queries };
}

const executionCtx = { waitUntil(promise: Promise<unknown>) { void promise; }, passThroughOnException() {} };

describe("control-plane security boundary", () => {
  it("derives tenant membership server-side and ignores forged tenant headers", async () => {
    const { env } = environment();
    const response = await app.fetch(new Request("http://localhost/api/session", { headers: {
      "x-workrr-user": "operator@example.com", "x-workrr-tenant": "forged-customer", "x-workrr-role": "admin"
    }}), env as never, executionCtx as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tenantId: "demo", tenantName: "Customer One", user: { role: "admin" } });
  });

  it("rejects cross-origin browser mutations before business data changes", async () => {
    const { env, queries } = environment();
    const response = await app.fetch(new Request("http://localhost/api/onboarding", {
      method: "PUT", headers: { origin: "https://evil.example", "content-type": "application/json", "x-workrr-user": "operator@example.com" }, body: "{}"
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("UPDATE tenants SET name"))).toBe(false);
  });

  it("enforces route roles after authenticated membership lookup", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/notifications/policies/notify-execution", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ enabled: false })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("UPDATE notification_policies"))).toBe(false);
  });

  it("rejects malformed process packages before creating tenant data", async () => {
    const { env, queries } = environment("builder");
    const response = await app.fetch(new Request("http://localhost/api/process-packages/import", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ schemaVersion: 99, process: { name: "Unsafe" } })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(400);
    expect(queries.some((sql) => sql.includes("INSERT INTO agent_blueprints"))).toBe(false);
  });

  it("does not enable external delivery when its Cloudflare credential is absent", async () => {
    const { env, queries } = environment("admin");
    const response = await app.fetch(new Request("http://localhost/api/notifications/policies/notify-webhook", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ enabled: true })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(409);
    expect(queries.some((sql) => sql.includes("UPDATE notification_policies SET"))).toBe(false);
  });

  it("prevents viewers from launching a customer baseline", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/onboarding/bootstrap", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ idempotencyKey: "forged-launch" })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("INSERT INTO tenant_bootstrap_runs"))).toBe(false);
  });

  it("prevents viewers from exporting the Access member allowlist", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/onboarding/access-handoff", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("status = 'active' ORDER BY email"))).toBe(false);
  });

  it("prevents viewers from starting or disconnecting provider OAuth", async () => {
    for (const path of ["/api/oauth/microsoft/start", "/api/oauth/microsoft/disconnect"]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(new Request(`http://localhost${path}`, {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }), env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("oauth_states") || sql.includes("oauth_connections"))).toBe(false);
    }
  });

  it("prevents viewers from changing tenant containment mode", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/tenant/mode", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ mode: "emergency_stop", reason: "Unauthorized attempt" })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("INSERT INTO tenant_operating_controls"))).toBe(false);
  });

  it("prevents viewers from weakening DLP policy", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/dlp/rules/ssn", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ action: "audit", direction: "both", enabled: false })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("UPDATE dlp_rules"))).toBe(false);
  });

  it("allows viewers to export but not import portable evaluation packages", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/evaluations/scenario-1/dataset", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ schema: "workrr-evaluation/v1", scenario: { cases: [] } })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("INSERT OR IGNORE INTO evaluation_cases"))).toBe(false);
  });

  it("allows viewers to read but not change organization rubric templates", async () => {
    for (const request of [
      new Request("http://localhost/api/evaluation-rubrics", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ name: "Unauthorized", criteria: [
          { criterion: "Be useful", dimension: "completeness", weight: 1 }
        ] })
      }),
      new Request("http://localhost/api/evaluation-rubrics/rubric-1", {
        method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ enabled: false })
      })
    ]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(request, env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("INSERT INTO evaluation_rubric_templates") ||
        sql.includes("UPDATE evaluation_rubric_templates"))).toBe(false);
    }
  });

  it("allows viewers to export but not import organization rubric packages", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/evaluation-rubrics/package", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ schema: "workrr-rubrics/v1", templates: [{
        name: "Unauthorized", criteria: [{ criterion: "Be useful", dimension: "completeness", weight: 1 }]
      }] })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("INSERT OR IGNORE INTO evaluation_rubric_templates"))).toBe(false);
  });
});
