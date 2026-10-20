import type { Env } from "./types";
import { emitNotification } from "./notifications";

export interface MaintenanceTask {
  name: string;
  run: () => Promise<unknown>;
}

interface TaskEvidence {
  name: string;
  status: "healthy" | "failed";
  durationMs: number;
  error?: string;
}

export async function runScheduledMaintenance(
  env: Env,
  tasks: MaintenanceTask[],
  now = new Date(),
) {
  const id = crypto.randomUUID();
  const startedAt = now.toISOString();
  let ledgerReady = true;
  try {
    await env.DB.prepare(`INSERT INTO platform_maintenance_runs
      (id, started_at, task_count) VALUES (?, ?, ?)`)
      .bind(id, startedAt, tasks.length).run();
  } catch (error) {
    ledgerReady = false;
    console.error(JSON.stringify({ event: "maintenance_ledger_start_failed", error: safeError(error) }));
  }

  const evidence = await Promise.all(tasks.map(async (task): Promise<TaskEvidence> => {
    const started = Date.now();
    try {
      await task.run();
      return { name: task.name, status: "healthy", durationMs: Date.now() - started };
    } catch (error) {
      console.error(JSON.stringify({ event: "maintenance_task_failed", task: task.name, error: safeError(error) }));
      return { name: task.name, status: "failed", durationMs: Date.now() - started, error: safeError(error) };
    }
  }));
  const failedCount = evidence.filter((item) => item.status === "failed").length;
  const completedAt = new Date().toISOString();

  if (ledgerReady) {
    try {
      await env.DB.prepare(`UPDATE platform_maintenance_runs
        SET completed_at=?, status=?, failed_count=?, task_results_json=?
        WHERE id=? AND status='running'`)
        .bind(completedAt, failedCount ? "degraded" : "healthy", failedCount,
          JSON.stringify(evidence), id).run();
    } catch (error) {
      console.error(JSON.stringify({ event: "maintenance_ledger_finish_failed", error: safeError(error) }));
    }
  }
  return { id, status: failedCount ? "degraded" as const : "healthy" as const,
    taskCount: tasks.length, failedCount, evidence };
}

export async function emitMaintenanceDegradedAlerts(
  env: Env,
  result: Awaited<ReturnType<typeof runScheduledMaintenance>>,
) {
  if (result.status !== "degraded") return { tenants: 0, events: 0 };
  const failedTasks = result.evidence.filter((item) => item.status === "failed")
    .map((item) => item.name).slice(0, 14);
  const { results } = await env.DB.prepare(`SELECT DISTINCT tenant_id
    FROM notification_policies
    WHERE event_type='platform.maintenance_degraded' AND enabled=1
    ORDER BY tenant_id LIMIT 100`).all<{ tenant_id: string }>();
  let events = 0;
  for (const row of results) {
    try {
      const ids = await emitNotification(env, row.tenant_id, {
        eventType: "platform.maintenance_degraded",
        title: "Hourly platform maintenance degraded",
        detail: `${failedTasks.length} control(s) need operator review: ${failedTasks.join(", ")}. Open Customer Setup for sanitized run evidence.`,
        targetType: "maintenance_run",
        targetId: result.id
      });
      events += ids.length;
    } catch (error) {
      console.error(JSON.stringify({
        event: "maintenance_degraded_alert_failed",
        tenantId: row.tenant_id,
        error: safeError(error)
      }));
    }
  }
  return { tenants: results.length, events };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]");
}
