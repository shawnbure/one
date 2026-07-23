import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Filter,
  GitBranch,
  ListRestart,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";
import { api, type Approval, type AuditEvent, type Execution, type ExecutionKnowledgeCitation, type QueueOperationsData } from "./api";
import "./queue-operations.css";

interface Props {
  processes: AgentBlueprint[];
  onNotice: (message: string) => void;
}

export function ActivityView({ processes, onNotice }: Props) {
  const [runs, setRuns] = useState<Execution[]>([]);
  const [queue, setQueue] = useState<QueueOperationsData>({ summary: [], jobs: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Execution | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [citations, setCitations] = useState<ExecutionKnowledgeCitation[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [executions, queueOperations] = await Promise.all([api.executions(), api.queueOperations()]);
      setRuns(executions.data);
      setQueue(queueOperations.data);
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Could not load activity",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void api
      .execution(selectedId)
      .then((result) => {
        setDetail(result.data);
        setApprovals(result.approvals);
        setAudit(result.audit);
        setCitations(result.citations);
      })
      .catch((error: Error) => onNotice(error.message));
  }, [selectedId]);

  const filtered = useMemo(
    () =>
      runs.filter((run) => {
        const matchesStatus = status === "all" || run.status === status;
        const processName =
          processes.find((process) => process.id === run.blueprint_id)?.name ??
          run.blueprint_id;
        return (
          matchesStatus &&
          `${run.id} ${processName} ${run.input_preview}`
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      }),
    [runs, search, status, processes],
  );
  const counts = useMemo(
    () => ({
      completed: runs.filter((run) => run.status === "completed").length,
      active: runs.filter((run) => ["running", "queued"].includes(run.status))
        .length,
      attention: runs.filter((run) =>
        ["failed", "waiting_approval"].includes(run.status),
      ).length,
    }),
    [runs],
  );
  const queueCount = (status: string) => Number(queue.summary.find((item) => item.status === status)?.count ?? 0);

  async function replayQueueJob(id: string) {
    setBusy(true);
    try {
      const result = (await api.replayQueueJob(id)).data;
      onNotice(`Queue replay ${result.executionId.slice(0, 8)} accepted.`);
      await load();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Queue replay failed"); }
    finally { setBusy(false); }
  }

  async function retry() {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.retryExecution(detail.id);
      onNotice(
        `Replay ${result.executionId.slice(0, 8)} started with status ${result.status}.`,
      );
      setSelectedId(null);
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Replay failed");
    } finally {
      setBusy(false);
    }
  }

  if (selectedId)
    return (
      <section className="activity-page">
        <button className="back-link" onClick={() => setSelectedId(null)}>
          <ArrowLeft size={15} />
          Back to activity
        </button>
        {!detail ? (
          <div className="loading-card">Loading execution trace…</div>
        ) : (
          <div className="run-detail-layout">
            <article className="run-detail panel">
              <div className="run-heading">
                <span className={`run-icon ${detail.status}`}>
                  {statusIcon(detail.status)}
                </span>
                <div>
                  <span className={`status ${detail.status}`}>
                    <i />
                    {detail.status.replaceAll("_", " ")}
                  </span>
                  <h1>{detail.blueprint_name ?? detail.blueprint_id}</h1>
                  <p>
                    Execution <code>{detail.id}</code>
                  </p>
                </div>
                <button
                  disabled={
                    busy || ["running", "queued"].includes(detail.status)
                  }
                  onClick={() => void retry()}
                >
                  <RefreshCw size={15} />
                  {busy ? "Starting…" : "Replay safely"}
                </button>
              </div>
              <div className="run-facts">
                <span>
                  <small>EXECUTION PROFILE</small>
                  <strong>
                    {detail.execution_profile.replaceAll("_", " ")}
                  </strong>
                </span>
                <span>
                  <small>AUTONOMY</small>
                  <strong>{detail.autonomy ?? "—"}</strong>
                </span>
                <span>
                  <small>PROMPT RELEASE</small>
                  <strong>{detail.prompt_release_id ?? "—"}</strong>
                </span>
                <span>
                  <small>MODEL TOKENS</small>
                  <strong>{detail.total_tokens?.toLocaleString() ?? "0"}</strong>
                </span>
                <span>
                  <small>DURATION</small>
                  <strong>{duration(detail)}</strong>
                </span>
              </div>
              <div className="payload-card">
                <label>INPUT</label>
                <p>{detail.input_preview}</p>
              </div>
              <div className="payload-card output">
                <label>OUTPUT</label>
                <p>
                  {detail.output_preview ??
                    detail.error ??
                    "No output has been recorded yet."}
                </p>
              </div>
              {citations.length > 0 && (
                <div className="execution-citations">
                  <div>
                    <ShieldCheck size={16} />
                    <span><strong>Governed knowledge used</strong><small>{citations.length} attributable retrieval matches</small></span>
                  </div>
                  {citations.map((citation) => (
                    <article key={citation.chunk_id}>
                      <strong>[K{citation.ordinal + 1}] {citation.source_name}</strong>
                      <small>{Math.round(citation.score * 100)}% match · {citation.provenance}</small>
                      <p>{citation.excerpt}</p>
                    </article>
                  ))}
                </div>
              )}
              {detail.instance_key && (
                <div className="affinity-note">
                  <GitBranch size={16} />
                  <span>
                    <strong>Durable actor affinity</strong>
                    <small>{detail.instance_key}</small>
                  </span>
                </div>
              )}
            </article>
            <aside className="trace panel">
              <h2>Execution timeline</h2>
              <div className="trace-line">
                <TraceItem
                  title="Run accepted"
                  detail={formatDate(detail.started_at)}
                  state="done"
                />
                <TraceItem
                  title="Process release loaded"
                  detail={detail.prompt_release_id ?? "Current release"}
                  state="done"
                />
                {detail.instance_key && (
                  <TraceItem
                    title="Durable actor selected"
                    detail={detail.instance_key}
                    state="done"
                  />
                )}
                {citations.length > 0 && (
                  <TraceItem title="Governed knowledge retrieved"
                    detail={`${citations.length} cited chunks from ${new Set(citations.map((item) => item.source_id)).size} sources`}
                    state="done" />
                )}
                {approvals.map((approval) => (
                  <TraceItem
                    key={approval.id}
                    title="Human checkpoint"
                    detail={`${approval.status} · ${approval.title ?? approval.action_name}`}
                    state={approval.status === "pending" ? "waiting" : "done"}
                  />
                ))}
                {audit.map((event) => (
                  <TraceItem
                    key={`${event.event_type}-${event.created_at}`}
                    title={event.event_type.replaceAll(".", " ")}
                    detail={formatDate(event.created_at)}
                    state="done"
                  />
                ))}
                <TraceItem
                  title={
                    detail.status === "failed"
                      ? "Execution failed"
                      : detail.status === "completed"
                        ? "Execution completed"
                        : "Current state"
                  }
                  detail={
                    detail.completed_at
                      ? formatDate(detail.completed_at)
                      : detail.status.replaceAll("_", " ")
                  }
                  state={
                    detail.status === "failed"
                      ? "failed"
                      : detail.status === "completed"
                        ? "done"
                        : "waiting"
                  }
                />
              </div>
            </aside>
          </div>
        )}
      </section>
    );

  return (
    <section className="activity-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            <Activity size={14} /> OPERATIONS CONTROL
          </span>
          <h1>Activity</h1>
          <p>
            Inspect every AI process run, human checkpoint, failure, and durable
            actor handoff.
          </p>
        </div>
        <button className="refresh-button" onClick={() => void load()}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <div className="activity-metrics">
        <article>
          <span className="metric-icon green">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <small>COMPLETED</small>
            <strong>{counts.completed}</strong>
          </div>
        </article>
        <article>
          <span className="metric-icon blue">
            <Clock3 size={18} />
          </span>
          <div>
            <small>ACTIVE</small>
            <strong>{counts.active}</strong>
          </div>
        </article>
        <article>
          <span className="metric-icon amber">
            <AlertTriangle size={18} />
          </span>
          <div>
            <small>NEEDS ATTENTION</small>
            <strong>{counts.attention}</strong>
          </div>
        </article>
      </div>
      <article className="queue-operations panel">
        <div className="section-head"><div><span className="eyebrow"><ListRestart size={14}/> ASYNC DELIVERY</span>
          <h2>Queue operations</h2><p>Application-level evidence for Cloudflare Queue acceptance, retries, and dead-letter handoff.</p></div>
          <div className="queue-badges"><span>{queueCount("queued") + queueCount("processing")} active</span>
            <span className={queueCount("retrying") ? "attention" : ""}>{queueCount("retrying")} retrying</span>
            <span className={queueCount("dead_lettered") + queueCount("enqueue_failed") ? "danger" : ""}>
              {queueCount("dead_lettered") + queueCount("enqueue_failed")} failed</span></div>
        </div>
        <div className="queue-head"><span>Process</span><span>Source</span><span>Status</span><span>Attempts</span><span>Updated</span><span/></div>
        {queue.jobs.slice(0, 12).map((job) => <div className="queue-row" key={job.id}>
          <span><strong>{job.process_name ?? job.blueprint_id}</strong><small>{job.execution_id.slice(0, 12)}</small></span>
          <span className="queue-source">{job.source}</span>
          <span className={`queue-state ${job.status}`}>{job.status.replaceAll("_", " ")}</span>
          <span>{job.attempt_count}</span><span>{formatDate(job.updated_at)}</span>
          <span>{["dead_lettered", "enqueue_failed"].includes(job.status) && Boolean(job.replayable) &&
            <button disabled={busy} onClick={() => void replayQueueJob(job.id)}><RefreshCw size={13}/>Replay safely</button>}</span>
          {job.last_error && <small className="queue-error">{job.last_error}</small>}
        </div>)}
        {!queue.jobs.length && <div className="queue-empty">No asynchronous process work has been dispatched yet.</div>}
      </article>
      <div className="activity-toolbar">
        <div>
          <Search size={16} />
          <input
            placeholder="Search runs, processes, or inputs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label>
          <Filter size={15} />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="queued">Queued</option>
            <option value="waiting_approval">Waiting approval</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>
      <div className="runs-table panel">
        <div className="runs-head">
          <span>Process / execution</span>
          <span>Profile</span>
          <span>Status</span>
          <span>Started</span>
          <span>Duration</span>
        </div>
        {filtered.length ? (
          filtered.map((run) => (
            <button
              className="run-row"
              key={run.id}
              onClick={() => setSelectedId(run.id)}
            >
              <span>
                <strong>
                  {processes.find((process) => process.id === run.blueprint_id)
                    ?.name ?? run.blueprint_id}
                </strong>
                <small>
                  {run.id.slice(0, 8)} · {run.input_preview}
                </small>
              </span>
              <span className="profile-label">
                {run.execution_profile.replaceAll("_", " ")}
              </span>
              <span>
                <i className={`run-dot ${run.status}`} />
                {run.status.replaceAll("_", " ")}
              </span>
              <span>{formatDate(run.started_at)}</span>
              <span>{duration(run)}</span>
            </button>
          ))
        ) : (
          <div className="work-empty">
            <Activity size={25} />
            <strong>No matching runs</strong>
            <span>Executions will appear here as processes operate.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function TraceItem({
  title,
  detail,
  state,
}: {
  title: string;
  detail: string;
  state: "done" | "waiting" | "failed";
}) {
  return (
    <span className={state}>
      <i />
      <strong>{title}</strong>
      <small>{detail}</small>
    </span>
  );
}
function statusIcon(status: string) {
  return status === "failed" ? (
    <XCircle size={21} />
  ) : status === "waiting_approval" ? (
    <ShieldCheck size={21} />
  ) : status === "completed" ? (
    <CheckCircle2 size={21} />
  ) : (
    <Sparkles size={21} />
  );
}
function formatDate(value: string) {
  const date = new Date(
    value.endsWith("Z") || value.includes("+")
      ? value
      : `${value.replace(" ", "T")}Z`,
  );
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}
function duration(run: Execution) {
  if (!run.completed_at)
    return ["running", "queued"].includes(run.status) ? "In progress" : "—";
  const ms =
    new Date(run.completed_at).valueOf() - new Date(run.started_at).valueOf();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
