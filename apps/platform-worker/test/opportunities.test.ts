import { describe, expect, it } from "vitest";
import { createOpportunity, OpportunityRevisionConflict, qualifyOpportunity, scoreOpportunity,
  updateOpportunity } from "../src/opportunities";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { opportunity?: Record<string, unknown> | null; template?: boolean }) {
  const writes: Write[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM process_templates")) return options?.template === false ? null : { id: "template-document-intake" };
          if (sql.includes("FROM process_opportunities")) return options?.opportunity === undefined
            ? { status: "captured" } : options.opportunity;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
  return { env: { DB } as never, writes };
}

const candidate = {
  name: "Vendor invoice intake",
  purpose: "Reduce manual invoice entry while keeping finance exceptions under review.",
  businessOwner: "Finance Operations",
  department: "Finance",
  currentSteps: "Open invoice; key fields; validate totals.",
  systems: ["Shared mailbox", "Accounting"],
  exceptions: ["Unknown vendor", "Total mismatch"],
  volumePerMonth: 400,
  minutesPerItem: 15,
  hourlyCost: 45,
  errorRate: .08,
  riskLevel: "medium" as const,
  dataClassification: "confidential" as const,
  externalAction: true,
  humanJudgment: "some" as const,
  recommendedTemplateId: "template-document-intake"
};

describe("process opportunity discovery", () => {
  it("scores business impact separately from implementation feasibility", () => {
    const straightforward = scoreOpportunity({ ...candidate, systems: ["Inbox"], exceptions: [],
      riskLevel: "low", dataClassification: "internal", externalAction: false, humanJudgment: "low" });
    const complex = scoreOpportunity(candidate);
    expect(straightforward.impactScore).toBe(complex.impactScore);
    expect(straightforward.feasibilityScore).toBeGreaterThan(complex.feasibilityScore);
    expect(complex.priorityScore).toBe(Math.round(complex.impactScore * .6 + complex.feasibilityScore * .4));
  });

  it("captures normalized tenant-scoped evidence and an audit event", async () => {
    const { env, writes } = environment();
    const result = await createOpportunity(env, "tenant-1", "actor-1", candidate);
    expect(result.status).toBe("captured");
    const insert = writes.find(({ sql }) => sql.includes("INSERT INTO process_opportunities"));
    expect(insert?.bindings).toContain("tenant-1");
    expect(insert?.bindings).toContain(JSON.stringify(candidate.systems));
    expect(JSON.stringify(writes)).toContain("opportunity.captured");
  });

  it("rejects unknown templates before creating backlog records", async () => {
    const { env, writes } = environment({ template: false });
    await expect(createOpportunity(env, "tenant-1", "actor-1", candidate)).rejects.toThrow("template");
    expect(writes).toHaveLength(0);
  });

  it("records qualification evidence but cannot reopen a converted opportunity", async () => {
    const qualified = environment();
    await expect(qualifyOpportunity(qualified.env, "tenant-1", "builder-1", "opp-1", {
      status: "qualified", qualificationNote: "Validated with the finance owner."
    })).resolves.toMatchObject({ status: "qualified" });
    expect(JSON.stringify(qualified.writes)).toContain("opportunity.qualified");

    const converted = environment({ opportunity: { status: "converted" } });
    await expect(qualifyOpportunity(converted.env, "tenant-1", "builder-1", "opp-1", {
      status: "declined"
    })).rejects.toThrow("cannot be requalified");
    expect(converted.writes).toHaveLength(0);
  });

  it("creates a new immutable revision and resets prior qualification after evidence changes", async () => {
    const revised = environment({ opportunity: { revision: 2, status: "qualified" } });
    const result = await updateOpportunity(revised.env, "tenant-1", "operator-1", "opp-1", 2,
      "Finance confirmed a higher monthly volume.", { ...candidate, volumePerMonth: 600 });
    expect(result).toMatchObject({ revision: 3, status: "captured" });
    expect(revised.writes.some(({ sql, bindings }) => sql.includes("status='captured'") &&
      sql.includes("qualification_note=NULL") && bindings.includes(3))).toBe(true);
    expect(revised.writes.some(({ sql, bindings }) => sql.includes("INSERT INTO opportunity_revisions") &&
      bindings.includes("Finance confirmed a higher monthly volume."))).toBe(true);
  });

  it("rejects stale edits with an explicit revision conflict", async () => {
    const stale = environment({ opportunity: { revision: 3, status: "captured" } });
    await expect(updateOpportunity(stale.env, "tenant-1", "operator-1", "opp-1", 2,
      "Stale correction", candidate)).rejects.toBeInstanceOf(OpportunityRevisionConflict);
    expect(stale.writes).toHaveLength(0);
  });
});
