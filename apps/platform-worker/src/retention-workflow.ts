import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  expireRetentionActorBatch,
  failRetentionWorkflow,
  finalizeRetentionWorkflow,
  loadRetentionActorBatch,
  markRetentionRunning,
  recordRetentionProgress,
} from "./retention";
import type { Env } from "./types";

export interface TenantRetentionParams {
  tenantId: string;
  runId: string;
}

const batchSize = 100;
const maximumBatches = 500;

export class TenantRetentionWorkflow extends WorkflowEntrypoint<
  Env,
  TenantRetentionParams
> {
  async run(event: WorkflowEvent<TenantRetentionParams>, step: WorkflowStep) {
    const { tenantId, runId } = event.payload;
    let cursor = "";
    let actors = 0;
    let turns = 0;
    try {
      await step.do("start tenant retention", () =>
        markRetentionRunning(this.env, tenantId, runId),
      );
      for (let index = 0; index < maximumBatches; index += 1) {
        const label = String(index + 1).padStart(3, "0");
        const batch = await step.do(`load retention actor batch ${label}`, () =>
          loadRetentionActorBatch(this.env, tenantId, runId, cursor, batchSize),
        );
        if (!batch.length) {
          const evidence = await step.do("finalize tenant retention", () =>
            finalizeRetentionWorkflow(this.env, tenantId, runId, {
              durableActors: actors,
              conversationTurns: turns,
            }),
          );
          return { runId, ...evidence };
        }
        const result = await step.do(
          `expire retention actor batch ${label}`,
          {
            retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
          },
          () => expireRetentionActorBatch(this.env, tenantId, runId, batch),
        );
        actors += result.durableActors;
        turns += result.conversationTurns;
        cursor = batch.at(-1)!.cursor;
        await step.do(`record retention actor batch ${label}`, () =>
          recordRetentionProgress(this.env, tenantId, runId, cursor, {
            durableActors: actors,
            conversationTurns: turns,
          }),
        );
      }
      throw new Error(
        `Tenant retention exceeded ${maximumBatches * batchSize} durable actors`,
      );
    } catch (error) {
      await step.do("record tenant retention failure", () =>
        failRetentionWorkflow(this.env, tenantId, runId, error),
      );
      throw error;
    }
  }
}
