import { modelProfiles, type PromptBundle } from "@workrr/contracts";
import { runModel } from "./model";
import type { Env } from "./types";
import { assertBudgetAvailable } from "./usage";

type Assertion =
  | { type: "contains_all" | "contains_any" | "not_contains_any"; value: string[] }
  | { type: "max_chars"; value: number }
  | { type: "valid_json"; value: true };

interface EvaluationCase {
  id: string;
  name: string;
  input_text: string;
  assertions_json: string;
  weight: number;
}

interface ReleaseRow {
  id: string;
  prompt_release_id: string;
  model_profile: string;
  version: number;
  system_prompt: string;
  instructions_json: string;
  guardrails_json: string;
  checksum: string;
  published_at: string;
}

export async function runEvaluation(env: Env, tenantId: string, actorId: string, scenarioId: string, requestedReleaseId?: string,
  requestedRunId?: string, requestedModelProfile?: string, updateScenario = true) {
  await assertBudgetAvailable(env, tenantId);
  const scenario = await env.DB.prepare(`SELECT e.*, b.active_release_id, b.operating_mode, b.prompt_release_id
    FROM evaluation_scenarios e JOIN agent_blueprints b ON b.id = e.blueprint_id AND b.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?`).bind(scenarioId, tenantId).first<Record<string, string | number | null>>();
  if (!scenario) throw new Error("Evaluation scenario not found");
  const releaseId = requestedReleaseId || String(scenario.active_release_id || "");
  const release = releaseId ? await env.DB.prepare(`SELECT r.id, r.prompt_release_id, r.model_profile, p.version,
    p.system_prompt, p.instructions_json, p.guardrails_json, p.checksum, p.published_at
    FROM process_releases r JOIN prompt_releases p ON p.id = r.prompt_release_id
    WHERE r.id = ? AND r.tenant_id = ? AND r.blueprint_id = ?`).bind(releaseId, tenantId, String(scenario.blueprint_id)).first<ReleaseRow>() : null;
  const cases = await env.DB.prepare(`SELECT id, name, input_text, assertions_json, weight FROM evaluation_cases
    WHERE tenant_id = ? AND scenario_id = ? AND enabled = 1 ORDER BY created_at, id LIMIT 10`).bind(tenantId, scenarioId).all<EvaluationCase>();
  const guardrails = release ? parseList(release.guardrails_json) : [];
  const modelProfile = requestedModelProfile && requestedModelProfile in modelProfiles ? requestedModelProfile : release?.model_profile;
  const controls = [
    { check: "release_belongs_to_process", passed: Boolean(release) },
    { check: "system_prompt_defined", passed: Boolean(release?.system_prompt?.trim()) },
    { check: "guardrails_defined", passed: guardrails.length > 0 },
    { check: "golden_cases_defined", passed: cases.results.length > 0 }
  ];
  const runId = requestedRunId ?? crypto.randomUUID();
  const caseResults: Array<{
    id: string; caseId: string; name: string; status: "passing" | "failing" | "error"; passed: number; total: number;
    output: string | null; model: string | null; inputTokens: number; outputTokens: number; totalTokens: number;
    cost: number; latencyMs: number; evidence: Array<{ assertion: Assertion["type"]; passed: boolean; detail: string }>; error: string | null; weight: number;
  }> = [];
  const rates = new Map<string, { input: number; output: number }>();
  if (release) {
    const prompt: PromptBundle = {
      releaseId: release.prompt_release_id,
      blueprintId: String(scenario.blueprint_id),
      version: Number(release.version),
      systemPrompt: release.system_prompt,
      instructions: parseList(release.instructions_json),
      guardrails,
      checksum: release.checksum,
      publishedAt: release.published_at
    };
    for (const item of cases.results) {
      const started = performance.now();
      try {
        const result = await runModel(env, modelProfile!, prompt, item.input_text,
          `evaluation:${release.id}:${modelProfile}:${item.id}`);
        const assertions = parseAssertions(item.assertions_json);
        const evidence = assertions.map((assertion) => evaluateAssertion(result.output, assertion));
        const passed = evidence.filter((check) => check.passed).length;
        if (!rates.has(result.model)) {
          const rate = await env.DB.prepare(`SELECT input_usd_per_million, output_usd_per_million
            FROM model_catalog WHERE model_id = ?`).bind(result.model).first<{ input_usd_per_million: number; output_usd_per_million: number }>();
          rates.set(result.model, { input: Number(rate?.input_usd_per_million ?? 0), output: Number(rate?.output_usd_per_million ?? 0) });
        }
        const rate = rates.get(result.model)!;
        caseResults.push({
          id: `${runId}:${item.id}`, caseId: item.id, name: item.name, status: passed === assertions.length && assertions.length > 0 ? "passing" : "failing",
          passed, total: assertions.length, output: result.output.slice(0, 2000), model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: result.totalTokens,
          cost: (result.inputTokens * rate.input + result.outputTokens * rate.output) / 1_000_000,
          latencyMs: Math.round(performance.now() - started), evidence, error: null, weight: Number(item.weight) || 1
        });
      } catch (error) {
        caseResults.push({
          id: `${runId}:${item.id}`, caseId: item.id, name: item.name, status: "error", passed: 0,
          total: Math.max(1, parseAssertions(item.assertions_json).length), output: null, model: null,
          inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, latencyMs: Math.round(performance.now() - started),
          evidence: [], error: (error instanceof Error ? error.message : String(error)).slice(0, 500), weight: Number(item.weight) || 1
        });
      }
    }
  }
  const controlPassed = controls.filter((check) => check.passed).length;
  const controlScore = controlPassed / controls.length;
  const weightedTotal = 1 + caseResults.reduce((sum, item) => sum + item.weight, 0);
  const weightedPassed = controlScore + caseResults.reduce((sum, item) => sum + item.weight * (item.total ? item.passed / item.total : 0), 0);
  const score = weightedTotal ? weightedPassed / weightedTotal : 0;
  const assertionCount = controls.length + caseResults.reduce((sum, item) => sum + item.total, 0);
  const passedAssertions = controlPassed + caseResults.reduce((sum, item) => sum + item.passed, 0);
  const threshold = Number(scenario.gate_threshold ?? 1);
  const status = score >= threshold && caseResults.every((item) => item.status !== "error") ? "passing" : "failing";
  const inputTokens = caseResults.reduce((sum, item) => sum + item.inputTokens, 0);
  const outputTokens = caseResults.reduce((sum, item) => sum + item.outputTokens, 0);
  const totalTokens = caseResults.reduce((sum, item) => sum + item.totalTokens, 0);
  const estimatedCost = caseResults.reduce((sum, item) => sum + item.cost, 0);
  const evidence = { controls, cases: caseResults.map((item) => ({
    caseId: item.caseId, name: item.name, status: item.status, passed: item.passed, total: item.total, latencyMs: item.latencyMs, error: item.error
  })) };
  const statements = [
    env.DB.prepare(`INSERT INTO evaluation_runs
      (id, tenant_id, scenario_id, blueprint_id, release_id, status, passed_assertions, assertion_count, evidence_json,
       triggered_by, score, case_count, input_tokens, output_tokens, total_tokens, estimated_cost_usd, model_profile)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, passed_assertions = excluded.passed_assertions,
        assertion_count = excluded.assertion_count, evidence_json = excluded.evidence_json, score = excluded.score,
        case_count = excluded.case_count, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        total_tokens = excluded.total_tokens, estimated_cost_usd = excluded.estimated_cost_usd,
        model_profile = excluded.model_profile`).bind(runId, tenantId, scenario.id, scenario.blueprint_id,
        releaseId || null, status, passedAssertions, assertionCount, JSON.stringify(evidence), actorId, score, caseResults.length,
        inputTokens, outputTokens, totalTokens, estimatedCost, modelProfile ?? null),
    ...caseResults.map((item) => env.DB.prepare(`INSERT INTO evaluation_case_results
      (id, tenant_id, run_id, case_id, release_id, status, passed_assertions, assertion_count, output_preview, model,
       input_tokens, output_tokens, total_tokens, estimated_cost_usd, latency_ms, evidence_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, passed_assertions = excluded.passed_assertions,
        assertion_count = excluded.assertion_count, output_preview = excluded.output_preview, model = excluded.model,
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, total_tokens = excluded.total_tokens,
        estimated_cost_usd = excluded.estimated_cost_usd, latency_ms = excluded.latency_ms,
        evidence_json = excluded.evidence_json, error = excluded.error`).bind(item.id, tenantId, runId, item.caseId, releaseId,
        item.status, item.passed, item.total, item.output, item.model, item.inputTokens, item.outputTokens, item.totalTokens,
        item.cost, item.latencyMs, JSON.stringify(item.evidence), item.error)),
    ...(updateScenario ? [env.DB.prepare("UPDATE evaluation_scenarios SET status = ?, assertion_count = ?, last_run_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
      .bind(status, assertionCount, scenario.id, tenantId)] : []),
    env.DB.prepare(`INSERT OR REPLACE INTO audit_events (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
      VALUES (?, ?, ?, 'evaluation.run', 'evaluation_scenario', ?, ?)`).bind(`audit-evaluation-${runId}`, tenantId, actorId, scenario.id,
        JSON.stringify({ runId, releaseId, modelProfile, status, score, threshold, passedAssertions, assertionCount, caseCount: caseResults.length }))
  ];
  await env.DB.batch(statements);
  return { id: runId, scenarioId, releaseId, modelProfile, status, score, threshold, passedAssertions, assertionCount,
    caseCount: caseResults.length, inputTokens, outputTokens, totalTokens, estimatedCostUsd: estimatedCost, evidence };
}

export async function getEvaluationDetail(env: Env, tenantId: string, scenarioId: string) {
  const [scenario, cases, runs] = await Promise.all([
    env.DB.prepare(`SELECT e.*, b.name process_name, b.active_release_id FROM evaluation_scenarios e
      JOIN agent_blueprints b ON b.id = e.blueprint_id AND b.tenant_id = e.tenant_id
      WHERE e.id = ? AND e.tenant_id = ?`).bind(scenarioId, tenantId).first(),
    env.DB.prepare(`SELECT id, name, input_text, assertions_json, weight, enabled, source, redaction_json, created_at
      FROM evaluation_cases WHERE tenant_id = ? AND scenario_id = ? ORDER BY created_at, id`).bind(tenantId, scenarioId).all(),
    env.DB.prepare(`SELECT r.id, r.release_id, r.model_profile, r.status, r.score, r.passed_assertions, r.assertion_count, r.case_count,
      r.input_tokens, r.output_tokens, r.total_tokens, r.estimated_cost_usd, r.triggered_by, r.created_at,
      pr.version release_version FROM evaluation_runs r LEFT JOIN process_releases pr ON pr.id = r.release_id
      WHERE r.tenant_id = ? AND r.scenario_id = ? ORDER BY r.created_at DESC LIMIT 12`).bind(tenantId, scenarioId).all()
  ]);
  if (!scenario) return null;
  const runIds = runs.results.map((row) => String((row as Record<string, unknown>).id));
  const results = runIds.length ? await env.DB.prepare(`SELECT id, run_id, case_id, status, passed_assertions, assertion_count,
    output_preview, model, total_tokens, estimated_cost_usd, latency_ms, evidence_json, error
    FROM evaluation_case_results WHERE tenant_id = ? AND run_id IN (${runIds.map(() => "?").join(",")})
    ORDER BY created_at, case_id`).bind(tenantId, ...runIds).all() : { results: [] };
  const [suites, reviews, modelTrials] = await Promise.all([
    env.DB.prepare(`SELECT id, release_id, evaluation_run_id, mode, status, score, error, started_at, completed_at, created_at
      FROM evaluation_suite_runs WHERE tenant_id = ? AND scenario_id = ? ORDER BY created_at DESC LIMIT 20`)
      .bind(tenantId, scenarioId).all(),
    runIds.length ? env.DB.prepare(`SELECT h.id, h.case_result_id, h.reviewer_id, h.score, h.verdict, h.notes, h.updated_at
      FROM evaluation_human_reviews h JOIN evaluation_case_results c ON c.id = h.case_result_id
      WHERE h.tenant_id = ? AND c.run_id IN (${runIds.map(() => "?").join(",")}) ORDER BY h.updated_at DESC`)
      .bind(tenantId, ...runIds).all() : Promise.resolve({ results: [] }),
    env.DB.prepare(`SELECT id, release_id, baseline_profile, candidate_profile, status, baseline_score, candidate_score,
      baseline_cost_usd, candidate_cost_usd, baseline_tokens, candidate_tokens, recommendation, error, completed_at, created_at
      FROM evaluation_model_trials WHERE tenant_id = ? AND scenario_id = ? ORDER BY created_at DESC LIMIT 12`)
      .bind(tenantId, scenarioId).all()
  ]);
  return { scenario, cases: cases.results, runs: runs.results, caseResults: results.results,
    suites: suites.results, humanReviews: reviews.results, modelTrials: modelTrials.results,
    modelProfiles: Object.entries(modelProfiles).map(([id, profile]) => ({ id, ...profile })) };
}

export async function createEvaluationCase(env: Env, tenantId: string, scenarioId: string, input: {
  name?: string; input?: string; expectedPhrases?: string[]; prohibitedPhrases?: string[]; format?: "text" | "json"; maxChars?: number;
}, source = "curated") {
  const scenario = await env.DB.prepare("SELECT id FROM evaluation_scenarios WHERE id = ? AND tenant_id = ?")
    .bind(scenarioId, tenantId).first();
  if (!scenario) throw new Error("Evaluation scenario not found");
  if (!input.name?.trim() || !input.input?.trim()) throw new Error("Case name and anonymized input are required");
  const assertions: Assertion[] = [];
  const expected = cleanPhrases(input.expectedPhrases);
  const prohibited = cleanPhrases(input.prohibitedPhrases);
  if (expected.length) assertions.push({ type: "contains_all", value: expected });
  if (prohibited.length) assertions.push({ type: "not_contains_any", value: prohibited });
  if (input.format === "json") assertions.push({ type: "valid_json", value: true });
  if (Number.isFinite(input.maxChars) && Number(input.maxChars) > 0 && Number(input.maxChars) <= 50_000) {
    assertions.push({ type: "max_chars", value: Number(input.maxChars) });
  }
  if (!assertions.length) throw new Error("At least one expected, prohibited, JSON, or length assertion is required");
  const count = await env.DB.prepare("SELECT COUNT(*) count FROM evaluation_cases WHERE tenant_id = ? AND scenario_id = ?")
    .bind(tenantId, scenarioId).first<{ count: number }>();
  if (Number(count?.count) >= 10) throw new Error("Evaluation scenarios support up to 10 synchronous curated cases");
  const id = crypto.randomUUID();
  const redacted = redactSensitiveText(input.input.trim().slice(0, 20_000));
  await env.DB.prepare(`INSERT INTO evaluation_cases
    (id, tenant_id, scenario_id, name, input_text, assertions_json, source, redaction_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, scenarioId, input.name.trim(), redacted.text, JSON.stringify(assertions), source,
      JSON.stringify({ count: redacted.count, types: redacted.types })).run();
  const rows = await env.DB.prepare("SELECT assertions_json FROM evaluation_cases WHERE tenant_id = ? AND scenario_id = ? AND enabled = 1")
    .bind(tenantId, scenarioId).all<{ assertions_json: string }>();
  const assertionCount = 4 + rows.results.reduce((sum, row) => sum + parseAssertions(row.assertions_json).length, 0);
  await env.DB.prepare("UPDATE evaluation_scenarios SET assertion_count = ?, status = 'not_run' WHERE id = ? AND tenant_id = ?")
    .bind(assertionCount, scenarioId, tenantId).run();
  return { id, assertionCount, assertions, redaction: { count: redacted.count, types: redacted.types } };
}

export async function queueModelTrial(env: Env, tenantId: string, actorId: string, scenarioId: string, candidateProfile: string,
  requestedReleaseId?: string) {
  await assertBudgetAvailable(env, tenantId);
  if (!(candidateProfile in modelProfiles)) throw new Error("Select a supported Cloudflare model profile");
  const scenario = await env.DB.prepare(`SELECT e.id, e.blueprint_id, b.active_release_id FROM evaluation_scenarios e
    JOIN agent_blueprints b ON b.id = e.blueprint_id AND b.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?`).bind(scenarioId, tenantId)
    .first<{ id: string; blueprint_id: string; active_release_id: string | null }>();
  if (!scenario) throw new Error("Evaluation scenario not found");
  const releaseId = requestedReleaseId || scenario.active_release_id;
  if (!releaseId) throw new Error("Select or publish a process release before comparing models");
  const release = await env.DB.prepare(`SELECT id, model_profile FROM process_releases
    WHERE id = ? AND tenant_id = ? AND blueprint_id = ?`).bind(releaseId, tenantId, scenario.blueprint_id)
    .first<{ id: string; model_profile: string }>();
  if (!release) throw new Error("Release does not belong to this process");
  if (release.model_profile === candidateProfile) throw new Error("Choose a candidate profile different from the release baseline");
  const trialId = crypto.randomUUID();
  const baselineRunId = crypto.randomUUID();
  const candidateRunId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO evaluation_model_trials
    (id, tenant_id, scenario_id, blueprint_id, release_id, workflow_instance_id, baseline_profile, candidate_profile,
     baseline_run_id, candidate_run_id, triggered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(trialId, tenantId, scenarioId, scenario.blueprint_id, releaseId, trialId, release.model_profile, candidateProfile,
      baselineRunId, candidateRunId, actorId).run();
  try {
    await env.EVALUATION_WORKFLOW.create({
      id: trialId as `${string}-${string}-${string}-${string}-${string}`,
      params: { kind: "model_comparison", tenantId, actorId, trialId, scenarioId, releaseId,
        baselineProfile: release.model_profile, candidateProfile, baselineRunId, candidateRunId }
    });
  } catch (error) {
    await env.DB.prepare(`UPDATE evaluation_model_trials SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?`).bind((error instanceof Error ? error.message : String(error)).slice(0, 500), trialId, tenantId).run();
    throw error;
  }
  return { id: trialId, status: "queued", releaseId, baselineProfile: release.model_profile, candidateProfile };
}

export async function queueEvaluationSuite(env: Env, tenantId: string, actorId: string, scenarioId: string,
  requestedReleaseId?: string, mode: "regression" | "shadow" = "regression") {
  await assertBudgetAvailable(env, tenantId);
  const scenario = await env.DB.prepare(`SELECT e.id, e.blueprint_id, b.active_release_id FROM evaluation_scenarios e
    JOIN agent_blueprints b ON b.id = e.blueprint_id AND b.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?`).bind(scenarioId, tenantId)
    .first<{ id: string; blueprint_id: string; active_release_id: string | null }>();
  if (!scenario) throw new Error("Evaluation scenario not found");
  const releaseId = requestedReleaseId || scenario.active_release_id;
  if (!releaseId) throw new Error("Select or publish a process release before starting a suite");
  const release = await env.DB.prepare("SELECT id FROM process_releases WHERE id = ? AND tenant_id = ? AND blueprint_id = ?")
    .bind(releaseId, tenantId, scenario.blueprint_id).first();
  if (!release) throw new Error("Release does not belong to this process");
  const suiteId = crypto.randomUUID();
  const evaluationRunId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO evaluation_suite_runs
    (id, tenant_id, scenario_id, blueprint_id, release_id, workflow_instance_id, mode, triggered_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(suiteId, tenantId, scenarioId, scenario.blueprint_id, releaseId, suiteId, mode, actorId).run();
  try {
    await env.EVALUATION_WORKFLOW.create({
      id: suiteId as `${string}-${string}-${string}-${string}-${string}`,
      params: { tenantId, actorId, suiteId, scenarioId, releaseId, evaluationRunId }
    });
  } catch (error) {
    await env.DB.prepare("UPDATE evaluation_suite_runs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), suiteId, tenantId).run();
    throw error;
  }
  return { id: suiteId, workflowInstanceId: suiteId, evaluationRunId, status: "queued", releaseId, mode };
}

export async function reviewEvaluationResult(env: Env, tenantId: string, reviewerId: string, caseResultId: string, input: {
  score?: number; verdict?: "acceptable" | "needs_work" | "unsafe"; notes?: string;
}) {
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 5 ||
      !input.verdict || !["acceptable", "needs_work", "unsafe"].includes(input.verdict)) {
    throw new Error("A 1–5 score and valid verdict are required");
  }
  const result = await env.DB.prepare("SELECT id FROM evaluation_case_results WHERE id = ? AND tenant_id = ?")
    .bind(caseResultId, tenantId).first();
  if (!result) throw new Error("Evaluation case result not found");
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO evaluation_human_reviews
    (id, tenant_id, case_result_id, reviewer_id, score, verdict, notes) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(case_result_id, reviewer_id) DO UPDATE SET score = excluded.score, verdict = excluded.verdict,
      notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`)
    .bind(id, tenantId, caseResultId, reviewerId, score, input.verdict, input.notes?.trim().slice(0, 1000) || null).run();
  return { id, caseResultId, score, verdict: input.verdict };
}

export async function promoteExecutionSample(env: Env, tenantId: string, scenarioId: string, input: {
  executionId?: string; name?: string; expectedPhrases?: string[]; prohibitedPhrases?: string[];
  format?: "text" | "json"; maxChars?: number;
}) {
  if (!input.executionId) throw new Error("Execution ID is required");
  const sample = await env.DB.prepare(`SELECT e.id, e.input_preview FROM executions e JOIN evaluation_scenarios s
    ON s.blueprint_id = e.blueprint_id AND s.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ? AND s.id = ? AND e.status = 'completed'`)
    .bind(input.executionId, tenantId, scenarioId).first<{ id: string; input_preview: string | null }>();
  if (!sample?.input_preview) throw new Error("Completed execution sample not found or its preview is empty");
  return createEvaluationCase(env, tenantId, scenarioId, {
    name: input.name || `Production sample ${sample.id.slice(0, 8)}`,
    input: sample.input_preview,
    expectedPhrases: input.expectedPhrases,
    prohibitedPhrases: input.prohibitedPhrases,
    format: input.format,
    maxChars: input.maxChars
  }, "production_sample");
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

function evaluateAssertion(output: string, assertion: Assertion) {
  const normalized = output.toLocaleLowerCase();
  if (assertion.type === "max_chars") {
    const passed = output.length <= assertion.value;
    return { assertion: assertion.type, passed, detail: `${output.length}/${assertion.value} characters` };
  }
  if (assertion.type === "valid_json") {
    try { JSON.parse(output); return { assertion: assertion.type, passed: true, detail: "Valid JSON" }; }
    catch { return { assertion: assertion.type, passed: false, detail: "Output is not valid JSON" }; }
  }
  const phrases = assertion.value.map((value) => value.toLocaleLowerCase());
  const matches = phrases.filter((value) => normalized.includes(value));
  if (assertion.type === "contains_all") return {
    assertion: assertion.type, passed: matches.length === phrases.length,
    detail: `${matches.length}/${phrases.length} expected phrases present`
  };
  if (assertion.type === "contains_any") return {
    assertion: assertion.type, passed: matches.length > 0,
    detail: `${matches.length}/${phrases.length} acceptable phrases present`
  };
  return { assertion: assertion.type, passed: matches.length === 0, detail: `${matches.length} prohibited phrases present` };
}

function parseAssertions(value: string): Assertion[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Assertion => {
      if (!item || typeof item !== "object" || typeof item.type !== "string") return false;
      if (item.type === "max_chars") return Number.isFinite(item.value) && item.value > 0;
      if (item.type === "valid_json") return item.value === true;
      return ["contains_all", "contains_any", "not_contains_any"].includes(item.type) &&
        Array.isArray(item.value) && item.value.length > 0 && item.value.every((entry: unknown) => typeof entry === "string");
    });
  } catch { return []; }
}

function cleanPhrases(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean).slice(0, 20).map((item) => item.slice(0, 200)) : [];
}

function parseList(value: string): string[] {
  try { const result = JSON.parse(value); return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

export function redactSensitiveText(value: string) {
  const found = new Set<string>();
  let count = 0;
  const patterns: Array<{ type: string; token: string; expression: RegExp }> = [
    { type: "email", token: "[REDACTED_EMAIL]", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { type: "ssn", token: "[REDACTED_SSN]", expression: /\b\d{3}-\d{2}-\d{4}\b/g },
    { type: "phone", token: "[REDACTED_PHONE]", expression: /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g },
    { type: "payment_card", token: "[REDACTED_PAYMENT_CARD]", expression: /\b(?:\d[ -]*?){13,19}\b/g },
    { type: "secret", token: "[REDACTED_SECRET]", expression: /\b(?:sk|api|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi }
  ];
  let text = value;
  for (const pattern of patterns) {
    text = text.replace(pattern.expression, () => {
      count += 1;
      found.add(pattern.type);
      return pattern.token;
    });
  }
  return { text, count, types: [...found] };
}
