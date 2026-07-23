import { createDraftRelease } from "./studio";
import type { Env } from "./types";
import { ensureTemplateTools } from "./tools";

export interface CreateProcessInput {
  templateId: string;
  name: string;
  purpose: string;
  businessOwner: string;
  department: string;
  riskLevel: "low" | "medium" | "high";
  baseline: { volumePerMonth: number; minutesPerItem: number; hourlyCost: number; errorRate: number };
}

interface TemplateRow {
  id: string; execution_profile: string; model_profile: string; autonomy: string; system_prompt: string;
  instructions_json: string; guardrails_json: string; tools_json: string; starter_json: string;
}

interface StarterKit {
  version: number;
  topology: string[];
  currentSteps: string[];
  futureSteps: string[];
  discoveryQuestions: string[];
  systems: string[];
  exceptions: string[];
  successMetrics: string[];
  privacy: { sensitivity: string; conversationRetentionDays: number };
  schedule: { recommended: string; enabledByDefault: boolean } | null;
  adapterInstructions: string[];
  testCases: Array<{ name: string; input: string; contains: string[]; prohibited: string[] }>;
}

export async function createProcessFromTemplate(env: Env, tenantId: string, actorId: string, input: CreateProcessInput, processIdOverride?: string) {
  if (!input.name?.trim() || !input.purpose?.trim() || !input.templateId) throw new Error("Template, process name, and purpose are required");
  if (![input.baseline.volumePerMonth, input.baseline.minutesPerItem, input.baseline.hourlyCost, input.baseline.errorRate].every(Number.isFinite) ||
      input.baseline.volumePerMonth < 0 || input.baseline.minutesPerItem < 0 || input.baseline.hourlyCost < 0 ||
      input.baseline.errorRate < 0 || input.baseline.errorRate > 1) {
    throw new Error("Baseline values must be non-negative and error rate must be between 0 and 1");
  }
  const template = await env.DB.prepare("SELECT * FROM process_templates WHERE id = ?").bind(input.templateId).first<TemplateRow>();
  if (!template) throw new Error("Process template not found");
  const starter = parseStarterKit(template.starter_json);
  validateStarterKit(starter);
  const id = processIdOverride ?? `${slug(input.name)}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const score = opportunityScore(input.baseline);
  const existing = await env.DB.prepare("SELECT id FROM agent_blueprints WHERE id = ? AND tenant_id = ?").bind(id, tenantId).first();
  if (!existing) {
    const scenarioId = `eval-release-${id}`;
    const testCases = starter.testCases.length ? starter.testCases : [{
      name: "Concise grounded response",
      input: "Prepare a concise response using only the supplied facts. Facts: the request is incomplete and requires an operator to provide the missing account identifier.",
      contains: ["missing", "incomplete", "identifier", "operator"],
      prohibited: ["I looked up", "I accessed your system"]
    }];
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO agent_blueprints
      (id, tenant_id, name, description, execution_profile, model_profile, prompt_release_id, autonomy, status, tools_json,
       updated_at, business_owner, department, risk_level, operating_mode)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'draft', ?, ?, ?, ?, ?, 'paused')`)
        .bind(id, tenantId, input.name.trim(), input.purpose.trim(), template.execution_profile, template.model_profile, template.autonomy, template.tools_json, now, input.businessOwner || "Unassigned", input.department || "Operations", input.riskLevel || "medium"),
      env.DB.prepare(`INSERT INTO process_discovery
      (id, tenant_id, blueprint_id, purpose, current_steps, systems_json, exceptions_json,
       volume_per_month, minutes_per_item, hourly_cost, error_rate, opportunity_score, created_by,
       template_id, starter_snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), tenantId, id, input.purpose.trim(), starter.currentSteps.join("; "),
          JSON.stringify(starter.systems), JSON.stringify(starter.exceptions), input.baseline.volumePerMonth,
          input.baseline.minutesPerItem, input.baseline.hourlyCost, input.baseline.errorRate, score, actorId,
          template.id, JSON.stringify(starter)),
      env.DB.prepare(`INSERT INTO evaluation_scenarios (id, tenant_id, blueprint_id, name, category, status, assertion_count)
      VALUES (?, ?, ?, 'Release safety baseline', 'release_gate', 'not_run', ?)`)
        .bind(scenarioId, tenantId, id, testCases.length * 3),
      ...testCases.map((testCase, index) => env.DB.prepare(`INSERT INTO evaluation_cases
        (id, tenant_id, scenario_id, name, input_text, assertions_json, source)
        VALUES (?, ?, ?, ?, ?, ?, 'process_template')`)
        .bind(`case-${index + 1}-${scenarioId}`, tenantId, scenarioId, testCase.name, testCase.input,
          JSON.stringify(caseAssertions(testCase))))
    ]);
  }
  await ensureTemplateTools(env, tenantId, id, actorId, input.businessOwner || "Unassigned",
    JSON.parse(template.tools_json) as string[]);
  const existingReleaseRow = await env.DB.prepare(`SELECT id, prompt_release_id, version, checksum, status
    FROM process_releases WHERE tenant_id = ? AND blueprint_id = ? ORDER BY version LIMIT 1`).bind(tenantId, id)
    .first<{ id: string; prompt_release_id: string; version: number; checksum: string; status: "draft" }>();
  const existingRelease = existingReleaseRow ? {
    releaseId: existingReleaseRow.id, promptReleaseId: existingReleaseRow.prompt_release_id,
    version: existingReleaseRow.version, checksum: existingReleaseRow.checksum, status: existingReleaseRow.status
  } : null;
  const release = existingRelease ?? await createDraftRelease(env, tenantId, id, actorId, {
      systemPrompt: template.system_prompt,
      instructions: JSON.parse(template.instructions_json) as string[],
      guardrails: JSON.parse(template.guardrails_json) as string[],
      modelProfile: template.model_profile,
      autonomy: template.autonomy,
      releaseNotes: `Initial draft from ${input.templateId}`
    });
  return { id, name: input.name.trim(), status: "draft", opportunityScore: score, release };
}

export async function getValueDashboard(env: Env, tenantId: string) {
  const [totals, byProcess, discoveries, portfolioRows, measurements] = await Promise.all([
    env.DB.prepare(`WITH evidence AS (
      SELECT tenant_id, period_start, items_processed, human_minutes_saved, estimated_value, override_count, failure_count
        FROM value_snapshots
      UNION ALL
      SELECT tenant_id, period_start, items_processed, human_minutes_saved, estimated_value, override_count, failure_count
        FROM business_value_measurements WHERE status='active'
      ) SELECT SUM(items_processed) items_processed, SUM(human_minutes_saved) human_minutes_saved,
      SUM(estimated_value) estimated_value, SUM(override_count) override_count, SUM(failure_count) failure_count,
      (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM executions
        WHERE tenant_id=? AND started_at >= datetime('now','-30 days')) estimated_operating_cost
      FROM evidence WHERE tenant_id = ? AND period_start >= date('now','-30 days')`).bind(tenantId, tenantId).first(),
    env.DB.prepare(`WITH evidence AS (
      SELECT tenant_id, blueprint_id, period_start, items_processed, human_minutes_saved, estimated_value, override_count, failure_count
        FROM value_snapshots
      UNION ALL
      SELECT tenant_id, blueprint_id, period_start, items_processed, human_minutes_saved, estimated_value, override_count, failure_count
        FROM business_value_measurements WHERE status='active'
      ) SELECT v.blueprint_id, b.name process_name,
      SUM(v.items_processed) items_processed, SUM(v.human_minutes_saved) human_minutes_saved,
      SUM(v.estimated_value) estimated_value, SUM(v.override_count) override_count,
      SUM(v.failure_count) failure_count
      FROM evidence v JOIN agent_blueprints b ON b.id=v.blueprint_id AND b.tenant_id=v.tenant_id
      WHERE v.tenant_id=? AND v.period_start >= date('now','-30 days')
      GROUP BY v.blueprint_id, b.name ORDER BY estimated_value DESC`).bind(tenantId).all(),
    env.DB.prepare(`SELECT d.*, b.name process_name FROM process_discovery d JOIN agent_blueprints b ON b.id = d.blueprint_id
      WHERE d.tenant_id = ? ORDER BY d.opportunity_score DESC`).bind(tenantId).all(),
    env.DB.prepare(`WITH evidence AS (
        SELECT tenant_id, blueprint_id, period_start, items_processed, human_minutes_saved, estimated_value, override_count, failure_count
          FROM value_snapshots
        UNION ALL
        SELECT tenant_id, blueprint_id, period_start, items_processed, human_minutes_saved, estimated_value, override_count, failure_count
          FROM business_value_measurements WHERE status='active'
      ), value_30d AS (
        SELECT blueprint_id, SUM(items_processed) items_processed,
          SUM(human_minutes_saved) human_minutes_saved, SUM(estimated_value) estimated_value,
          SUM(override_count) override_count, SUM(failure_count) snapshot_failures
        FROM evidence WHERE tenant_id=? AND period_start >= date('now','-30 days')
        GROUP BY blueprint_id
      ), runs_30d AS (
        SELECT blueprint_id, COUNT(*) runs,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed_runs,
          SUM(CASE WHEN status IN ('failed','blocked','deferred') THEN 1 ELSE 0 END) adverse_runs,
          SUM(estimated_cost_usd) estimated_operating_cost,
          AVG(CASE WHEN completed_at IS NOT NULL
            THEN MAX(0, (julianday(completed_at)-julianday(started_at))*86400000) END) avg_cycle_ms
        FROM executions WHERE tenant_id=? AND started_at >= datetime('now','-30 days')
        GROUP BY blueprint_id
      ), open_incidents AS (
        SELECT blueprint_id, COUNT(*) open_incidents FROM incidents
        WHERE tenant_id=? AND status!='resolved' AND blueprint_id IS NOT NULL GROUP BY blueprint_id
      )
      SELECT b.id blueprint_id, b.name process_name, b.status, b.operating_mode,
        b.business_owner, b.department, b.safety_autonomy_cap,
        COALESCE(d.volume_per_month,0) baseline_volume, COALESCE(d.minutes_per_item,0) baseline_minutes,
        COALESCE(d.hourly_cost,0) hourly_cost, COALESCE(d.opportunity_score,0) opportunity_score,
        COALESCE(v.items_processed,0) items_processed, COALESCE(v.human_minutes_saved,0) human_minutes_saved,
        COALESCE(v.estimated_value,0) estimated_value, COALESCE(v.override_count,0) override_count,
        COALESCE(v.snapshot_failures,0) snapshot_failures, COALESCE(r.runs,0) runs,
        COALESCE(r.completed_runs,0) completed_runs, COALESCE(r.adverse_runs,0) adverse_runs,
        COALESCE(r.estimated_operating_cost,0) estimated_operating_cost,
        r.avg_cycle_ms, COALESCE(i.open_incidents,0) open_incidents,
        t.target_items, t.target_human_minutes_saved, t.target_value,
        t.maximum_override_percent, t.maximum_failure_percent, t.review_due_at target_review_due_at,
        t.rationale target_rationale, t.evidence_reference target_evidence_reference,
        t.revision target_revision, t.updated_at target_updated_at
      FROM agent_blueprints b
      LEFT JOIN process_discovery d ON d.blueprint_id=b.id AND d.tenant_id=b.tenant_id
      LEFT JOIN value_30d v ON v.blueprint_id=b.id
      LEFT JOIN runs_30d r ON r.blueprint_id=b.id
      LEFT JOIN open_incidents i ON i.blueprint_id=b.id
      LEFT JOIN process_value_targets t ON t.blueprint_id=b.id AND t.tenant_id=b.tenant_id
      WHERE b.tenant_id=? ORDER BY estimated_value DESC, b.name`)
      .bind(tenantId, tenantId, tenantId, tenantId).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT m.id, m.blueprint_id, b.name process_name, m.period_start, m.period_end,
      m.items_processed, m.actual_human_minutes, m.average_cycle_minutes, m.human_minutes_saved,
      m.estimated_value, m.override_count, m.failure_count, m.evidence_reference, m.note,
      m.status, m.void_reason, m.voided_at, m.recorded_at, m.revision,
      recorder.display_name recorded_by_name, voider.display_name voided_by_name
      FROM business_value_measurements m
      JOIN agent_blueprints b ON b.id=m.blueprint_id AND b.tenant_id=m.tenant_id
      JOIN tenant_members recorder ON recorder.id=m.recorded_by AND recorder.tenant_id=m.tenant_id
      LEFT JOIN tenant_members voider ON voider.id=m.voided_by AND voider.tenant_id=m.tenant_id
      WHERE m.tenant_id=? ORDER BY m.recorded_at DESC LIMIT 50`).bind(tenantId).all()
  ]);
  const portfolio = portfolioRows.results.map((row) => {
    const metrics = {
      itemsProcessed: Number(row.items_processed ?? 0),
      estimatedValue: Number(row.estimated_value ?? 0),
      overrideCount: Number(row.override_count ?? 0),
      adverseRuns: Number(row.adverse_runs ?? 0),
      runs: Number(row.runs ?? 0),
      openIncidents: Number(row.open_incidents ?? 0),
      safetyCap: typeof row.safety_autonomy_cap === "string" ? row.safety_autonomy_cap : null,
      opportunityScore: Number(row.opportunity_score ?? 0),
      status: String(row.status ?? "draft"),
      operatingMode: String(row.operating_mode ?? "paused"),
      targetConfigured: row.target_value !== null && row.target_value !== undefined,
      estimatedOperatingCost: Number(row.estimated_operating_cost ?? 0)
    };
    const rates = portfolioRates(metrics);
    const target = targetProgress(row, rates);
    const netValue = metrics.estimatedValue - metrics.estimatedOperatingCost;
    const valueCostRatio = metrics.estimatedOperatingCost > 0
      ? metrics.estimatedValue / metrics.estimatedOperatingCost : null;
    return { ...row, ...rates, netValue, valueCostRatio, target,
      recommendation: classifyPortfolioDecision(metrics) };
  });
  return { totals, byProcess: byProcess.results, discoveries: discoveries.results, portfolio,
    measurements: measurements.results,
    decisionPolicy: {
      evidenceWindowDays: 30, minimumEvidenceItems: 10,
      correctAtFailurePercent: 10, correctAtOverridePercent: 15,
      expandAtMaximumFailurePercent: 5, expandAtMaximumOverridePercent: 10,
      expandRequiresPositiveNetValue: true
    } };
}

