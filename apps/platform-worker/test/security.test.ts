import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { resolveAccessPrincipal } from "../src/auth";

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
  it("maps an Access service-token common name to one active tenant principal", async () => {
    let bound: unknown[] = [];
    const DB = { prepare(sql: string) {
      expect(sql).toContain("FROM access_service_principals");
      const statement = {
        bind(...values: unknown[]) { bound = values; return statement; },
        async first() { return { id: "machine-1", tenant_id: "customer-a", email: "service:client.access",
          display_name: "Deployment smoke", role: "operator", identity_type: "service" }; }
      };
      return statement;
    } };
    const principal = await resolveAccessPrincipal({ DB } as never, { common_name: "client.access" });
    expect(bound).toEqual(["client.access"]);
    expect(principal).toMatchObject({ tenant_id: "customer-a", role: "operator", identity_type: "service" });
  });

  it("does not fall back from an unknown machine identity to local tenant headers", async () => {
    const DB = { prepare() { return { bind() { return this; }, async first() { return null; } }; } };
    expect(await resolveAccessPrincipal({ DB } as never, { common_name: "unknown.access" })).toBeNull();
  });

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

  it("prevents viewers from acknowledging operational alerts", async () => {
    const viewer = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/notifications/events/event-1/acknowledge", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ note: "Unauthorized" })
    }), viewer.env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("acknowledged_at"))).toBe(false);
  });

  it("keeps approval evidence out of consumer sessions and collaboration mutations away from viewers", async () => {
    const consumer = environment("consumer");
    const listResponse = await app.fetch(new Request("http://localhost/api/approvals", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), consumer.env as never, executionCtx as never);
    expect(listResponse.status).toBe(403);
    expect(consumer.queries.some((sql) => sql.includes("FROM approvals WHERE"))).toBe(false);

    const viewer = environment("viewer");
    const messageResponse = await app.fetch(new Request("http://localhost/api/approvals/approval-1/messages", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ kind: "comment", body: "Unauthorized" })
    }), viewer.env as never, executionCtx as never);
    expect(messageResponse.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("approval_messages"))).toBe(false);
  });

  it("prevents viewers from changing connection credential lifecycle metadata", async () => {
    const viewer = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/connections/connection-1/lifecycle", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ rotationOwner: "operator@example.com", credentialExpiresAt: "2027-01-01" })
    }), viewer.env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("UPDATE connections SET credential_expires_at"))).toBe(false);
  });

  it("lets viewers inspect opportunities but not capture, qualify, or convert them", async () => {
    const viewer = environment("viewer");
    const list = await app.fetch(new Request("http://localhost/api/opportunities", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), viewer.env as never, executionCtx as never);
    expect(list.status).toBe(200);
    for (const request of [
      new Request("http://localhost/api/opportunities", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }),
      new Request("http://localhost/api/opportunities/opp-1", {
        method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ expectedRevision: 1 })
      }),
      new Request("http://localhost/api/opportunities/opp-1/qualification", {
        method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ status: "qualified" })
      }),
      new Request("http://localhost/api/opportunities/opp-1/readiness/owner_confirmed", {
        method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ status: "confirmed" })
      }),
      new Request("http://localhost/api/opportunities/opp-1/convert", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ templateId: "template-document-intake" })
      })
    ]) {
      const response = await app.fetch(request, viewer.env as never, executionCtx as never);
      expect(response.status).toBe(403);
    }
    expect(viewer.queries.some((sql) => sql.includes("INSERT INTO process_opportunities") ||
      sql.includes("UPDATE process_opportunities"))).toBe(false);
  });

  it("prevents viewers from creating smoke fixtures or machine identities", async () => {
    for (const path of ["/api/smoke-fixtures", "/api/service-principals"]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(new Request(`http://localhost${path}`, {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }), env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("INSERT INTO smoke_fixtures") ||
        sql.includes("INSERT INTO access_service_principals"))).toBe(false);
    }
  });

  it("allows viewers to inspect typed tools but not create or change them", async () => {
    const registryEnvironment = environment("viewer");
    const registryResponse = await app.fetch(new Request("http://localhost/api/tool-adapters", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), registryEnvironment.env as never, executionCtx as never);
    expect(registryResponse.status).toBe(200);
    const registry = await registryResponse.json() as { data: Array<{ key: string; scope: string }> };
    expect(registry.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "microsoft.profile.get", scope: "User.Read" })
    ]));
    for (const request of [
      new Request("http://localhost/api/tools", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }),
      new Request("http://localhost/api/tools/tool-1/status", {
        method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ enabled: false })
      })
    ]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(request, env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("INSERT INTO tool_definitions") ||
        sql.includes("UPDATE tool_definitions"))).toBe(false);
    }
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

  it("does not enable email delivery without delegated Microsoft Mail.Send", async () => {
    const { env, queries } = environment("admin");
    const originalPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => {
      if (sql.includes("SELECT p.channel, p.destination")) {
        queries.push(sql);
        return {
          bind() { return this; },
          async first() { return { channel: "email", destination: "alerts@customer.example", secret_binding: null }; },
        } as never;
      }
      if (sql.includes("SELECT 1 ready FROM oauth_connections")) {
        queries.push(sql);
        return { bind() { return this; }, async first() { return null; } } as never;
      }
      return originalPrepare(sql);
    };
    const response = await app.fetch(new Request("http://localhost/api/notifications/policies/notify-email", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ enabled: true })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Mail.Send") });
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

  it("allows auditors to download the secret-free privacy architecture report", async () => {
    const { env } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/governance/privacy-report", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), env as never, executionCtx as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-disposition")).toContain("workrr-privacy-architecture");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("Privacy &amp; Architecture Summary");
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

  it("allows viewers to inspect Queue evidence but not replay failed work", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/queue-jobs/job-1/replay", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: "{}"
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("FROM process_queue_jobs q JOIN executions"))).toBe(false);
  });

  it("prevents reviewers and viewers from retrying or cancelling approved action delivery", async () => {
    const inspection = environment("viewer");
    const inspectionResponse = await app.fetch(new Request("http://localhost/api/tool-actions", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), inspection.env as never, executionCtx as never);
    expect(inspectionResponse.status).toBe(200);
    for (const role of ["reviewer", "viewer"]) {
      for (const operation of ["retry", "cancel"]) {
        const { env, queries } = environment(role);
        const response = await app.fetch(new Request(`http://localhost/api/tool-actions/action-1/${operation}`, {
          method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
            "x-workrr-user": "operator@example.com" }, body: "{}"
        }), env as never, executionCtx as never);
        expect(response.status).toBe(403);
        expect(queries.some((sql) => sql.includes("tool_action_dispatches"))).toBe(false);
      }
    }
  });

  it("allows viewers to inspect knowledge but not alter source lifecycle", async () => {
    for (const request of [
      new Request("http://localhost/api/knowledge-sources/source-1/reindex", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }),
      new Request("http://localhost/api/knowledge-sources/source-1/review", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }),
      new Request("http://localhost/api/knowledge-sources/source-1", {
        method: "DELETE", headers: { origin: "http://localhost", "x-workrr-user": "operator@example.com" }
      })
    ]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(request, env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("UPDATE knowledge_sources") ||
        sql.includes("DELETE FROM knowledge_sources"))).toBe(false);
    }
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

  it("prevents builders and viewers from approving governed rubric packages", async () => {
    for (const role of ["builder", "viewer"]) {
      for (const request of [
        new Request("http://localhost/api/evaluation-rubric-reviews/review-1/approved", {
          method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
            "x-workrr-user": "operator@example.com" }, body: "{}"
        }),
        new Request("http://localhost/api/evaluation-rubric-publishers/from-review/review-1", {
          method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
            "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ policy: "auto_approve" })
        })
      ]) {
        const { env, queries } = environment(role);
        const response = await app.fetch(request, env as never, executionCtx as never);
        expect(response.status).toBe(403);
        expect(queries.some((sql) => sql.includes("rubric_publisher_trust") ||
          sql.includes("UPDATE rubric_package_reviews"))).toBe(false);
      }
    }
  });
});
