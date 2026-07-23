import type { AgentBlueprint, AutonomyLevel } from "@workrr/contracts";
import type { Env } from "./types";
import { emitNotification } from "./notifications";

export type AutonomyDisposition =
  | "observed"
  | "shadowed"
  | "recommended"
  | "waiting_approval"
  | "guarded_safe"
  | "autonomous";

export interface AutonomyPlan {
  configured: AutonomyLevel;
  effective: AutonomyLevel;
  disposition: AutonomyDisposition;
  runModel: boolean;
  requiresApproval: boolean;
  shadowMode: boolean;
  explanation: string;
}

export function autonomyPlan(blueprint: Pick<AgentBlueprint, "autonomy" | "operatingMode" | "tools" | "toolPolicies">): AutonomyPlan {
  const configured = blueprint.autonomy;
  const mode = blueprint.operatingMode ?? "active";
  if (mode === "shadow") return {
    configured, effective: "suggest", disposition: "shadowed", runModel: true, requiresApproval: false,
    shadowMode: true,
    explanation: "The model proposal is recorded for comparison only; it cannot authorize an external action or enter accepted assistant memory."
  };
  const effective: AutonomyLevel = configured === "observe"
    ? "observe"
    : mode === "approval_only"
      ? "approve"
      : mode === "read_only"
        ? "suggest"
        : configured;
  if (effective === "observe") return {
    configured, effective, disposition: "observed", runModel: false, requiresApproval: false, shadowMode: false,
    explanation: "Input is recorded without generating an AI recommendation."
  };
  if (effective === "approve") return {
    configured, effective, disposition: "waiting_approval", runModel: true, requiresApproval: true, shadowMode: false,
    explanation: "The proposed result requires a human decision before it becomes an accepted outcome."
  };
  const policies = blueprint.toolPolicies ?? [];
  const hasUnavailableConnection = policies.some((tool) => tool.connectionId && !tool.connectionReady);
  const guardedReview = policies.length
    ? policies.some((tool) => tool.accessMode === "write" || tool.riskLevel !== "low" || !tool.connectionReady)
    : blueprint.tools.length > 0;
  if (effective === "guarded" && guardedReview) return {
    configured, effective, disposition: "waiting_approval", runModel: true, requiresApproval: true, shadowMode: false,
    explanation: hasUnavailableConnection
      ? "A required tool connection is not ready, so guarded execution routes the proposal to review."
      : "A declared tool is write-capable or above low risk, so guarded execution routes the proposal to review."
  };
  if (effective === "guarded") return {
    configured, effective, disposition: "guarded_safe", runModel: true, requiresApproval: false, shadowMode: false,
    explanation: "No consequential tools are declared; the guarded read-only result may complete."
  };
  if (effective === "autonomous") return {
    configured, effective, disposition: hasUnavailableConnection ? "waiting_approval" : "autonomous",
    runModel: true, requiresApproval: hasUnavailableConnection, shadowMode: false,
    explanation: hasUnavailableConnection
      ? "A required tool connection is not ready, so autonomous completion falls back to human review."
      : "The published release permits completion without a human checkpoint."
  };
  return {
    configured, effective, disposition: "recommended", runModel: true, requiresApproval: false, shadowMode: false,
    explanation: "The result is a recommendation and does not authorize an external action."
  };
}

export async function routeApproval(env: Env, tenantId: string, executionId: string,
  blueprint: Pick<AgentBlueprint, "id" | "name" | "tools" | "toolPolicies">, plan: AutonomyPlan, output: string) {
  if (!plan.requiresApproval) return null;
  const approvalId = `approval-${executionId}`;
  const now = new Date().toISOString();
  const { results: proposedActions } = await env.DB.prepare(`SELECT id, tool_name, handler_key,
    access_mode, risk_level, input_json FROM tool_invocations
    WHERE tenant_id=? AND execution_id=? AND status='proposed' ORDER BY started_at`)
    .bind(tenantId, executionId).all<Record<string, unknown>>();
  const actionName = proposedActions.length ? "review_proposed_tool_action" : "review_ai_outcome";
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO approvals
      (id, tenant_id, execution_id, action_name, action_input_json, status, requested_at, title,
       description, impact, autonomy_level, action_risk)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'medium', ?, 'medium')`)
    .bind(approvalId, tenantId, executionId, actionName,
      JSON.stringify({ tools: blueprint.toolPolicies ?? blueprint.tools, proposedActions,
        proposedOutput: output.slice(0, 4000) }), now,
      `Review ${blueprint.name} proposal`, plan.explanation, plan.effective).run();
  await env.DB.batch([
    env.DB.prepare(`UPDATE executions SET status='waiting_approval', autonomy_disposition='waiting_approval',
      approval_id=? WHERE id=? AND tenant_id=?`).bind(approvalId, executionId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json, created_at)
      VALUES (?, ?, 'system', 'approval.requested', 'approval', ?, ?, ?)`)
      .bind(`audit-autonomy-${executionId}`, tenantId, approvalId,
        JSON.stringify({ executionId, blueprintId: blueprint.id, autonomy: plan.effective,
          tools: blueprint.toolPolicies ?? blueprint.tools,
          proposedActions: proposedActions.map((item) => item.id) }), now)
  ]);
  if (inserted.meta.changes === 1) {
    try {
      await emitNotification(env, tenantId, {
        eventType: "approval.pending", title: `Review required · ${blueprint.name}`,
        detail: plan.explanation, targetType: "approval", targetId: approvalId
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "approval_notification_failed", approvalId, error: String(error) }));
    }
  }
  return approvalId;
}