interface PortfolioMetrics {
  itemsProcessed: number; estimatedValue: number; overrideCount: number; adverseRuns: number; runs: number;
  openIncidents: number; safetyCap: string | null; opportunityScore: number; status: string; operatingMode: string;
  targetConfigured: boolean; estimatedOperatingCost: number;
}

export function classifyPortfolioDecision(metrics: PortfolioMetrics) {
  const { failureRate, overrideRate } = portfolioRates(metrics);
  if (metrics.openIncidents > 0 || metrics.safetyCap) {
    const reason = metrics.openIncidents > 0 ? `${metrics.openIncidents} unresolved incident${metrics.openIncidents === 1 ? "" : "s"}` :
      `autonomy is safety-capped at ${metrics.safetyCap}`;
    return { action: "correct" as const, confidence: metrics.itemsProcessed >= 10 || metrics.runs >= 10 ? "high" as const : "medium" as const,
      reason, nextStep: "Open Process Studio, review failure and human-feedback evidence, then publish a corrected evaluated release." };
  }
  if (!metrics.targetConfigured) {
    return { action: "observe" as const, confidence: "low" as const,
      reason: "No approved 30-day value target is configured",
      nextStep: "Set an owner-approved target for volume, effort returned, value, and exception rates before expanding scope." };
  }
  if (metrics.itemsProcessed < 10 && metrics.runs < 10) {
    return { action: "observe" as const, confidence: "low" as const,
      reason: "Fewer than 10 measured items and runs in the last 30 days",
      nextStep: "Keep the process governed at its current level and collect enough production or shadow evidence." };
  }
  if (failureRate > 10 || overrideRate > 15) {
    const reason = failureRate > 10 ? `${failureRate.toFixed(1)}% adverse run rate` : `${overrideRate.toFixed(1)}% override rate`;
    return { action: "correct" as const, confidence: "high" as const, reason,
      nextStep: "Open Process Studio, review failure and human-feedback evidence, then publish a corrected evaluated release." };
  }
  const netValue = metrics.estimatedValue - metrics.estimatedOperatingCost;
  if (metrics.estimatedOperatingCost > 0 && netValue <= 0) {
    return { action: "correct" as const, confidence: "medium" as const,
      reason: `${formatMoney(metrics.estimatedOperatingCost)} estimated AI cost exceeds or equals measured value`,
      nextStep: "Review model choice, prompt size, retries, and process scope before expanding; collect customer outcome evidence after the correction." };
  }
  if ((metrics.status === "paused" || metrics.operatingMode === "paused") &&
      metrics.estimatedValue <= 0 && metrics.opportunityScore < 40) {
    return { action: "retire" as const, confidence: "medium" as const,
      reason: "Paused, no measured value, and a low discovery opportunity score",
      nextStep: "Confirm with the business owner, export required evidence, and start governed retirement in Process Studio." };
  }
  if (netValue > 0 && failureRate <= 5 && overrideRate <= 10) {
    return { action: "expand" as const, confidence: metrics.itemsProcessed >= 30 ? "high" as const : "medium" as const,
      reason: `${metrics.itemsProcessed} items produced ${formatMoney(netValue)} net value with bounded exception rates`,
      nextStep: "Validate capacity and owner readiness, then expand volume or an adjacent use case without automatically raising autonomy." };
  }
  return { action: "hold" as const, confidence: "medium" as const,
    reason: "Evidence is usable but does not yet meet the expand, correct, or retire thresholds",
    nextStep: "Review the next 30-day evidence window before changing scope." };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(value);
}

