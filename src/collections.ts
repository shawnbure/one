import { ApiError, type AppEnv, fail } from "./types";
import { renderCollectionsPage } from "./collections-page";
import {
  SAMPLE_LABEL,
  type Channel,
  accountById,
  accounts,
  dashboard,
  draftFacts,
  fallbackCallSummary,
  fallbackDraft,
  prettyDate,
  segmentPortfolio,
  transcriptText,
  validateBatch,
  type CallSummary,
} from "./collections-sample";

const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DRAFT_TIMEOUT_MS = 8000;

type GatewayAi = {
  run: (
    model: string,
    input: {
      messages: { role: string; content: string }[];
      max_tokens?: number;
      temperature?: number;
    },
    options?: {
      gateway?: { id: string; skipCache?: boolean; metadata?: Record<string, string> };
    },
  ) => Promise<unknown>;
};

const draftSystem = `You draft payment reminders for a sales demonstration. Every record is synthetic SAMPLE DATA. There are no real people.

Rules:
- Start with the exact line: SAMPLE DATA — not a real notice.
- Use only the office, guarantor label, account id, reference, balance, days past due, promise, and guidance in the user JSON.
- Be calm and specific. Follow the guidance field for what to ask.
- Do not threaten lawsuits, arrest, jail, garnishments, credit reporting, or wage action.
- Do not invent fees, deadlines, diagnoses, or consequences.
- Do not ask for a Social Security number, full card number, bank login, or street address.
- Do not use a personal name. Use the guarantor label exactly.
- Do not claim a lawyer reviewed the message or that anyone is certified under any law.
- Say that a person reviews the draft before it is sent and that this demo does not send it.
- If the channel is sms, stay under 320 characters.
- Output only the message text.`;

const summarySystem = `Summarize a synthetic collections call. Use only the transcript. Return one JSON object and no other text, with keys:
disposition (short phrase),
promiseAmount (dollar string from the transcript),
promiseDate (YYYY-MM-DD from the transcript, or null),
nextAction (one sentence a coworker can do),
complianceNotes (array of 2 or 3 short strings about contact preference, hardship, or what the call did not do).
Do not add names, phone numbers, diagnoses, fees, or legal conclusions. Do not claim a statute was satisfied.`;

function html(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: securityHeaders });
}

function modelId(env: AppEnv): string {
  const requested = (env.AI_MODEL || "").trim();
  return /^@cf\/[a-z0-9._/-]{3,80}$/i.test(requested) ? requested : DEFAULT_MODEL;
}

function gatewayId(env: AppEnv): string {
  const requested = (env.AI_GATEWAY_ID || "").trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(requested) ? requested : "";
}

function aiBinding(env: AppEnv): GatewayAi | null {
  const candidate = (env as AppEnv & { AI?: GatewayAi }).AI;
  return candidate && typeof candidate.run === "function" ? candidate : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function textFrom(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.response === "string") return record.response;
  if (typeof record.result === "string") return record.result;
  return "";
}

const unsafe =
  /\b(arrest|warrant|garnish\w*|lawsuit|sue you|credit report|jail|prison|social security|\bssn\b)\b|@[a-z0-9.-]+\.[a-z]{2,}|\b\d{3}[-.)]\d{3}[-.]\d{4}\b|\b\d{3}-\d{2}-\d{4}\b|\b\d{13,19}\b/i;

async function complete(
  env: AppEnv,
  system: string,
  user: string,
  task: string,
): Promise<{ text: string } | { failed: "unavailable" | "unusable" }> {
  const ai = aiBinding(env);
  const gateway = gatewayId(env);
  if (!ai || !gateway) return { failed: "unavailable" };
  const result = await withTimeout(
    ai.run(
      modelId(env),
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 500,
        temperature: 0.2,
      },
      { gateway: { id: gateway, skipCache: true, metadata: { demo: "collections", task } } },
    ),
    DRAFT_TIMEOUT_MS,
  );
  const text = textFrom(result).trim();
  if (!text || unsafe.test(text)) return { failed: "unusable" };
  return { text };
}

function channelOf(value: unknown): Channel {
  if (value === "sms" || value === "email" || value === "letter") return value;
  return fail(400, "Channel must be sms, email, or letter");
}

