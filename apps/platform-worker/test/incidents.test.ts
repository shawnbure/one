import { describe, expect, it } from "vitest";
import { createIncident, setProcessOperatingMode, setTenantOperatingMode, transitionIncident } from "../src/incidents";

function incidentEnvironment(options: { tenantMode?: string; processMode?: string; incidentStatus?: string } = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  let tenantMode = options.tenantMode ?? "active";
  let incidentStatus = options.incidentStatus ?? "open";
  const processMode = options.processMode ?? "active";
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          if (sql.includes("FROM tenant_operating_controls")) return { mode: tenantMode, incident_id: tenantMode === "emergency_stop" ? "incident-1" : null };
          if (sql.includes("SELECT name, operating_mode")) return { name: "Invoice Intake", operating_mode: processMode };
          if (sql.includes("SELECT id FROM agent_blueprints")) return { id: "process-1" };
          if (sql.includes("FROM incidents")) return { id: "incident-1", status: incidentStatus };
          return null;
        },
        async run() {
          writes.push({ sql, values });
          if (sql.includes("tenant_operating_controls")) tenantMode = String(values[1]);
          if (sql.includes("UPDATE incidents SET status")) incidentStatus = String(values[0]);
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  return { env: { DB } as never, writes, state: () => ({ tenantMode, incidentStatus }) };
}

describe("incident containment and recovery", () => {
  it("opens a tenant-scoped incident with timeline evidence", async () => {
    const { env, writes } = incidentEnvironment();
    const result = await createIncident(env, "tenant-1", "admin-1", {
      title: "Unexpected outbound behavior", severity: "high", blueprintId: "process-1", impact: "Three drafts quarantined"
    });
    expect(result.status).toBe("open");
    expect(writes.some(({ sql, values }) => sql.includes("INSERT INTO incidents") && values.includes("tenant-1"))).toBe(true);
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO incident_events"))).toBe(true);
  });

  it("automatically links an incident when tenant emergency stop is activated", async () => {
    const { env, writes, state } = incidentEnvironment();
    const result = await setTenantOperatingMode(env, "tenant-1", "admin-1", {
      mode: "emergency_stop", reason: "Potential data disclosure"
    });
    expect(result.incidentId).toBeTruthy();
    expect(state().tenantMode).toBe("emergency_stop");
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO incidents"))).toBe(true);
  });

  it("blocks tenant recovery until the linked incident is contained", async () => {
    const { env } = incidentEnvironment({ tenantMode: "emergency_stop", incidentStatus: "investigating" });
    await expect(setTenantOperatingMode(env, "tenant-1", "admin-1", {
      mode: "active", reason: "Attempt recovery", incidentId: "incident-1"
    })).rejects.toThrow("Contain or resolve");
  });

  it("allows recovery after containment and records the reason", async () => {
    const { env, state } = incidentEnvironment({ tenantMode: "emergency_stop", incidentStatus: "contained" });
    await setTenantOperatingMode(env, "tenant-1", "admin-1", {
      mode: "active", reason: "Connector isolated and evidence preserved", incidentId: "incident-1"
    });
    expect(state().tenantMode).toBe("active");
  });

  it("enforces valid incident lifecycle transitions", async () => {
    const { env, state } = incidentEnvironment({ incidentStatus: "open" });
    await transitionIncident(env, "tenant-1", "operator-1", "incident-1", {
      status: "investigating", note: "Assigned and reviewing traces"
    });
    expect(state().incidentStatus).toBe("investigating");
    await expect(transitionIncident(env, "tenant-1", "operator-1", "incident-1", {
      status: "closed", note: "Skip controls"
    })).rejects.toThrow("cannot move");
  });

  it("blocks process recovery when a supplied incident is not contained", async () => {
    const { env } = incidentEnvironment({ processMode: "emergency_stop", incidentStatus: "open" });
    await expect(setProcessOperatingMode(env, "tenant-1", "admin-1", "process-1", {
      mode: "active", reason: "Recover", incidentId: "incident-1"
    })).rejects.toThrow("Contain or resolve");
  });
});
