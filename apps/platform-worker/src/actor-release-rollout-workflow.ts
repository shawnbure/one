import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { migrateExecutionActorRelease } from "./actor-release-migration";
import { emitNotification } from "./notifications";
import type { Env } from "./types";

export interface ActorReleaseRolloutParams {
  tenantId: string;
  actorId: string;
  rolloutId: string;
}

export class ActorReleaseRolloutWorkflow extends WorkflowEntrypoint<Env, ActorReleaseRolloutParams> {
  async run(event: WorkflowEvent<ActorReleaseRolloutParams>, step: WorkflowStep) {
    const { tenantId, actorId, rolloutId } = event.payload;
    try {
      const rollout = await step.do("load and start actor release rollout", async () => {
        const row = await this.env.DB.prepare(`SELECT id, blueprint_id, target_release_id, reason
          FROM actor_release_rollouts WHERE id=? AND tenant_id=?`).bind(rolloutId, tenantId)
          .first<{ id: string; blueprint_id: string; target_release_id: string; reason: string }>();
        if (!row) throw new Error("Actor release rollout was not found");
        await this.env.DB.prepare(`UPDATE actor_release_rollouts SET status='running',
          started_at=COALESCE(started_at,CURRENT_TIMESTAMP), error=NULL
          WHERE id=? AND tenant_id=? AND status='queued'`).bind(rolloutId, tenantId).run();
        return row;
      });
      const items = await step.do("load immutable actor rollout cohort", async () => {
        const result = await this.env.DB.prepare(`SELECT id, source_execution_id, instance_key,
            from_release_id, to_release_id
          FROM actor_release_rollout_items WHERE rollout_id=? AND tenant_id=?
          ORDER BY instance_key`).bind(rolloutId, tenantId).all<{
            id: string; source_execution_id: string; instance_key: string;
            from_release_id: string; to_release_id: string;
          }>();
        return result.results;
      });
      for (const [index, item] of items.entries()) {
        await step.do(`migrate actor ${String(index + 1).padStart(3, "0")} ${item.id.slice(0, 12)}`, {
          retries: { limit: 1, delay: "5 seconds", backoff: "constant" }
        }, async () => {
          await this.env.DB.prepare(`UPDATE actor_release_rollout_items SET status='running',
            started_at=COALESCE(started_at,CURRENT_TIMESTAMP), error=NULL
            WHERE id=? AND rollout_id=? AND tenant_id=? AND status IN ('queued','running')`)
            .bind(item.id, rolloutId, tenantId).run();
          try {
            const result = await migrateExecutionActorRelease(this.env, tenantId, actorId,
              item.source_execution_id, {
                targetReleaseId: item.to_release_id,
                confirmFromReleaseId: item.from_release_id,
                reason: rollout.reason
              });
            const status = result.changed ? "completed" : "skipped";
            await this.env.DB.batch([
              this.env.DB.prepare(`UPDATE actor_release_rollout_items SET status=?, completed_at=CURRENT_TIMESTAMP,
                error=NULL WHERE id=? AND rollout_id=? AND tenant_id=?`)
                .bind(status, item.id, rolloutId, tenantId),
              this.env.DB.prepare(`INSERT INTO audit_events
                (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
                VALUES (?, ?, ?, 'actor_release.rollout_item_completed', 'execution_actor', ?, ?)`)
                .bind(crypto.randomUUID(), tenantId, actorId, item.source_execution_id,
                  JSON.stringify({ rolloutId, fromReleaseId: item.from_release_id,
                    toReleaseId: item.to_release_id, status }))
            ]);
            return { itemId: item.id, status };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.env.DB.prepare(`UPDATE actor_release_rollout_items SET status='failed', error=?,
              completed_at=CURRENT_TIMESTAMP WHERE id=? AND rollout_id=? AND tenant_id=?`)
              .bind(message.slice(0, 500), item.id, rolloutId, tenantId).run();
            return { itemId: item.id, status: "failed", error: message };
          }
        });
      }
      const result = await step.do("finalize actor release rollout", async () => {
        const counts = await this.env.DB.prepare(`SELECT
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed_count,
            SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) skipped_count,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_count
          FROM actor_release_rollout_items WHERE rollout_id=? AND tenant_id=?`)
          .bind(rolloutId, tenantId).first<{
            completed_count: number | null; skipped_count: number | null; failed_count: number | null;
          }>();
        const completed = Number(counts?.completed_count ?? 0);
        const skipped = Number(counts?.skipped_count ?? 0);
        const failed = Number(counts?.failed_count ?? 0);
        const status = failed ? completed || skipped ? "partial" : "failed" : "completed";
        await this.env.DB.prepare(`UPDATE actor_release_rollouts SET status=?, completed_count=?,
          skipped_count=?, failed_count=?, completed_at=CURRENT_TIMESTAMP,
          error=CASE WHEN ?>0 THEN 'One or more actor migrations failed' ELSE NULL END
          WHERE id=? AND tenant_id=?`).bind(status, completed, skipped, failed, failed, rolloutId, tenantId).run();
        return { status, completed, skipped, failed };
      });
      if (result.failed) {
        await step.do("notify actor rollout attention", () => emitNotification(this.env, tenantId, {
          eventType: "process.failed", title: "Actor release rollout needs attention",
          detail: `${result.failed} actor migration(s) failed in rollout ${rolloutId}.`,
          targetType: "process", targetId: rollout.blueprint_id
        }));
      }
      return { rolloutId, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record actor rollout failure", async () => {
        await this.env.DB.prepare(`UPDATE actor_release_rollouts SET status='failed', error=?,
          completed_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
          .bind(message.slice(0, 500), rolloutId, tenantId).run();
      });
      throw error;
    }
  }
}
