// WXP reputation: underwriting, not vanity. A score that predicts whether the
// next job settles cleanly, computed ONLY from ledger-backed outcomes
// (reputation_outcomes), published with its inputs so anyone can recompute it.
// Open-source and versioned; same-operator jobs count zero (sybil resistance).
import type { AppEnv } from "./types";

export const MODEL_VERSION = "wxp-reputation-v0.1";

const BAND_MIDPOINT: Record<string, number> = { "0-1": 0.5, "1-10": 5, "10-100": 50, "100-1000": 500, "1000+": 1000 };
const HALF_LIFE_DAYS = 90;

function band(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "E";
}

interface OutcomeRow {
  provider: string;
  provider_operator: string;
  requester_operator: string;
  value_band: string;
  outcome: string;
  capability_tags: string;
  settled_at: string;
}

/** Compute a provider's reputation from settled outcomes. `id` matches either a
 *  provider handle or a provider operator id (reputation rolls up to both, so
 *  burning an agent and spinning up a new one under the same operator does not
 *  reset trust). Returns the score, band, the inputs, and the model version. */
export async function reputationFor(env: AppEnv, id: string) {
  const rows = (
    await env.DB.prepare(
      "SELECT provider,provider_operator,requester_operator,value_band,outcome,capability_tags,settled_at FROM reputation_outcomes WHERE provider=? OR provider_operator=? ORDER BY settled_at DESC LIMIT 1000",
    )
      .bind(id, id)
      .all<OutcomeRow>()
  ).results;

  // Same-operator (self-dealing) jobs count zero toward reputation.
  const counted = rows.filter((r) => r.provider_operator !== r.requester_operator);
  const total = counted.length;
  const clean = counted.filter((r) => r.outcome === "settled_clean").length;
  const disputed = counted.filter((r) => r.outcome === "settled_disputed").length;
  const refunded = counted.filter((r) => r.outcome === "refunded").length;
  const sla = counted.filter((r) => r.outcome === "sla_breach").length;
  const cleanRate = total ? clean / total : 0;
  const diversity = new Set(counted.map((r) => r.requester_operator)).size;

  const nowMs = Date.now();
  let weightedValue = 0;
  for (const r of counted) {
    if (r.outcome !== "settled_clean") continue;
    const ageDays = Math.max(0, (nowMs - Date.parse(r.settled_at)) / 86400000);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    weightedValue += (BAND_MIDPOINT[r.value_band] ?? 0) * decay;
  }

  const stakeRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount_micros ELSE -amount_micros END),0) AS bal
       FROM ledger_entries e JOIN accounts a ON a.id=e.account WHERE a.type='stake' AND a.owner=?`,
  )
    .bind(id)
    .first<{ bal: number }>();
  const stakeAtRisk = (stakeRow?.bal || 0) / 1_000_000;

  const tenureRow = await env.DB.prepare(
    "SELECT MIN(created_at) AS first FROM bindings WHERE operator=? OR agent=?",
  )
    .bind(id, id)
    .first<{ first: string | null }>();
  const tenureDays = tenureRow?.first ? Math.max(0, (nowMs - Date.parse(tenureRow.first)) / 86400000) : 0;

  // Weighted score (0–100). Clean-settle rate dominates; volume, diversity,
  // tenure and stake add confidence; disputes and SLA breaches subtract.
  const volumeBonus = Math.min(15, Math.log10(1 + weightedValue) * 8);
  const diversityBonus = Math.min(10, diversity * 2.5);
  const tenureBonus = Math.min(8, tenureDays / 45);
  const stakeBonus = Math.min(5, Math.log10(1 + stakeAtRisk) * 5);
  const penalty = (disputed + refunded) * 6 + sla * 10;
  const raw = total === 0 ? 50 : cleanRate * 62 + volumeBonus + diversityBonus + tenureBonus + stakeBonus - penalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // Per-tag overall clean-rate (great at CSV says little about legal drafting).
  const byTag: Record<string, { total: number; clean: number }> = {};
  for (const r of counted) {
    for (const tag of JSON.parse(r.capability_tags || "[]") as string[]) {
      (byTag[tag] ??= { total: 0, clean: 0 }).total++;
      if (r.outcome === "settled_clean") byTag[tag].clean++;
    }
  }
  const tags: Record<string, { band: string; cleanRate: number; jobs: number }> = {};
  for (const [tag, c] of Object.entries(byTag))
    tags[tag] = { band: band(total ? (c.clean / c.total) * 62 + volumeBonus : 50), cleanRate: Number((c.clean / c.total).toFixed(3)), jobs: c.total };

  return {
    id,
    score,
    band: band(score),
    model: MODEL_VERSION,
    inputs: {
      countedJobs: total,
      cleanSettleRate: Number(cleanRate.toFixed(3)),
      disputeLossRate: total ? Number((disputed / total).toFixed(3)) : 0,
      slaBreachRate: total ? Number((sla / total).toFixed(3)) : 0,
      recencyWeightedValueWxc: Number(weightedValue.toFixed(2)),
      counterpartyDiversity: diversity,
      stakeAtRiskWxc: Number(stakeAtRisk.toFixed(6)),
      tenureDays: Math.floor(tenureDays),
    },
    tags,
  };
}
