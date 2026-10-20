import type { ToolPolicy } from "@workrr/contracts";
import { applyDlp, DlpBlockedError } from "./dlp";
import { parseContracts, validateContractOutput, validateContractInput } from "./contracts";
import type { Env } from "./types";

export class ApprovalProposalConflict extends Error {}

type ToolEdit = { invocationId?: string; input?: unknown };

export async function reviseApprovalProposal(env: Env, tenantId: string, actorId: string,
  approvalId: string, input: {
    expectedRevision?: number; proposedOutput?: string; toolEdits?: ToolEdit[]; reason?: string;
  }) {
  if (!Number.isInteger(input.expectedRevision)) throw new Error("Expected revision is required");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) {
    throw new Error("Edit reason must be between 5 and 500 characters");
  }
  const toolEdits = input.toolEdits ?? [];
  if (toolEdits.length > 10) throw new Error("At most 10 proposed tool inputs can be edited at once");
  if (input.proposedOutput === undefined && !toolEdits.length) throw new Error("At least one proposal edit is required");
  const approval = await env.DB.prepare(`SELECT a.id, a.execution_id, a.status, a.revision,
      e.output_preview, e.tool_policy_json, e.process_release_id, r.output_schema_json
    FROM approvals a JOIN executions e ON e.id=a.execution_id AND e.tenant_id=a.tenant_id
    LEFT JOIN process_releases r ON r.id=e.process_release_id AND r.tenant_id=e.tenant_id
    WHERE a.id=? AND a.tenant_id=? LIMIT 1`).bind(approvalId, tenantId).first<{
      id: string; execution_id: string; status: string; revision: number; output_preview: string | null;
      tool_policy_json: string; process_release_id: string | null; output_schema_json: string | null;
    }>();
  if (!approval) throw new Error("Review item was not found");
  if (approval.status !== "pending") throw new Error("Only a pending proposal can be edited");
  if (approval.revision !== input.expectedRevision) {
    throw new ApprovalProposalConflict("Proposal changed; reload before editing");
  }
  let safeOutput: string | undefined;
  if (input.proposedOutput !== undefined) {
    const output = input.proposedOutput.trim();
    if (!output || output.length > 4000) throw new Error("Proposed output must be between 1 and 4,000 characters");
    const protectedOutput = await applyDlp(env, tenantId, output, {
      direction: "output", stage: "approval_proposal_edit", executionId: approval.execution_id
    });
    if (protectedOutput.blocked) throw new DlpBlockedError(protectedOutput.blockedDetectors);
    safeOutput = validateContractOutput(protectedOutput.modelText,
      parseContracts(null, approval.output_schema_json).outputSchema).value;
  }
  const policies = parsePolicies(approval.tool_policy_json);
  const { results: proposed } = await env.DB.prepare(`SELECT id, tool_id, tool_name, tool_version,
    handler_key, access_mode, risk_level, input_json FROM tool_invocations
    WHERE tenant_id=? AND execution_id=? AND status='proposed' ORDER BY started_at`)
    .bind(tenantId, approval.execution_id).all<Record<string, unknown>>();
  const beforeToolInputs = proposed.map((row) => [row.id, row.input_json]);
  const byId = new Map(proposed.map((row) => [String(row.id), row]));
  const changedTools: Array<{ invocationId: string; inputJson: string; idempotencyKey: string }> = [];
  for (const edit of toolEdits) {
    const invocationId = edit.invocationId ?? "";
    const row = byId.get(invocationId);
    if (!row) throw new Error(`Proposed tool invocation ${invocationId || "(missing)"} was not found`);
    const policy = policies.find((item) => item.id === String(row.tool_id) && item.version === Number(row.tool_version));
    if (!policy) throw new Error(`Published tool policy for ${String(row.tool_name)} was not found`);
    const serialized = JSON.stringify(edit.input ?? {});
    if (serialized.length > 8000) throw new Error("Edited tool input exceeds 8,000 characters");
    const protectedInput = await applyDlp(env, tenantId, serialized, {
      direction: "input", stage: "approval_tool_edit", executionId: approval.execution_id
    });
    if (protectedInput.blocked) throw new DlpBlockedError(protectedInput.blockedDetectors);
    const validated = validateContractInput(protectedInput.modelText,
      parseContracts(policy.inputSchemaJson, null).inputSchema).value;
    changedTools.push({
      invocationId, inputJson: validated,
      idempotencyKey: await revisedInvocationKey(approval.execution_id, policy, validated)
    });
    row.input_json = validated;
  }
  const now = new Date().toISOString();
  const expected = input.expectedRevision;
  const actionInput = JSON.stringify({
    proposedOutput: safeOutput ?? approval.output_preview,
    proposedActions: proposed
  });
  if (actionInput.length > 64_000) throw new Error("Combined corrected proposal exceeds 64,000 characters");
  const beforeChecksum = await digest(JSON.stringify({
    output: approval.output_preview, tools: beforeToolInputs
  }));
  const afterChecksum = await digest(JSON.stringify({
    output: safeOutput ?? approval.output_preview, tools: proposed.map((row) => [row.id, row.input_json])
  }));
  const guards = `EXISTS (SELECT 1 FROM approvals a WHERE a.id=? AND a.tenant_id=?
    AND a.status='pending' AND a.revision=?)`;
  const statements = [
    ...(safeOutput === undefined ? [] : [env.DB.prepare(`UPDATE executions SET output_preview=?
      WHERE id=? AND tenant_id=? AND ${guards}`)
      .bind(safeOutput, approval.execution_id, tenantId, approvalId, tenantId, expected)]),
    ...changedTools.map((tool) => env.DB.prepare(`UPDATE tool_invocations SET input_json=?, idempotency_key=?
      WHERE id=? AND tenant_id=? AND status='proposed' AND ${guards}`)
      .bind(tool.inputJson, tool.idempotencyKey, tool.invocationId, tenantId, approvalId, tenantId, expected)),
    env.DB.prepare(`UPDATE approvals SET action_input_json=?
      WHERE id=? AND tenant_id=? AND status='pending' AND revision=?`)
      .bind(actionInput, approvalId, tenantId, expected),
    env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json, created_at)
      SELECT ?, ?, ?, 'approval.proposal_edited', 'approval', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM approvals WHERE id=? AND tenant_id=? AND status='pending' AND revision=?)`)
      .bind(crypto.randomUUID(), tenantId, actorId, approvalId, JSON.stringify({
        reason, outputChanged: safeOutput !== undefined,
        toolInvocationIds: changedTools.map((item) => item.invocationId),
        beforeChecksum, afterChecksum, fromRevision: expected, toRevision: expected + 1
      }), now, approvalId, tenantId, expected),
    env.DB.prepare(`UPDATE approvals SET revision=revision+1, proposal_edited_at=?, proposal_edited_by=?,
      last_activity_at=? WHERE id=? AND tenant_id=? AND status='pending' AND revision=?`)
      .bind(now, actorId, now, approvalId, tenantId, expected)
  ];
  const results = await env.DB.batch(statements);
  const finalResult = results.at(-1);
  if (!finalResult || finalResult.meta.changes !== 1) {
    throw new ApprovalProposalConflict("Proposal changed; reload before editing");
  }
  return {
    id: approvalId, revision: expected + 1, proposedOutput: safeOutput ?? approval.output_preview,
    toolEdits: changedTools.length, editedAt: now
  };
}

function parsePolicies(value: string): ToolPolicy[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as ToolPolicy[] : [];
  } catch { return []; }
}
async function revisedInvocationKey(executionId: string, policy: ToolPolicy, inputJson: string) {
  return digest(`${executionId}:${policy.id}:${policy.version}:${inputJson}`);
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