async function readObject(request: Request, allowed: string[]): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "HEAD") return {};
  const raw = await request.text();
  if (!raw.trim()) return {};
  if (raw.length > 2000) fail(413, "Demo requests only carry a sample account and channel");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(400, "Expected a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    fail(400, "Expected a JSON object");
  const body = parsed as Record<string, unknown>;
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) fail(400, "This demo does not accept uploaded accounts, notes, or prompts");
  return body;
}

async function limited(request: Request, env: AppEnv): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  try {
    return (await env.WRITE_LIMIT.limit({ key: `collections:${ip}` })).success;
  } catch {
    return true;
  }
}

export function collectionsPage(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const page = renderCollectionsPage(url.pathname, url.searchParams);
  return html(page.html, page.status);
}

function summarySource(source: string, reason: string | null): string {
  if (source === "workers-ai")
    return "Summarized with Workers AI through AI Gateway. The call was not placed.";
  if (reason === "ai_unavailable")
    return "Prepared sample summary. Workers AI did not answer in time. The call was not placed.";
  if (reason === "unusable_model_output")
    return "Prepared sample summary. The model reply did not match the sample call, so it was discarded.";
  if (reason === "rate_limited")
    return "Prepared sample summary. The demo rate limit was reached. The call was not placed.";
  if (reason === "binding_missing")
    return "Prepared sample summary. The Workers AI binding is not available. The call was not placed.";
  return "Prepared sample summary. AI Gateway is not configured in this environment. The call was not placed.";
}

function sourceCopy(reason: string | null, live: boolean): string {
  if (live) return "Drafted with Workers AI through AI Gateway. Not sent.";
  if (reason === "ai_unavailable")
    return "Prepared sample draft. Workers AI did not answer in time. Not sent.";
  if (reason === "unusable_model_output")
    return "Prepared sample draft. The model reply was discarded because it missed the sample rules. Not sent.";
  if (reason === "rate_limited")
    return "Prepared sample draft. The demo rate limit was reached. Not sent.";
  if (reason === "binding_missing")
    return "Prepared sample draft. The Workers AI binding is not available. Not sent.";
  return "Prepared sample draft. AI Gateway is not configured in this environment. Not sent.";
}

function sanitizeDraft(text: string, channel: Channel): string | null {
  let draft = text.trim();
  if (!draft.startsWith("SAMPLE DATA")) draft = `SAMPLE DATA — not a real notice.\n${draft}`;
  if (unsafe.test(draft)) return null;
  if (draft.length > 2000) return null;
  if (channel === "sms" && draft.length > 320) return null;
  return draft;
}

export async function collectionsApi(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "GET" && path === "/api/demo/collections")
    return json({
      label: SAMPLE_LABEL,
      dashboard: dashboard(),
      segments: segmentPortfolio(),
      batch: publicBatch(),
    });
  if (request.method === "GET" && path === "/api/demo/collections/dashboard")
    return json(dashboard());
  if (request.method === "GET" && path === "/api/demo/collections/segments")
    return json({ label: SAMPLE_LABEL, segments: segmentPortfolio() });
  if (request.method === "GET" && path === "/api/demo/collections/batch")
    return json(publicBatch());
  if (request.method === "POST" && path === "/api/demo/collections/ingest") {
    await readObject(request, []);
    return json(publicBatch());
  }
  if (request.method === "POST" && path === "/api/demo/collections/drafts") {
    const result = await draftResponse(request, env);
    return json({
      ...result,
      sourceLabel: result.blocked
        ? result.detail || result.reason
        : sourceCopy(result.reason, result.source === "workers-ai"),
    });
  }
  if (request.method === "POST" && path === "/api/demo/collections/call-summary")
    return json(await summaryResponse(request, env));
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
  return json({ error: "Endpoint not found" }, 404);
}

function publicBatch() {
  const batch = validateBatch();
  return {
    label: batch.label,
    fileName: batch.fileName,
    asOf: batch.asOf,
    rowCount: batch.rowCount,
    accepted: batch.accepted,
    rejected: batch.rejected,
    results: batch.results.map((result) => ({
      id: result.row.id,
      status: result.status,
      messages: result.messages,
      balanceCents: result.row.balanceCents,
      guarantorLabel: result.row.guarantorLabel,
    })),
  };
}

