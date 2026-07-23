import type { Env } from "./types";

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

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]");
}
