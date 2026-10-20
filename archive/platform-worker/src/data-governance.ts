import type { Env } from "./types";

export const dataClassifications = ["public", "internal", "confidential", "restricted"] as const;
export type DataClassification = typeof dataClassifications[number];

export interface DataEgressPolicy {
  classification: DataClassification;
  external_model_allowed: number;
  external_tool_allowed: number;
  revision: number;
  updated_by: string;
  updated_at: string;
}

export function normalizeDataClassification(value: unknown): DataClassification {
  if (!dataClassifications.includes(value as DataClassification)) {
    throw new Error("Select a valid process data classification");
  }
  return value as DataClassification;
}

export async function listDataEgressPolicies(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`SELECT classification, external_model_allowed,
    external_tool_allowed, revision, updated_by, updated_at
    FROM tenant_data_egress_policies WHERE tenant_id=?
    ORDER BY CASE classification WHEN 'public' THEN 0 WHEN 'internal' THEN 1
      WHEN 'confidential' THEN 2 ELSE 3 END`).bind(tenantId).all<DataEgressPolicy>();
  return results;
}

export async function assertExternalModelAllowed(env: Env, tenantId: string,
  classification: DataClassification) {
  const policy = await env.DB.prepare(`SELECT external_model_allowed FROM tenant_data_egress_policies
    WHERE tenant_id=? AND classification=?`).bind(tenantId, classification)
    .first<{ external_model_allowed: number }>();
  if (Number(policy?.external_model_allowed ?? 0) !== 1) {
    throw new Error(`${classification} data is not approved for external model handoff`);
  }
}

export async function assertExternalToolAllowed(env: Env, tenantId: string,
  classification: DataClassification) {
  const policy = await env.DB.prepare(`SELECT external_tool_allowed FROM tenant_data_egress_policies
    WHERE tenant_id=? AND classification=?`).bind(tenantId, classification)
    .first<{ external_tool_allowed: number }>();
  if (Number(policy?.external_tool_allowed ?? 0) !== 1) {
    throw new Error(`${classification} data is not approved for external tool processing`);
  }
}

export async function updateDataEgressPolicy(env: Env, tenantId: string, actorId: string,
  classificationValue: string, input: {
    externalModelAllowed?: boolean; externalToolAllowed?: boolean; expectedRevision?: number;
  }) {
  const classification = normalizeDataClassification(classificationValue);
  if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) {
    throw new Error("Current data policy revision is required");
  }
  const result = await env.DB.prepare(`UPDATE tenant_data_egress_policies
    SET external_model_allowed=?, external_tool_allowed=?, revision=revision+1,
      updated_by=?, updated_at=CURRENT_TIMESTAMP
    WHERE tenant_id=? AND classification=? AND revision=?`)
    .bind(Number(input.externalModelAllowed === true), Number(input.externalToolAllowed === true),
      actorId, tenantId, classification, input.expectedRevision).run();
  if (result.meta.changes !== 1) throw new Error("Data egress policy changed or was not found");
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'data_egress.policy_updated', 'data_classification', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, classification, JSON.stringify({
      externalModelAllowed: input.externalModelAllowed === true,
      externalToolAllowed: input.externalToolAllowed === true
    })).run();
  return {
    classification,
    externalModelAllowed: input.externalModelAllowed === true,
    externalToolAllowed: input.externalToolAllowed === true,
    revision: Number(input.expectedRevision) + 1
  };
}