async function draftResponse(request: Request, env: AppEnv) {
  const body = await readObject(request, ["accountId", "channel"]);
  const account = accountById(typeof body.accountId === "string" ? body.accountId : "");
  if (!account) fail(400, "Unknown sample account");
  const channel = channelOf(body.channel);
  const prepared = fallbackDraft(account, channel);
  if (prepared.blocked)
    return {
      label: SAMPLE_LABEL,
      ...prepared,
      detail: prepared.reason,
      source: "fallback",
      viaGateway: false,
      reason: "blocked",
    };
  const base = {
    label: SAMPLE_LABEL,
    accountId: account.id,
    channel,
    blocked: false,
    reviewRequired: prepared.reviewRequired,
    viaGateway: false,
    detail: null as string | null,
  };
  if (!(await limited(request, env)))
    return { ...base, text: prepared.text, source: "fallback", reason: "rate_limited" };
  const gateway = gatewayId(env);
  if (!gateway)
    return { ...base, text: prepared.text, source: "fallback", reason: "gateway_not_configured" };
  if (!aiBinding(env))
    return { ...base, text: prepared.text, source: "fallback", reason: "binding_missing", viaGateway: false };
  try {
    const live = await complete(
      env,
      draftSystem,
      JSON.stringify(draftFacts(account, channel)),
      "draft",
    );
    const text = "text" in live ? sanitizeDraft(live.text, channel) : null;
    if (!text)
      return {
        ...base,
        text: prepared.text,
        source: "fallback",
        viaGateway: true,
        reason: "text" in live ? "unusable_model_output" : live.failed === "unusable" ? "unusable_model_output" : "ai_unavailable",
      };
    return {
      ...base,
      text,
      source: "workers-ai",
      viaGateway: true,
      model: modelId(env),
      reason: null,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error(JSON.stringify({ event: "collections_draft_failed" }));
    return {
      ...base,
      text: prepared.text,
      source: "fallback",
      viaGateway: true,
      reason: "ai_unavailable",
    };
  }
}

function summaryFromModel(text: string): CallSummary | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const disposition = typeof record.disposition === "string" ? record.disposition.trim() : "";
  const promiseAmount = typeof record.promiseAmount === "string" ? record.promiseAmount.trim() : "";
  const promiseDate = record.promiseDate === "2026-10-24" ? "2026-10-24" : "";
  const nextAction = typeof record.nextAction === "string" ? record.nextAction.trim() : "";
  const notes = Array.isArray(record.complianceNotes)
    ? record.complianceNotes.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
    : [];
  if (
    !disposition ||
    disposition.length > 80 ||
    !promiseAmount.includes("150") ||
    promiseAmount.length > 40 ||
    promiseDate !== "2026-10-24" ||
    !nextAction ||
    nextAction.length > 400 ||
    notes.length < 1 ||
    notes.length > 4 ||
    notes.some((note) => note.length > 280) ||
    unsafe.test(`${disposition}\n${promiseAmount}\n${nextAction}\n${notes.join("\n")}`)
  )
    return null;
  return {
    label: SAMPLE_LABEL,
    accountId: "ACC-4408",
    reference: "VIS-SAMPLE-1240",
    disposition,
    promiseAmount,
    promiseDate,
    nextAction,
    complianceNotes: notes.map((note) => note.trim()),
  };
}

async function summaryResponse(request: Request, env: AppEnv) {
  await readObject(request, []);
  const prepared = fallbackCallSummary();
  const respond = (summary: CallSummary, source: string, reason: string | null, viaGateway: boolean) => ({
    label: SAMPLE_LABEL,
    source,
    reason,
    viaGateway,
    model: source === "workers-ai" ? modelId(env) : null,
    summary: { ...summary, promiseDateLabel: prettyDate(summary.promiseDate) },
    sourceLabel: summarySource(source, reason),
  });
  if (!(await limited(request, env)))
    return respond(prepared, "fallback", "rate_limited", false);
  if (!gatewayId(env)) return respond(prepared, "fallback", "gateway_not_configured", false);
  if (!aiBinding(env)) return respond(prepared, "fallback", "binding_missing", false);
  try {
    const live = await complete(env, summarySystem, transcriptText(), "call-summary");
    const summary = "text" in live ? summaryFromModel(live.text) : null;
    if (!summary)
      return respond(
        prepared,
        "fallback",
        "text" in live || ("failed" in live && live.failed === "unusable")
          ? "unusable_model_output"
          : "ai_unavailable",
        true,
      );
    return respond(summary, "workers-ai", null, true);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error(JSON.stringify({ event: "collections_summary_failed" }));
    return respond(prepared, "fallback", "ai_unavailable", true);
  }
}

export const sampleAccountCount = accounts.length;
