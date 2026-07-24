import { describe, expect, it } from "vitest";
import { getStudio } from "../src/studio";

function environment() {
  const DB = {
    prepare(sql: string) {
      const statement = {
        bind(..._values: unknown[]) { return statement; },
        async first() {
          if (sql.includes("SELECT * FROM agent_blueprints")) return {
            id: "process-1", tenant_id: "tenant-1", name: "Customer Operations",
            execution_profile: "conversation", model_profile: "balanced", autonomy: "approve",
            active_release_id: "release-v3", tools_json: "[]"
          };
          if (sql.includes("fallback_min_terminal_runs")) return {
            id: "process-1", tenant_id: "tenant-1", name: "Customer Operations", autonomy: "approve",
            fallback_enabled: 1, fallback_min_terminal_runs: 5, fallback_success_threshold: 70,
            fallback_window_hours: 24, safety_autonomy_cap: null, safety_cap_reason: null,
            safety_cap_trigger: null, safety_cap_evidence_id: null, safety_cap_triggered_at: null,
            safety_cap_cleared_at: null, safety_cap_revision: 0
          };
          if (sql.includes("COUNT(*) terminal_runs")) return { terminal_runs: 0, completed_runs: 0 };
          if (sql.includes("SELECT p.* FROM prompt_releases")) return {
            id: "prompt-v3", system_prompt: "Current", instructions_json: "[]", guardrails_json: "[]"
          };
          if (sql.includes("baseline_configured")) return {
            id: "process-1", baseline_configured: 1, target_configured: 1,
            target_review_due_at: "2027-01-01T00:00:00.000Z"
          };
          return null;
        },
        async all() {
          if (sql.includes("FROM process_releases") && sql.includes("ORDER BY version DESC")) return {
            results: [{ id: "release-v3", version: 3, status: "published", tool_policy_json: "[]" }]
          };
          if (sql.includes("SELECT ar.effective_release_id")) return { results: [
            { release_id: "release-v3", version: 3, status: "published", actor_count: 4 },
            { release_id: "release-v2", version: 2, status: "retired", actor_count: 2 },
            { release_id: null, version: null, status: null, actor_count: 1 }
          ] };
          if (sql.includes("SELECT ar.*, pr.version")) return { results: [
            { execution_id: "execution-current", instance_key: "process-1:thread:one",
              effective_release_id: "release-v3", version: 3, last_active_at: "2026-07-23T00:00:00Z" },
            { execution_id: "execution-pinned", instance_key: "process-1:thread:two",
              effective_release_id: "release-v2", version: 2, last_active_at: "2026-07-22T00:00:00Z" }
          ] };
          return { results: [] };
        }
      };
      return statement;
    }
  };
  return { DB } as never;
}

describe("Process Studio durable actor adoption", () => {
  it("summarizes current, pinned, and unattributed actor cohorts without DO enumeration", async () => {
    const studio = await getStudio(environment(), "tenant-1", "process-1");
    expect(studio?.actorAdoption).toMatchObject({
      supported: true, knownActors: 7, currentActors: 4, pinnedPreviousActors: 2, unattributedActors: 1
    });
    expect(studio?.actorAdoption.actors).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor_ref: "actor-executioncur", actor_type: "conversation",
        actor_isolation: "legacy_guarded_v1", state: "current" }),
      expect.objectContaining({ actor_ref: "actor-executionpin", state: "pinned_previous" })
    ]));
    expect(JSON.stringify(studio?.actorAdoption.actors)).not.toContain("process-1:thread");
    expect(studio?.launchReadiness).toMatchObject({
      ready: true, baselineConfigured: true, targetConfigured: true, targetCurrent: true
    });
  });
});
