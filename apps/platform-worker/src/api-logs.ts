import type { Env } from "./types";

export interface ApiLogQuery {
  direction?: string;
  outcome?: string;
  search?: string;
  cursor?: string;
  limit?: string;
}

export async function listApiLogs(env: Env, tenantId: string, input: ApiLogQuery) {
  const limit = boundedLimit(input.limit);
  const direction = input.direction?.trim() ?? "";
  if (direction && !["inbound", "outbound"].includes(direction)) throw new Error("Invalid API log direction");
  const outcome = input.outcome?.trim() ?? "";
  if (outcome && !["success", "error"].includes(outcome)) throw new Error("Invalid API log outcome");
  const search = input.search?.trim() ?? "";
  if (search.length > 100) throw new Error("API log search is limited to 100 characters");

  const filters = ["tenant_id=?"];
  const bindings: unknown[] = [tenantId];
  if (direction) { filters.push("direction=?"); bindings.push(direction); }
  if (outcome === "success") filters.push("status<400");
  if (outcome === "error") filters.push("status>=400");
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    filters.push(`(method LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR
      trace_id LIKE ? ESCAPE '\\' OR COALESCE(actor_id,'') LIKE ? ESCAPE '\\')`);
    bindings.push(pattern, pattern, pattern, pattern);
  }
  const summaryBindings = [...bindings];
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    filters.push("(created_at<? OR (created_at=? AND id<?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = filters.join(" AND ");
  const summaryWhere = filters.slice(0, cursor ? -1 : undefined).join(" AND ");
  const [page, summary] = await Promise.all([
    env.DB.prepare(`SELECT id, trace_id, direction, method, path, status, duration_ms, target, actor_id, created_at
      FROM api_logs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(...bindings, limit + 1).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) total, COALESCE(AVG(duration_ms),0) average_latency_ms,
      COALESCE(SUM(CASE WHEN status>=400 THEN 1 ELSE 0 END),0) errors
      FROM api_logs WHERE ${summaryWhere}`).bind(...summaryBindings)
      .first<{ total: number; average_latency_ms: number; errors: number }>()
  ]);
  const hasMore = page.results.length > limit;
  const data = page.results.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(String(last.created_at), String(last.id)) : null
    },
    summary: {
      total: Number(summary?.total ?? 0),
      averageLatencyMs: Math.round(Number(summary?.average_latency_ms ?? 0)),
      errors: Number(summary?.errors ?? 0)
    }
  };
}

function boundedLimit(value: string | undefined) {
  if (!value) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("API log page size must be 1–100");
  return limit;
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function encodeCursor(createdAt: string, id: string) {
  return btoa(JSON.stringify({ createdAt, id })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  if (value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid API log cursor");
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" ||
      !parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt.replace(" ", "T") + "Z"))) {
      throw new Error("invalid");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error("Invalid API log cursor");
  }
}