function portfolioRates(metrics: Pick<PortfolioMetrics, "itemsProcessed" | "overrideCount" | "adverseRuns" | "runs">) {
  return {
    failureRate: metrics.runs > 0 ? metrics.adverseRuns / metrics.runs * 100 : 0,
    overrideRate: metrics.itemsProcessed > 0 ? metrics.overrideCount / metrics.itemsProcessed * 100 : 0
  };
}

function targetProgress(row: Record<string, unknown>, rates: { failureRate: number; overrideRate: number }) {
  if (row.target_value === null || row.target_value === undefined) return null;
  const targetItems = Number(row.target_items);
  const targetMinutes = Number(row.target_human_minutes_saved);
  const targetValue = Number(row.target_value);
  const items = Number(row.items_processed ?? 0);
  const minutes = Number(row.human_minutes_saved ?? 0);
  const value = Number(row.estimated_value ?? 0);
  const minimumProgress = Math.min(percent(items, targetItems), percent(minutes, targetMinutes), percent(value, targetValue));
  const exceptionReady = rates.overrideRate <= Number(row.maximum_override_percent) &&
    rates.failureRate <= Number(row.maximum_failure_percent);
  const overdue = new Date(String(row.target_review_due_at)).valueOf() < Date.now();
  return {
    itemPercent: percent(items, targetItems), effortPercent: percent(minutes, targetMinutes),
    valuePercent: percent(value, targetValue), minimumPercent: minimumProgress,
    exceptionReady, overdue,
    status: overdue ? "review_due" : minimumProgress >= 100 && exceptionReady ? "achieved" :
      exceptionReady ? "tracking" : "attention"
  };
}
function percent(actual: number, target: number) {
  if (target <= 0) return actual > 0 ? 100 : 0;
  return Math.round(Math.min(999, actual / target * 100) * 10) / 10;
}

