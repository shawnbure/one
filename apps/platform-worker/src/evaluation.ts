import type { Env } from "./types";

export async function runEvaluation(env: Env, tenantId: string, actorId: string, scenarioId: string, requestedReleaseId?: string) {
  const scenario = await env.DB.prepare(`SELECT e.*, b.active_release_id, b.operating_mode, b.prompt_release_id
    FROM evaluation_scenarios e JOIN agent_blueprints b ON b.id = e.blueprint_id AND b.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?`).bind(scenarioId, tenantId).first<Record<string, string | number | null>>();
  if (!scenario) throw new Error("Evaluation scenario not found");
  const releaseId = requestedReleaseId || String(scenario.active_release_id || "");
  const release = releaseId ? await env.DB.prepare(`SELECT r.id, r.prompt_release_id, p.system_prompt, p.guardrails_json
    FROM process_releases r JOIN prompt_releases p ON p.id = r.prompt_release_id
    WHERE r.id = ? AND r.tenant_id = ? AND r.blueprint_id = ?`).bind(releaseId, tenantId, String(scenario.blueprint_id)).first<Record<string, string>>() : null;
  const guardrails = release ? parseList(release.guardrails_json ?? "[]") : [];
  const checks = [
    { check: "release_belongs_to_process", passed: Boolean(release) },
    { check: "system_prompt_defined", passed: Boolean(release?.system_prompt?.trim()) },
    { check: "guardrails_defined", passed: guardrails.length > 0 },
    { check: "assertions_defined", passed: Number(scenario.assertion_count) > 0 }
  ];
  const assertionCount = Math.max(Number(scenario.assertion_count), checks.length);
  const failedControls = checks.filter((check) => !check.passed).length;
  const passedAssertions = Math.max(0, assertionCount - failedControls);
  const status = failedControls === 0 ? "passing" : "failing";
  const runId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO evaluation_runs
      (id, tenant_id, scenario_id, blueprint_id, release_id, status, passed_assertions, assertion_count, evidence_json, triggered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(runId, tenantId, scenario.id, scenario.blueprint_id,
        releaseId || null, status, passedAssertions, assertionCount, JSON.stringify(checks), actorId),
    env.DB.prepare("UPDATE evaluation_scenarios SET status = ?, last_run_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
      .bind(status, scenario.id, tenantId),
    env.DB.prepare(`INSERT INTO audit_events (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
      VALUES (?, ?, ?, 'evaluation.run', 'evaluation_scenario', ?, ?)`).bind(crypto.randomUUID(), tenantId, actorId, scenario.id,
        JSON.stringify({ runId, releaseId, status, passedAssertions, assertionCount }))
  ]);
  return { id: runId, scenarioId, releaseId, status, passedAssertions, assertionCount, evidence: checks };
}

export async function evaluateReleaseGate(env: Env, tenantId: string, actorId: string, blueprintId: string, releaseId: string) {
  const scenarios = await env.DB.prepare("SELECT id FROM evaluation_scenarios WHERE tenant_id = ? AND blueprint_id = ? ORDER BY id")
    .bind(tenantId, blueprintId).all<{ id: string }>();
  if (!scenarios.results.length) throw new Error("At least one evaluation scenario is required before publication");
  const results = [];
  for (const scenario of scenarios.results) results.push(await runEvaluation(env, tenantId, actorId, scenario.id, releaseId));
  const status = results.every((result) => result.status === "passing") ? "passing" : "failing";
  await env.DB.prepare("UPDATE process_releases SET evaluation_status = ?, evaluated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND blueprint_id = ?")
    .bind(status, releaseId, tenantId, blueprintId).run();
  if (status !== "passing") throw new Error(`Release evaluation gate failed (${results.filter((result) => result.status === "passing").length}/${results.length} scenarios passing)`);
  return results;
}

function parseList(value: string): string[] { try { const result = JSON.parse(value); return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
