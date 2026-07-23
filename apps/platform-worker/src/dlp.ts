import type { Env } from "./types";

export const dlpDetectors = ["email", "phone", "ssn", "payment_card", "api_secret", "ip_address"] as const;
export type DlpDetector = typeof dlpDetectors[number];
export type DlpAction = "audit" | "redact" | "block";
export type DlpDirection = "input" | "output";

export interface DlpRule {
  detector: DlpDetector;
  action: DlpAction;
  direction: "input" | "output" | "both";
  enabled: number;
}
const defaultRules: DlpRule[] = [
  { detector: "email", action: "redact", direction: "both", enabled: 1 },
  { detector: "phone", action: "redact", direction: "both", enabled: 1 },
  { detector: "ssn", action: "block", direction: "both", enabled: 1 },
  { detector: "payment_card", action: "block", direction: "both", enabled: 1 },
  { detector: "api_secret", action: "block", direction: "both", enabled: 1 },
  { detector: "ip_address", action: "audit", direction: "both", enabled: 1 }
];

const detectorPatterns: Record<DlpDetector, { token: string; expression: RegExp }> = {
  email: { token: "[REDACTED_EMAIL]", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  phone: { token: "[REDACTED_PHONE]", expression: /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g },
  ssn: { token: "[REDACTED_SSN]", expression: /\b\d{3}-\d{2}-\d{4}\b/g },
  payment_card: { token: "[REDACTED_PAYMENT_CARD]", expression: /\b(?:\d[ -]*?){13,19}\b/g },
  api_secret: { token: "[REDACTED_SECRET]", expression: /\b(?:sk|api|token|secret)[-_=][A-Za-z0-9_-]{12,}\b/gi },
  ip_address: { token: "[REDACTED_IP]", expression: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g }
};

export class DlpBlockedError extends Error {
  readonly code = "DLP_BLOCKED";
  constructor(readonly detectors: string[]) {
    super(`DLP policy blocked content containing: ${detectors.join(", ")}`);
  }
}

export function isDlpBlocked(error: unknown): error is DlpBlockedError {
  return error instanceof DlpBlockedError ||
    (error instanceof Error && (error.message.includes("DLP policy blocked") || error.message.includes("DLP blocked")));
}

export async function applyDlp(env: Env, tenantId: string, value: string, context: {
  direction: DlpDirection;
  stage: string;
  executionId?: string;
  blueprintId?: string;
}, preparedRules?: DlpRule[]) {
  const configured = preparedRules ?? await loadDlpRules(env, tenantId);
  const active = configured.filter((rule) => Number(rule.enabled) === 1 &&
    (rule.direction === context.direction || rule.direction === "both"));
  return enforceRules(env, tenantId, value, active, context);
}

export async function loadDlpRules(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`SELECT detector, action, direction, enabled FROM dlp_rules
    WHERE tenant_id=? ORDER BY detector`).bind(tenantId).all<DlpRule>();
  return results.length ? results : defaultRules;
}

export function scanSensitiveText(value: string) {
  return evaluate(value, defaultRules.map((rule) => ({ ...rule, action: "redact" })));
}

export async function updateDlpRule(env: Env, tenantId: string, actorId: string, detector: string, input: {
  action?: string; direction?: string; enabled?: boolean;
}) {
  if (!dlpDetectors.includes(detector as DlpDetector)) throw new Error("Unsupported DLP detector");
  if (!input.action || !["audit", "redact", "block"].includes(input.action)) throw new Error("Valid DLP action is required");
  if (!input.direction || !["input", "output", "both"].includes(input.direction)) throw new Error("Valid DLP direction is required");
  const result = await env.DB.prepare(`UPDATE dlp_rules SET action=?, direction=?, enabled=?, updated_by=?,
    updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND detector=?`)
    .bind(input.action, input.direction, Number(input.enabled !== false), actorId, tenantId, detector).run();
  if (result.meta.changes !== 1) throw new Error("DLP rule not found");
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'dlp.rule_updated', 'dlp_rule', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, detector,
      JSON.stringify({ action: input.action, direction: input.direction, enabled: input.enabled !== false })).run();
  return { detector, action: input.action, direction: input.direction, enabled: input.enabled !== false };
}

async function enforceRules(env: Env, tenantId: string, value: string, rules: DlpRule[], context: {
  direction: DlpDirection; stage: string; executionId?: string; blueprintId?: string;
}) {
  const result = evaluate(value, rules);
  if (result.matches.length) {
    await env.DB.batch(result.matches.map((match) => env.DB.prepare(`INSERT INTO dlp_events
      (id, tenant_id, execution_id, blueprint_id, direction, stage, detector, action, match_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, context.executionId ?? null, context.blueprintId ?? null,
        context.direction, context.stage, match.detector, match.action, match.count)));
  }
  return result;
}

function evaluate(value: string, rules: DlpRule[]) {
  let modelText = value;
  let safeText = value;
  const matches: Array<{ detector: DlpDetector; action: DlpAction; count: number }> = [];
  for (const rule of rules) {
    const pattern = detectorPatterns[rule.detector];
    let count = 0;
    const replace = (source: string, always: boolean) => source.replace(pattern.expression, (match) => {
      if (!validMatch(rule.detector, match)) return match;
      count += 1;
      return always || rule.action !== "audit" ? pattern.token : match;
    });
    modelText = replace(modelText, false);
    const beforeSafe = count;
    safeText = safeText.replace(pattern.expression, (match) => validMatch(rule.detector, match) ? pattern.token : match);
    if (count === 0 && beforeSafe === 0) continue;
    matches.push({ detector: rule.detector, action: rule.action, count });
  }
  const blockedDetectors = matches.filter((match) => match.action === "block").map((match) => match.detector);
  return { text: safeText, modelText, safeText, blocked: blockedDetectors.length > 0, blockedDetectors, matches,
    count: matches.reduce((sum, item) => sum + item.count, 0), types: matches.map((item) => item.detector) };
}

function validMatch(detector: DlpDetector, match: string) {
  if (detector === "payment_card") return luhn(match.replace(/\D/g, ""));
  if (detector === "ip_address") return match.split(".").every((part) => Number(part) <= 255);
  return true;
}

function luhn(value: string) {
  if (value.length < 13 || value.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double && (digit *= 2) > 9) digit -= 9;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}