function opportunityScore(baseline: CreateProcessInput["baseline"]): number {
  const volume = Math.min(30, Math.round(baseline.volumePerMonth / 50));
  const effort = Math.min(30, Math.round(baseline.minutesPerItem / 2));
  const cost = Math.min(20, Math.round(baseline.hourlyCost / 5));
  const quality = Math.min(20, Math.round(baseline.errorRate * 200));
  return Math.max(1, Math.min(100, volume + effort + cost + quality));
}

function slug(value: string): string { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "process"; }
function caseAssertions(testCase: StarterKit["testCases"][number]) {
  return [
    { type: "max_chars", value: 2000 },
    { type: "contains_any", value: testCase.contains },
    { type: "not_contains_any", value: testCase.prohibited }
  ];
}

export function parseStarterKit(value: string): StarterKit {
  try {
    const input = JSON.parse(value || "{}") as Partial<StarterKit>;
    const strings = (items: unknown) => Array.isArray(items)
      ? items.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [];
    const testCases = Array.isArray(input.testCases) ? input.testCases.slice(0, 10).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name.trim().slice(0, 120) : "";
      const testInput = typeof row.input === "string" ? row.input.trim().slice(0, 4000) : "";
      if (!name || !testInput) return [];
      return [{ name, input: testInput, contains: strings(row.contains), prohibited: strings(row.prohibited) }];
    }) : [];
    return {
      version: Number.isInteger(input.version) ? Number(input.version) : 1,
      topology: strings(input.topology),
      currentSteps: strings(input.currentSteps),
      futureSteps: strings(input.futureSteps),
      discoveryQuestions: strings(input.discoveryQuestions),
      systems: strings(input.systems),
      exceptions: strings(input.exceptions),
      successMetrics: strings(input.successMetrics),
      privacy: parsePrivacy(input.privacy),
      schedule: parseSchedule(input.schedule),
      adapterInstructions: strings(input.adapterInstructions),
      testCases
    };
  } catch {
    return emptyStarterKit();
  }
}

