import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eraseDisposalBatch, failProcessDisposal, finalizeProcessDisposal,
  loadDisposalBatch, recordDisposalProgress } from "./retirement";
import type { Env } from "./types";

export interface ProcessDisposalParams {
  tenantId: string;
  retirementId: string;
}

const batchSize = 100;
const maximumBatches = 500;

export class ProcessDisposalWorkflow extends WorkflowEntrypoint<Env, ProcessDisposalParams> {
  async run(event: WorkflowEvent<ProcessDisposalParams>, step: WorkflowStep) {
    const { tenantId, retirementId } = event.payload;
    let cursor = "";
    let actors = 0;
    let turns = 0;
    let promptBundles = 0;
    try {
      for (let index = 0; index < maximumBatches; index += 1) {
        const label = String(index + 1).padStart(3, "0");
        const batch = await step.do(`load disposal actor batch ${label}`, () =>
          loadDisposalBatch(this.env, tenantId, retirementId, cursor, batchSize));
        if (!batch.length) {
          const evidence = await step.do("finalize process disposal", () =>
            finalizeProcessDisposal(this.env, tenantId, retirementId,
              { durableActors: actors, conversationTurns: turns, agentPromptBundles: promptBundles }));
          return { retirementId, ...evidence };
        }
        const result = await step.do(`erase disposal actor batch ${label}`, {
          retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }
        }, () => eraseDisposalBatch(this.env, tenantId, retirementId, batch));
        actors += result.durableActors;
        turns += result.conversationTurns;
        promptBundles += result.agentPromptBundles;
        cursor = batch.at(-1)!;
        await step.do(`record disposal actor batch ${label}`, () =>
          recordDisposalProgress(this.env, tenantId, retirementId, cursor,
            { durableActors: actors, conversationTurns: turns, agentPromptBundles: promptBundles }));
      }
      throw new Error(`Process disposal exceeded ${maximumBatches * batchSize} durable actors`);
    } catch (error) {
      await step.do("record process disposal failure", () =>
        failProcessDisposal(this.env, tenantId, retirementId, error));
      throw error;
    }
  }
}
