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
export interface CustomDlpEntry {
  id: string;
  label: string;
  action: DlpAction;
  direction: "input" | "output" | "both";
  enabled: number;
  revision: number;
  updated_by: string;
  updated_at: string;
}
interface CustomDlpRuntimeEntry extends CustomDlpEntry { term: string }
interface DlpEvaluation {
  text: string; modelText: string; safeText: string; blocked: boolean; blockedDetectors: string[];
  matches: Array<{ detector: string; action: DlpAction; count: number }>;
  count: number; types: string[];
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
  const custom = await loadCustomDlpEntries(env, tenantId, context.direction);
  return enforceRules(env, tenantId, value, active, custom, context);
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

export async function createCustomDlpEntry(env: Env, tenantId: string, actorId: string, input: {
  label?: string; term?: string; action?: string; direction?: string;
}) {
  const label = validateLabel(input.label);
  const term = validateTerm(input.term);
  const action = validateAction(input.action);
  const direction = validateDirection(input.direction);
  const key = await customDlpKey(env);
  const count = await env.DB.prepare("SELECT COUNT(*) total FROM custom_dlp_entries WHERE tenant_id=?")
    .bind(tenantId).first<{ total: number }>();
  if (Number(count?.total ?? 0) >= 25) throw new Error("Custom DLP entry limit reached (25)");
  const encrypted = await encryptTerm(key.encryption, term);
  const digest = await termDigest(key.digest, term);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO custom_dlp_entries
        (id, tenant_id, label, term_ciphertext, term_iv, term_digest, action, direction, enabled, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(id, tenantId, label, encrypted.ciphertext, encrypted.iv, digest, action, direction, actorId, actorId),
      env.DB.prepare(`INSERT INTO audit_events
        (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
        VALUES (?, ?, ?, 'dlp.custom_entry_created', 'custom_dlp_entry', ?, ?)`)
        .bind(crypto.randomUUID(), tenantId, actorId, id, JSON.stringify({ label, action, direction }))
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
      throw new Error("That protected phrase is already configured");
    }
    throw error;
  }
  return { id, label, action, direction, enabled: 1, revision: 1 };
}

export async function updateCustomDlpEntry(env: Env, tenantId: string, actorId: string, id: string, input: {
  action?: string; direction?: string; enabled?: boolean; expectedRevision?: number;
}) {
  const action = validateAction(input.action);
  const direction = validateDirection(input.direction);
  if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) {
    throw new Error("Current custom DLP revision is required");
  }
  const result = await env.DB.prepare(`UPDATE custom_dlp_entries SET action=?, direction=?, enabled=?,
    revision=revision+1, updated_by=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND revision=?`)
    .bind(action, direction, Number(input.enabled !== false), actorId, id, tenantId, input.expectedRevision).run();
  if (result.meta.changes !== 1) throw new Error("Custom DLP entry changed or was not found");
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'dlp.custom_entry_updated', 'custom_dlp_entry', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, id,
      JSON.stringify({ action, direction, enabled: input.enabled !== false })).run();
  return { id, action, direction, enabled: input.enabled !== false, revision: Number(input.expectedRevision) + 1 };
}

async function loadCustomDlpEntries(env: Env, tenantId: string, direction: DlpDirection) {
  const { results } = await env.DB.prepare(`SELECT id, label, term_ciphertext, term_iv, action, direction,
    enabled, revision, updated_by, updated_at FROM custom_dlp_entries
    WHERE tenant_id=? AND enabled=1 AND direction IN (?, 'both') ORDER BY length(term_ciphertext) DESC`)
    .bind(tenantId, direction).all<CustomDlpEntry & { term_ciphertext: string; term_iv: string }>();
  if (!results.length) return [];
  const key = await customDlpKey(env);
  return Promise.all(results.map(async (row) => ({
    ...row, term: await decryptTerm(key.encryption, row.term_ciphertext, row.term_iv)
  })));
}

async function enforceRules(env: Env, tenantId: string, value: string, rules: DlpRule[],
  custom: CustomDlpRuntimeEntry[], context: {
  direction: DlpDirection; stage: string; executionId?: string; blueprintId?: string;
}) {
  // Tenant phrases run first so a built-in redaction inside a phrase cannot bypass a
  // more specific organization block policy.
  const customResult = evaluateCustom(evaluate(value, []), custom);
  const result = evaluate(value, rules, customResult);
  if (result.matches.length) {
    await env.DB.batch(result.matches.map((match) => env.DB.prepare(`INSERT INTO dlp_events
      (id, tenant_id, execution_id, blueprint_id, direction, stage, detector, action, match_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, context.executionId ?? null, context.blueprintId ?? null,
        context.direction, context.stage, match.detector, match.action, match.count)));
  }
  return result;
}

function evaluate(value: string, rules: DlpRule[], initial?: DlpEvaluation): DlpEvaluation {
  let modelText = initial?.modelText ?? value;
  let safeText = initial?.safeText ?? value;
  const matches: Array<{ detector: string; action: DlpAction; count: number }> = [...(initial?.matches ?? [])];
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

function evaluateCustom(result: DlpEvaluation, entries: CustomDlpRuntimeEntry[]): DlpEvaluation {
  let { modelText, safeText } = result;
  const matches = [...result.matches] as Array<{ detector: string; action: DlpAction; count: number }>;
  for (const entry of entries.sort((a, b) => b.term.length - a.term.length)) {
    const expression = new RegExp(escapeRegExp(entry.term), "giu");
    let count = 0;
    modelText = modelText.replace(expression, (match) => {
      count += 1;
      return entry.action === "audit" ? match : "[REDACTED_CUSTOM]";
    });
    safeText = safeText.replace(expression, "[REDACTED_CUSTOM]");
    if (count) matches.push({ detector: `custom:${entry.id}`, action: entry.action, count });
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

function validateLabel(value?: string) {
  const label = value?.trim() ?? "";
  if (label.length < 2 || label.length > 80) throw new Error("Custom DLP label must be 2–80 characters");
  return label;
}
function validateTerm(value?: string) {
  const term = value?.normalize("NFKC").trim() ?? "";
  if (term.length < 3 || term.length > 120) throw new Error("Protected phrase must be 3–120 characters");
  return term;
}
function validateAction(value?: string): DlpAction {
  if (!value || !["audit", "redact", "block"].includes(value)) throw new Error("Valid DLP action is required");
  return value as DlpAction;
}
function validateDirection(value?: string): "input" | "output" | "both" {
  if (!value || !["input", "output", "both"].includes(value)) throw new Error("Valid DLP direction is required");
  return value as "input" | "output" | "both";
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function customDlpKey(env: Env) {
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) throw new Error("Platform encryption key is not configured");
  const raw = fromBase64Url(env.OAUTH_TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("Platform encryption key must be 32 bytes");
  const material = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const salt = new TextEncoder().encode("workrr-one");
  const encryption = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt,
    info: new TextEncoder().encode("custom-dlp/encryption/v1") },
  material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const digest = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt,
    info: new TextEncoder().encode("custom-dlp/digest/v1") },
  material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return { encryption, digest };
}
async function encryptTerm(key: CryptoKey, term: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(term));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}
async function decryptTerm(key: CryptoKey, ciphertext: string, iv: string) {
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) },
    key, fromBase64Url(ciphertext));
  return new TextDecoder().decode(clear);
}
async function termDigest(key: CryptoKey, term: string) {
  const digest = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(term.normalize("NFKC").toLocaleLowerCase()));
  return base64Url(new Uint8Array(digest));
}
function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
