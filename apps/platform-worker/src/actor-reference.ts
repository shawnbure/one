import type { ExecutionResult } from "@workrr/contracts";

export type PublicActorIsolation = "tenant_scoped_v2" | "legacy_guarded_v1";

export function publicActorReference(
  executionId: string,
  executionProfile: string,
  instanceKey: string | null | undefined,
) {
  if (!instanceKey) {
    return { actorRef: null, actorType: null, actorIsolation: null };
  }
  return {
    actorRef: `actor-${executionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "execution"}`,
    actorType: executionProfile,
    actorIsolation: (instanceKey.startsWith("v2:tenant:")
      ? "tenant_scoped_v2"
      : "legacy_guarded_v1") as PublicActorIsolation,
  };
}

export function publicExecutionResult(result: ExecutionResult) {
  const { instanceKey, ...publicResult } = result;
  return {
    ...publicResult,
    ...publicActorReference(result.executionId, result.profile, instanceKey),
  };
}

export function publicExecutionRow<T extends {
  id: string;
  execution_profile: string;
  instance_key?: string | null;
}>(row: T) {
  const { instance_key: instanceKey, ...publicRow } = row;
  const actor = publicActorReference(row.id, row.execution_profile, instanceKey);
  return {
    ...publicRow,
    actor_ref: actor.actorRef,
    actor_type: actor.actorType,
    actor_isolation: actor.actorIsolation,
  };
}