export function validateStarterKit(starter: StarterKit) {
  const missing: string[] = [];
  if (starter.topology.length < 4) missing.push("delivery topology");
  if (starter.currentSteps.length < 2 || starter.futureSteps.length < 2) missing.push("current and future steps");
  if (starter.discoveryQuestions.length < 2) missing.push("discovery questions");
  if (!starter.systems.length) missing.push("system boundaries");
  if (!starter.exceptions.length) missing.push("exception policy");
  if (!starter.successMetrics.length) missing.push("success measures");
  if (!starter.adapterInstructions.length) missing.push("adapter guidance");
  if (starter.testCases.length < 2 ||
      starter.testCases.some((item) => !item.contains.length || !item.prohibited.length)) {
    missing.push("two complete acceptance examples");
  }
  if (missing.length) throw new Error(`Process starter is incomplete: ${missing.join(", ")}`);
}

function parsePrivacy(value: unknown) {
  const privacy = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sensitivity = typeof privacy.sensitivity === "string" &&
    ["public", "internal", "confidential", "restricted"].includes(privacy.sensitivity)
    ? privacy.sensitivity : "internal";
  const days = Number(privacy.conversationRetentionDays);
  return { sensitivity, conversationRetentionDays: Number.isInteger(days) && days >= 1 && days <= 3650 ? days : 90 };
}

function parseSchedule(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const schedule = value as Record<string, unknown>;
  if (typeof schedule.recommended !== "string" || !schedule.recommended.trim()) return null;
  return {
    recommended: schedule.recommended.trim().slice(0, 80),
    enabledByDefault: schedule.enabledByDefault === true
  };
}

function emptyStarterKit(): StarterKit {
  return {
    version: 1, topology: [], currentSteps: [], futureSteps: [], discoveryQuestions: [],
    systems: [], exceptions: [], successMetrics: [],
    privacy: { sensitivity: "internal", conversationRetentionDays: 90 },
    schedule: null, adapterInstructions: [], testCases: []
  };
}
