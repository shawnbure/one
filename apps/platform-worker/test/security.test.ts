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
          if (sql.includes("FROM d1_migrations")) return {
            id: 99, name: "0099_service_principal_lifecycle.sql", applied_at: "2026-07-24 02:15:00"
          } as T;
          if (sql.includes("FROM agent_blueprints")) return {
            id: "process-1", tenant_id: "demo", name: "Customer response", autonomy: "autonomous",
            fallback_enabled: 1, fallback_min_terminal_runs: 5, fallback_success_threshold: 70,
            fallback_window_hours: 24, safety_autonomy_cap: null, safety_cap_reason: null,
            safety_cap_trigger: null, safety_cap_evidence_id: null, safety_cap_triggered_at: null,
            safety_cap_cleared_at: null, safety_cap_revision: 0
          } as T;
          if (sql.includes("COUNT(*) terminal_runs")) return { terminal_runs: 0, completed_runs: 0 } as T;
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
  return { env: { DB, ENVIRONMENT: "development", APP_DOMAIN: "one-dev.workrr.ai", LOCAL_DEV: "true" }, queries };
}

const executionCtx = { waitUntil(promise: Promise<unknown>) { void promise; }, passThroughOnException() {} };

describe("control-plane security boundary", () => {
  it("returns failed MCP OAuth callbacks to the governed connector workspace without reflecting errors", async () => {
    const { env } = environment();
    const response = await app.fetch(new Request(
      "http://localhost/oauth/mcp/callback?error=provider-secret-detail"
    ), env as never, executionCtx as never);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://one-dev.workrr.ai/?workspace=connections&section=mcp&mcp=error"
    );
  });

  it("keeps AI Gateway enablement behind owner or administrator authority", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/governance/ai-gateway", {
      method: "PATCH",
      headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({
        gatewayId: "customer-ai", enabled: true, collectLogs: true,
        evidenceReference: "unapproved-review"
      })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("tenant_ai_gateway_settings"))).toBe(false);
  });

  it("reserves durable actor identity upgrades for owners and administrators", async () => {
    const viewer = environment("viewer");
    const denied = await app.request("/api/processes/process-1/actor-identity/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "No durable state exists for this paused process.",
        confirmation: "UPGRADE ACTOR IDENTITY",
      }),
    }, viewer.env as never, executionCtx as never);
    expect(denied.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("SET actor_identity_version=2"))).toBe(false);
  });

  it("maps an Access service-token common name to one active tenant principal", async () => {
    let bound: unknown[] = [];
    const DB = { prepare(sql: string) {
      expect(sql).toContain("FROM access_service_principals");
      expect(sql).toContain("credential_expires_at");
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
    expect(await response.json()).toMatchObject({
      tenantId: "demo",
      tenantName: "Customer One",
      environment: "development",
      appDomain: "one-dev.workrr.ai",
      user: { role: "admin" }
    });
  });

  it("exposes deployment compatibility only to operating and audit roles", async () => {
    const viewer = environment("viewer");
    const allowed = await app.fetch(new Request("http://localhost/api/system/version", {
      headers: { "x-workrr-user": "operator@example.com", "x-workrr-role": "admin" }
    }), viewer.env as never, executionCtx as never);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      data: { environment: "development", schema: { status: "current", compatible: true } }
    });

    const consumer = environment("consumer");
    const denied = await app.fetch(new Request("http://localhost/api/system/version", {
      headers: { "x-workrr-user": "operator@example.com", "x-workrr-role": "admin" }
    }), consumer.env as never, executionCtx as never);
    expect(denied.status).toBe(403);
  });

  it("lets audit roles inspect MCP inventory but reserves connector and tool changes for owners", async () => {
    const viewer = environment("viewer");
    const read = await app.fetch(new Request("http://localhost/api/mcp-connectors", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), viewer.env as never, executionCtx as never);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ data: { connectors: [], tools: [] } });

    const create = await app.fetch(new Request("http://localhost/api/mcp-connectors", {
      method: "POST", headers: {
        origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com"
      }, body: JSON.stringify({ name: "Private CRM", serverUrl: "https://mcp.example.com/mcp" })
    }), viewer.env as never, executionCtx as never);
    expect(create.status).toBe(403);

    const govern = await app.fetch(new Request("http://localhost/api/mcp-tools/tool-1", {
      method: "PATCH", headers: {
        origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com"
      }, body: JSON.stringify({ enabled: true, expectedRevision: 1 })
    }), viewer.env as never, executionCtx as never);
    expect(govern.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("UPDATE mcp_connector_tools"))).toBe(false);
  });

  it("allows safety evidence inspection but restricts fallback policy changes to owners", async () => {
    const viewer = environment("viewer");
    const read = await app.fetch(new Request("http://localhost/api/processes/process-1/autonomy-safety", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), viewer.env as never, executionCtx as never);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      data: { state: { enabled: true, cap: null, revision: 0 }, evidence: { terminalRuns: 0 } }
    });
    const change = await app.fetch(new Request("http://localhost/api/processes/process-1/autonomy-safety", {
      method: "PATCH", headers: {
        origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com"
      }, body: JSON.stringify({ enabled: false, minTerminalRuns: 5, successThreshold: 70,
        windowHours: 24, expectedRevision: 0 })
    }), viewer.env as never, executionCtx as never);
    expect(change.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("SET fallback_enabled"))).toBe(false);
  });

  it("allows value evidence inspection but blocks viewers from recording customer outcomes", async () => {
    const viewer = environment("viewer");
    const read = await app.fetch(new Request("http://localhost/api/value", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), viewer.env as never, executionCtx as never);
    expect(read.status).toBe(200);
    const write = await app.fetch(new Request("http://localhost/api/value/measurements", {
      method: "POST", headers: {
        origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com"
      }, body: JSON.stringify({ blueprintId: "process-1", periodStart: "2026-07-01",
        periodEnd: "2026-07-20", itemsProcessed: 10, actualHumanMinutes: 20,
        evidenceReference: "customer-report-1" })
    }), viewer.env as never, executionCtx as never);
    expect(write.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("INSERT INTO business_value_measurements"))).toBe(false);
  });

  it("restricts process value target changes to owners and administrators", async () => {
    const operator = environment("operator");
    const response = await app.fetch(new Request("http://localhost/api/value/targets/process-1", {
      method: "PUT", headers: {
        origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com"
      }, body: JSON.stringify({ targetItems: 100, targetHumanMinutesSaved: 500, targetValue: 700,
        maximumOverridePercent: 10, maximumFailurePercent: 5,
        reviewDueAt: "2026-10-01T00:00:00Z", rationale: "Approved operating target for this process.",
        evidenceReference: "operating-plan-1", expectedRevision: 0 })
    }), operator.env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(operator.queries.some((sql) => sql.includes("INSERT INTO process_value_targets"))).toBe(false);
  });

  it("rejects cross-origin browser mutations before business data changes", async () => {
    const { env, queries } = environment();
    const response = await app.fetch(new Request("http://localhost/api/onboarding", {
      method: "PUT", headers: { origin: "https://evil.example", "content-type": "application/json", "x-workrr-user": "operator@example.com" }, body: "{}"
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("UPDATE tenants SET name"))).toBe(false);
  });

  it("accepts explicit loopback origins only in development", async () => {
    const { env } = environment();
    const response = await app.fetch(new Request("http://localhost/api/processes/process-1/autonomy-safety", {
      method: "PATCH", headers: {
        origin: "http://127.0.0.1:5173", "content-type": "application/json",
        "x-workrr-user": "operator@example.com"
      }, body: JSON.stringify({ enabled: true, minTerminalRuns: 5, successThreshold: 70,
        windowHours: 24, expectedRevision: 0 })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(200);
  });

  it("enforces route roles after authenticated membership lookup", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/notifications/policies/notify-execution", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ enabled: false })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("UPDATE notification_policies"))).toBe(false);
  });

  it("allows provider evidence inspection but prevents viewers from running external probes", async () => {
    const viewer = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/provider-acceptance/microsoft", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ capabilities: ["mail"] })
    }), viewer.env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("provider_acceptance_runs") &&
      sql.includes("INSERT"))).toBe(false);
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

  it("keeps lifecycle configuration and support exports within operating roles", async () => {
    const viewer = environment("viewer");
    const update = await app.fetch(new Request("http://localhost/api/lifecycle", {
      method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: "{}"
    }), viewer.env as never, executionCtx as never);
    expect(update.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("tenant_lifecycle_settings") &&
      sql.includes("INSERT"))).toBe(false);
    const bundle = await app.fetch(new Request("http://localhost/api/lifecycle/support-bundle", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), viewer.env as never, executionCtx as never);
    expect(bundle.status).toBe(403);
    const handoff = await app.fetch(new Request("http://localhost/api/lifecycle/handoff/operator_training", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ status: "confirmed", evidence: "Unauthorized evidence", revision: 0 })
    }), viewer.env as never, executionCtx as never);
    expect(handoff.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("tenant_handoff_checks") &&
      (sql.includes("INSERT") || sql.includes("UPDATE")))).toBe(false);
  });

  it("separates retirement requests from irreversible disposal approval", async () => {
    const viewer = environment("viewer");
    const request = await app.fetch(new Request("http://localhost/api/processes/process-1/retirement", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: "{}"
    }), viewer.env as never, executionCtx as never);
    expect(request.status).toBe(403);
    const builder = environment("builder");
    const approval = await app.fetch(new Request("http://localhost/api/processes/process-1/retirement/retirement-1", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ action: "approve" })
    }), builder.env as never, executionCtx as never);
    expect(approval.status).toBe(403);
    expect([...viewer.queries, ...builder.queries].some((sql) => sql.includes("UPDATE process_retirements"))).toBe(false);
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

  it("keeps approval coverage readable but restricts changes to decision roles", async () => {
    const consumer = environment("consumer");
    const hidden = await app.fetch(new Request("http://localhost/api/approval-delegations", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), consumer.env as never, executionCtx as never);
    expect(hidden.status).toBe(403);
    expect(consumer.queries.some((sql) => sql.includes("approval_delegations d"))).toBe(false);

    const viewer = environment("viewer");
    const read = await app.fetch(new Request("http://localhost/api/approval-delegations", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), viewer.env as never, executionCtx as never);
    expect(read.status).toBe(200);
    const change = await app.fetch(new Request("http://localhost/api/approval-delegations/member-1", {
      method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: "{}"
    }), viewer.env as never, executionCtx as never);
    expect(change.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("INSERT INTO approval_delegations"))).toBe(false);
  });

  it("restricts proposal correction to authorized decision roles", async () => {
    for (const role of ["builder", "operator", "viewer", "consumer"]) {
      const principal = environment(role);
      const response = await app.fetch(new Request(
        "http://localhost/api/approvals/approval-1/proposal", {
          method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
            "x-workrr-user": "operator@example.com" },
          body: JSON.stringify({ expectedRevision: 1, proposedOutput: "Unauthorized",
            reason: "Attempted unauthorized correction." })
        }), principal.env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(principal.queries.some((sql) => sql.includes("proposal_edited_at"))).toBe(false);
    }
  });

  it("keeps tenant-wide execution activity and redacted evidence exports out of consumer sessions", async () => {
    const consumer = environment("consumer");
    for (const path of [
      "/api/executions", "/api/executions/execution-1", "/api/executions/execution-1/evidence-export"
    ]) {
      const response = await app.fetch(new Request(`http://localhost${path}`, {
        headers: { "x-workrr-user": "operator@example.com" }
      }), consumer.env as never, executionCtx as never);
      expect(response.status).toBe(403);
    }
    expect(consumer.queries.some((sql) => sql.includes("FROM executions WHERE") ||
      sql.includes("FROM executions e JOIN"))).toBe(false);
  });

  it("keeps raw actor memory and its governance mutations within operating roles", async () => {
    for (const role of ["viewer", "reviewer", "consumer"]) {
      const principal = environment(role);
      const read = await app.fetch(new Request("http://localhost/api/executions/execution-1/memory", {
        headers: { "x-workrr-user": "operator@example.com" }
      }), principal.env as never, executionCtx as never);
      expect(read.status).toBe(403);
      const change = await app.fetch(new Request(
        "http://localhost/api/executions/execution-1/memory/turn-1", {
          method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
            "x-workrr-user": "operator@example.com" },
          body: JSON.stringify({ action: "delete", expectedRevision: 1, reason: "Privacy request" })
        }), principal.env as never, executionCtx as never);
      expect(change.status).toBe(403);
      expect(principal.queries.some((sql) => sql.includes("SELECT blueprint_id, execution_profile, instance_key"))).toBe(false);
    }
  });

  it("keeps recovery evidence out of consumer sessions and mutations away from viewers", async () => {
    const consumer = environment("consumer");
    const read = await app.fetch(new Request("http://localhost/api/recovery", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), consumer.env as never, executionCtx as never);
    expect(read.status).toBe(403);
    expect(consumer.queries.some((sql) => sql.includes("execution_recovery_tasks"))).toBe(false);

    const viewer = environment("viewer");
    const change = await app.fetch(new Request("http://localhost/api/recovery/recovery-1", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ action: "investigate", expectedRevision: 1, note: "Unauthorized change" })
    }), viewer.env as never, executionCtx as never);
    expect(change.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("UPDATE execution_recovery_tasks"))).toBe(false);
  });

  it("keeps shadow evidence out of consumer sessions and review changes away from viewers", async () => {
    const consumer = environment("consumer");
    const read = await app.fetch(new Request("http://localhost/api/shadow-reviews", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), consumer.env as never, executionCtx as never);
    expect(read.status).toBe(403);
    expect(consumer.queries.some((sql) => sql.includes("execution_shadow_reviews"))).toBe(false);

    const viewer = environment("viewer");
    const change = await app.fetch(new Request("http://localhost/api/shadow-reviews/execution-1", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ expectedRevision: 1, verdict: "match", actualOutcome: "Completed by staff." })
    }), viewer.env as never, executionCtx as never);
    expect(change.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("UPDATE execution_shadow_reviews"))).toBe(false);
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

  it("does not let a viewer acknowledge privileged administrator training", async () => {
    const viewer = environment("viewer");
    const response = await app.fetch(new Request(
      "http://localhost/api/help-center/modules/customer-administration/acknowledge", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ version: 1 })
      }), viewer.env as never, executionCtx as never);
    expect(response.status).toBe(400);
    expect(viewer.queries.some((sql) => sql.includes("INSERT OR IGNORE INTO learning_acknowledgements"))).toBe(false);
  });

  it("lets viewers request help but not manage the tenant support queue", async () => {
    const viewer = environment("viewer");
    const created = await app.fetch(new Request("http://localhost/api/help-center/requests", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ category: "how_to", priority: "normal", subject: "Need operating guidance",
        detail: "Please explain the safe next action for this process." })
    }), viewer.env as never, executionCtx as never);
    expect(created.status).toBe(201);
    expect(viewer.queries.some((sql) => sql.includes("INSERT INTO help_requests"))).toBe(true);

    const updated = await app.fetch(new Request("http://localhost/api/help-center/requests/request-1", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ expectedRevision: 1, status: "resolved", resolution: "Unauthorized resolution." })
    }), viewer.env as never, executionCtx as never);
    expect(updated.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("UPDATE help_requests"))).toBe(false);
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

  it("creates machine lifecycle evidence only through an active same-tenant rotation owner", async () => {
    const { env, queries } = environment("owner");
    const response = await app.fetch(new Request("http://localhost/api/service-principals", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({
        commonName: "customer-automation.access", displayName: "Customer automation", role: "operator",
        credentialExpiresAt: "2026-10-23T23:59:59.000Z", rotationOwner: "member-1"
      })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(201);
    const insert = queries.find((sql) => sql.includes("INSERT INTO access_service_principals"));
    expect(insert).toContain("FROM tenant_members m");
    expect(insert).toContain("m.tenant_id=?");
    expect(insert).toContain("credential_expires_at");
  });

  it("keeps immutable release comparison readable to audit roles but out of consumer sessions", async () => {
    const viewer = environment("viewer");
    const readable = await app.fetch(new Request(
      "http://localhost/api/processes/process-1/releases/release-2/diff",
      { headers: { "x-workrr-user": "operator@example.com" } }
    ), viewer.env as never, executionCtx as never);
    expect(readable.status).toBe(404);
    expect(viewer.queries.some((sql) => sql.includes("FROM process_releases r"))).toBe(true);

    const consumer = environment("consumer");
    const denied = await app.fetch(new Request(
      "http://localhost/api/processes/process-1/releases/release-2/diff",
      { headers: { "x-workrr-user": "operator@example.com" } }
    ), consumer.env as never, executionCtx as never);
    expect(denied.status).toBe(403);
    expect(consumer.queries.some((sql) => sql.includes("FROM process_releases r"))).toBe(false);
  });

  it("reserves terminal release decisions for owners and administrators", async () => {
    for (const role of ["builder", "operator", "reviewer", "viewer", "consumer"]) {
      const principal = environment(role);
      const response = await app.fetch(new Request(
        "http://localhost/api/processes/process-1/releases/release-2/review", {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/json",
            "x-workrr-user": "operator@example.com" },
          body: JSON.stringify({ decision: "approved", evidence: "Unauthorized release approval evidence." })
        }), principal.env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(principal.queries.some((sql) =>
        sql.includes("INSERT OR IGNORE INTO process_release_governance_reviews"))).toBe(false);
    }
  });

  it("keeps deployment-verification evidence out of consumer sessions", async () => {
    const consumer = environment("consumer");
    const response = await app.fetch(new Request("http://localhost/api/deployment-verification", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), consumer.env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(consumer.queries.some((sql) => sql.includes("FROM audit_events deleted"))).toBe(false);
  });

  it("restricts configuration backup and restore to owners and administrators", async () => {
    for (const role of ["builder", "operator", "reviewer", "viewer", "consumer"]) {
      const principal = environment(role);
      const preview = await app.fetch(new Request("http://localhost/api/configuration/restore/preview", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ package: {} })
      }), principal.env as never, executionCtx as never);
      const apply = await app.fetch(new Request("http://localhost/api/configuration/restore", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }), principal.env as never, executionCtx as never);
      expect(preview.status).toBe(403);
      expect(apply.status).toBe(403);
      expect(principal.queries.some((sql) => sql.includes("configuration_restores"))).toBe(false);
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

  it("allows catalog discovery but prevents viewers from installing solution packs", async () => {
    const { env, queries } = environment("viewer");
    const catalog = await app.fetch(new Request("http://localhost/api/solution-packs", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), env as never, executionCtx as never);
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get("cache-control")).toContain("no-store");
    const payload = await catalog.json() as { data: Array<{ id: string }> };
    expect(payload.data.map((item) => item.id)).toContain("customer-operations");

    const install = await app.fetch(new Request(
      "http://localhost/api/solution-packs/customer-operations/install", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ version: "1.0.0" })
      }), env as never, executionCtx as never);
    expect(install.status).toBe(403);
    expect(queries.some((sql) => sql.includes("INSERT INTO agent_blueprints"))).toBe(false);
  });

  it("rejects unknown solution pack versions before creating tenant data", async () => {
    const { env, queries } = environment("builder");
    const response = await app.fetch(new Request(
      "http://localhost/api/solution-packs/customer-operations/install", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ version: "99.0.0" })
      }), env as never, executionCtx as never);
    expect(response.status).toBe(404);
    expect(queries.some((sql) => sql.includes("INSERT INTO agent_blueprints"))).toBe(false);
  });

  it("prevents viewers from changing solution pack handoff evidence", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request(
      "http://localhost/api/processes/process-1/solution-pack-handoff/check-1", {
        method: "PATCH",
        headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ status: "complete", evidence: "Approved by the data owner.",
          expectedRevision: 1 })
      }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("UPDATE process_solution_pack_handoff_checks"))).toBe(false);
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

  it("prevents viewers from completing accountable governance reviews", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request(
      "http://localhost/api/governance/reviews/privacy_architecture/complete", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ evidenceReference: "ticket-123",
          notes: "Attempted review without accountable owner authority." }),
      }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("UPDATE tenant_governance_reviews"))).toBe(false);
  });

  it("prevents builders and viewers from activating a rollback", async () => {
    for (const role of ["builder", "viewer"]) {
      const principal = environment(role);
      const response = await app.fetch(new Request(
        "http://localhost/api/processes/process-1/releases/release-1/rollback", {
          method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
            "x-workrr-user": "operator@example.com" },
          body: JSON.stringify({ reason: "Unauthorized rollback.", confirmVersion: 1 })
        }), principal.env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(principal.queries.some((sql) => sql.includes("release_activations"))).toBe(false);
    }
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

  it("lets viewers preview retention but prevents policy changes and enforcement", async () => {
    for (const request of [
      new Request("http://localhost/api/governance/retention", {
        method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }),
      new Request("http://localhost/api/governance/retention/enforce", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      })
    ]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(request, env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("tenant_retention_controls SET") ||
        sql.includes("retention_enforcement_runs"))).toBe(false);
    }
  });

  it("requires exact confirmation before manual retention enforcement", async () => {
    const { env, queries } = environment("admin");
    const response = await app.fetch(new Request("http://localhost/api/governance/retention/enforce", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ confirmation: "run" })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(400);
    expect(queries.some((sql) => sql.includes("retention_enforcement_runs"))).toBe(false);
  });

  it("lets viewers inspect costs but prevents billing evidence imports and voids", async () => {
    for (const request of [
      new Request("http://localhost/api/usage/reconciliations", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: "{}"
      }),
      new Request("http://localhost/api/usage/reconciliations/billing-1/void", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" }, body: JSON.stringify({ reason: "Unauthorized correction" })
      })
    ]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(request, env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("INSERT INTO billing_reconciliations") ||
        sql.includes("UPDATE billing_reconciliations"))).toBe(false);
    }
  });

  it("prevents viewers from approving publisher signing-key rotations", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request(
      "http://localhost/api/evaluation-rubric-key-rotations/rotation-1/approved", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ overlapDays: 7, note: "Unauthorized rotation approval." })
      }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("rubric_key_rotations SET") ||
      sql.includes("superseded_by_trust_id"))).toBe(false);
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

  it("allows email-channel inspection but restricts routing changes to builders and owners", async () => {
    const viewer = environment("viewer");
    const read = await app.fetch(new Request("http://localhost/api/email-routes", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), viewer.env as never, executionCtx as never);
    expect(read.status).toBe(200);

    const change = await app.fetch(new Request("http://localhost/api/email-routes", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ name: "Unauthorized route", address: "mail@example.com",
        blueprintId: "process-1", allowedSenderDomains: ["example.com"] })
    }), viewer.env as never, executionCtx as never);
    expect(change.status).toBe(403);
    expect(viewer.queries.some((sql) => sql.includes("INSERT INTO inbound_email_routes"))).toBe(false);

    const consumer = environment("consumer");
    const consumerRead = await app.fetch(new Request("http://localhost/api/email-routes", {
      headers: { "x-workrr-user": "operator@example.com" }
    }), consumer.env as never, executionCtx as never);
    expect(consumerRead.status).toBe(403);
    expect(consumer.queries.some((sql) => sql.includes("FROM inbound_email_routes"))).toBe(false);
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

  it("prevents viewers from creating or changing organization-specific DLP phrases", async () => {
    for (const request of [
      new Request("http://localhost/api/dlp/custom-entries", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ label: "Sensitive project", term: "Project Falcon",
          action: "block", direction: "both" })
      }),
      new Request("http://localhost/api/dlp/custom-entries/entry-1", {
        method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ action: "audit", direction: "both", enabled: false, expectedRevision: 1 })
      }),
      new Request("http://localhost/api/dlp/preview", {
        method: "POST", headers: { origin: "http://localhost", "content-type": "application/json",
          "x-workrr-user": "operator@example.com" },
        body: JSON.stringify({ sample: "Project Falcon", direction: "input" })
      })
    ]) {
      const { env, queries } = environment("viewer");
      const response = await app.fetch(request, env as never, executionCtx as never);
      expect(response.status).toBe(403);
      expect(queries.some((sql) => sql.includes("custom_dlp_entries"))).toBe(false);
    }
  });

  it("prevents viewers from changing classification egress policy", async () => {
    const { env, queries } = environment("viewer");
    const response = await app.fetch(new Request("http://localhost/api/governance/data-egress/restricted", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json",
        "x-workrr-user": "operator@example.com" },
      body: JSON.stringify({ externalModelAllowed: true, externalToolAllowed: true, expectedRevision: 1 })
    }), env as never, executionCtx as never);
    expect(response.status).toBe(403);
    expect(queries.some((sql) => sql.includes("tenant_data_egress_policies"))).toBe(false);
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
