import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Box,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  CircleHelp,
  Download,
  Filter,
  FileCode2,
  GitBranch,
  ListRestart,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";
import { api, type Approval, type AuditEvent, type Execution, type ExecutionKnowledgeCitation,
  type ExecutionExplanation, type ExecutionMemory, type GovernedMemoryTurn,
  type QueueOperationsData, type SessionData, type ToolActionDispatch, type ToolActionOperationsData,
  type ToolInvocation } from "./api";
import "./queue-operations.css";

interface Props {
  processes: AgentBlueprint[];
  session: SessionData | null;
  onNotice: (message: string) => void;
}

export function ActivityView({ processes, session, onNotice }: Props) {
  const [runs, setRuns] = useState<Execution[]>([]);
  const [queue, setQueue] = useState<QueueOperationsData>({ summary: [], jobs: [] });
  const [actionQueue, setActionQueue] = useState<ToolActionOperationsData>({ summary: [], actions: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Execution | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [citations, setCitations] = useState<ExecutionKnowledgeCitation[]>([]);
  const [toolInvocations, setToolInvocations] = useState<ToolInvocation[]>([]);
  const [toolActions, setToolActions] = useState<ToolActionDispatch[]>([]);
  const [explanation, setExplanation] = useState<ExecutionExplanation | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [executions, queueOperations, actionOperations] = await Promise.all([
        api.executions(), api.queueOperations(), api.toolActions()
      ]);
      setRuns(executions.data);
      setQueue(queueOperations.data);
      setActionQueue(actionOperations.data);
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
      setExplanation(null);
      return;
    }
    void api
      .execution(selectedId)
      .then((result) => {
        setDetail(result.data);
        setApprovals(result.approvals);
        setAudit(result.audit);
        setCitations(result.citations);
        setToolInvocations(result.toolInvocations);
        setToolActions(result.toolActions);
        setExplanation(result.explanation);
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
  const actionCount = (status: string) => Number(actionQueue.summary.find((item) => item.status === status)?.count ?? 0);

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

  async function operateAction(id: string, operation: "retry" | "cancel") {
    setBusy(true);
    try {
      const result = operation === "retry" ? await api.retryToolAction(id) : await api.cancelToolAction(id);
      onNotice(operation === "retry"
        ? `Approved action is ${result.status.replaceAll("_", " ")} with its original provider idempotency key.`
        : "Approved action delivery was cancelled before provider processing.");
      await load();
    } catch (error) { onNotice(error instanceof Error ? error.message : `Action ${operation} failed`); }
    finally { setBusy(false); }
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
                <div className="run-heading-actions">
                  <a href={`/api/executions/${encodeURIComponent(detail.id)}/evidence-export`}>
                    <Download size={15}/>Export redacted evidence
                  </a>
                  <button
                    disabled={busy || ["running", "queued"].includes(detail.status)}
                    onClick={() => void retry()}>
                    <RefreshCw size={15} />
                    {busy ? "Starting…" : "Replay safely"}
                  </button>
                </div>
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
              {explanation && <section className="execution-explainer">
                <div className="explainer-head"><span><CircleHelp size={20}/></span><div>
                  <small>WHY DID THIS HAPPEN?</small><h2>{explanation.title}</h2>
                  <p>{explanation.summary}</p></div>
                  <em className={explanation.evidenceCompleteness}>{explanation.evidenceCompleteness} evidence</em>
                </div>
                <div className="explanation-reasons">{explanation.reasons.map((reason) =>
                  <article className={reason.state} key={`${reason.label}-${reason.detail}`}>
                    <i/><div><strong>{reason.label}</strong><p>{reason.detail}</p></div>
                  </article>)}</div>
                <div className="explanation-outcome">
                  <span><small>EXTERNAL IMPACT</small><strong>{explanation.externalImpact}</strong></span>
                  <span><small>SAFE NEXT ACTION</small><strong>{explanation.nextAction}</strong></span>
                </div>
                <footer>Generated from persisted execution evidence with deterministic rules · no additional model call</footer>
              </section>}
              {hasActorMemory(detail.execution_profile) && canGovernMemory(session) &&
                <MemoryGovernance key={detail.id} executionId={detail.id} onNotice={onNotice}/>}
              {detail.autonomy_disposition && (
                <div className={`autonomy-evidence ${detail.autonomy_disposition}`}>
                  <ShieldCheck size={17} />
                  <span>
                    <strong>{autonomyEvidenceTitle(detail.autonomy_disposition)}</strong>
                    <small>
                      Level {detail.autonomy_level ?? detail.autonomy ?? "unknown"} ·{" "}
                      {autonomyEvidenceDetail(detail.autonomy_disposition)}
                    </small>
                  </span>
                </div>
              )}
              {toolEvidence(detail.tool_policy_json).length > 0 && (
                <div className="run-tool-evidence">
                  <div><Box size={17}/><span><strong>Published tool policy</strong>
                    <small>{toolEvidence(detail.tool_policy_json).length} typed capabilities snapshotted for this run</small></span></div>
                  {toolEvidence(detail.tool_policy_json).map((tool) => <span key={tool.id}>
                    <strong>{tool.name.replaceAll("_", " ")}</strong>
                    <small>{tool.accessMode} · {tool.riskLevel} risk · {tool.connectionReady ? "connection ready" : "connection unavailable"}</small>
                  </span>)}
                </div>
              )}
              {toolInvocations.length > 0 && (
                <div className="run-tool-evidence invocation-evidence">
                  <div><Box size={17}/><span><strong>Tool invocation evidence</strong>
                    <small>{toolInvocations.length} bounded call{toolInvocations.length === 1 ? "" : "s"} recorded for this run</small></span></div>
                  {toolInvocations.map((invocation) => <span key={invocation.id}>
                    <strong>{invocation.tool_name.replaceAll("_", " ")}</strong>
                    <small>{invocation.status} · {invocation.execution_mode.replaceAll("_", " ")} · {invocation.access_mode} · {invocation.risk_level} risk</small>
                    <em>{invocation.status === "simulated"
                      ? "No external system was contacted."
                      : invocation.status === "proposed"
                        ? "No action was performed; human review is required."
                        : invocation.error ?? "Bound adapter evidence recorded."}</em>
                  </span>)}
                </div>
              )}
              {toolActions.length > 0 && (
                <div className="run-tool-evidence invocation-evidence">
                  <div><ShieldCheck size={17}/><span><strong>Approved action delivery</strong>
                    <small>Queue delivery and provider completion evidence for this run</small></span></div>
                  {toolActions.map((action) => <span key={action.id}>
                    <strong>{action.tool_name.replaceAll("_", " ")}</strong>
                    <small>{action.status.replaceAll("_", " ")} · {action.attempt_count} attempt{action.attempt_count === 1 ? "" : "s"}</small>
                    <em>{action.provider_resource_id ? `Provider resource ${action.provider_resource_id}` : action.last_error ?? "No provider completion evidence yet."}</em>
                  </span>)}
                </div>
              )}
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
              {(detail.input_contract_status !== "not_configured" || detail.output_contract_status !== "not_configured") && (
                <div className={`contract-evidence ${detail.contract_error ? "failed" : ""}`}>
                  <FileCode2 size={17} />
                  <span>
                    <strong>Process contract</strong>
                    <small>Input {detail.input_contract_status?.replaceAll("_", " ")} · Output {detail.output_contract_status?.replaceAll("_", " ")}</small>
                    {detail.contract_error && <em>{detail.contract_error}</em>}
                  </span>
                </div>
              )}
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
                {detail.input_contract_status === "passed" && (
                  <TraceItem title="Input contract passed" detail={detail.process_release_id ?? "Active release"} state="done" />
                )}
                {detail.output_contract_status === "passed" && (
                  <TraceItem title="Output contract passed" detail="Structured result verified before delivery" state="done" />
                )}
                {toolInvocations.map((invocation) => (
                  <TraceItem key={invocation.id} title={`Tool ${invocation.status}`}
                    detail={`${invocation.tool_name.replaceAll("_", " ")} · ${invocation.execution_mode.replaceAll("_", " ")}`}
                    state={invocation.status === "failed" ? "failed" : invocation.status === "proposed" ? "waiting" : "done"} />
                ))}
                {approvals.map((approval) => (
                  <TraceItem
                    key={approval.id}
                    title="Human checkpoint"
                    detail={`${approval.status} · ${approval.title ?? approval.action_name}`}
                    state={approval.status === "pending" ? "waiting" : "done"}
                  />
                ))}
                {toolActions.map((action) => (
                  <TraceItem key={action.id} title={`Action ${action.status.replaceAll("_", " ")}`}
                    detail={`${action.tool_name.replaceAll("_", " ")} · ${action.attempt_count} attempt${action.attempt_count === 1 ? "" : "s"}`}
                    state={action.status === "failed" ? "failed" : ["completed"].includes(action.status) ? "done" : "waiting"} />
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
      <article className="queue-operations action-operations panel">
        <div className="section-head"><div><span className="eyebrow"><ShieldCheck size={14}/> APPROVED ACTIONS</span>
          <h2>External action delivery</h2><p>Human authorization, Queue delivery, provider attempts, and completion remain separate evidence.</p></div>
          <div className="queue-badges"><span>{actionCount("queued") + actionCount("processing")} active</span>
            <span className={actionCount("retrying") + actionCount("enqueue_failed") ? "attention" : ""}>
              {actionCount("retrying") + actionCount("enqueue_failed")} recovering</span>
            <span className={actionCount("failed") ? "danger" : ""}>{actionCount("failed")} failed</span></div>
        </div>
        <div className="action-head"><span>Process / action</span><span>Status</span><span>Attempts</span><span>Updated</span><span>Control</span></div>
        {actionQueue.actions.slice(0, 20).map((action) => <div className="action-row" key={action.id}>
          <button className="action-inspect" onClick={() => setSelectedId(action.execution_id)}>
            <strong>{action.process_name}</strong><small>{action.tool_name.replaceAll("_", " ")} · {action.execution_id.slice(0, 10)}</small>
          </button>
          <span className={`queue-state ${action.status}`}>{action.status.replaceAll("_", " ")}</span>
          <span>{action.attempt_count}</span><span>{formatDate(action.updated_at)}</span>
          <span className="action-controls">
            {canOperate(session) && action.status === "failed" &&
              <button disabled={busy} onClick={() => void operateAction(action.id, "retry")}><RefreshCw size={13}/>Retry safely</button>}
            {canOperate(session) && ["pending", "queued", "retrying", "enqueue_failed"].includes(action.status) &&
              <button disabled={busy} onClick={() => void operateAction(action.id, "cancel")}>Cancel</button>}
          </span>
          {action.last_error && <small className="queue-error">{action.last_error}</small>}
        </div>)}
        {!actionQueue.actions.length && <div className="queue-empty">No external actions have been approved yet.</div>}
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

function MemoryGovernance({ executionId, onNotice }: {
  executionId: string; onNotice: (message: string) => void;
}) {
  const [memory, setMemory] = useState<ExecutionMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<{ turn: GovernedMemoryTurn;
    action: "correct" | "quarantine" | "restore" | "delete" } | null>(null);
  const [reason, setReason] = useState("");
  const [content, setContent] = useState("");

  async function load() {
    setLoading(true);
    try { setMemory((await api.executionMemory(executionId)).data); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Actor memory could not load"); }
    finally { setLoading(false); }
  }
  function start(turn: GovernedMemoryTurn, action: "correct" | "quarantine" | "restore" | "delete") {
    setEdit({ turn, action }); setReason(""); setContent(action === "correct" ? turn.content : "");
  }
  async function save() {
    if (!edit || reason.trim().length < 5) {
      onNotice("Add a specific reason of at least five characters."); return;
    }
    setLoading(true);
    try {
      await api.governExecutionMemory(executionId, edit.turn.id, {
        action: edit.action, expectedRevision: edit.turn.revision,
        content: edit.action === "correct" ? content : undefined, reason: reason.trim()
      });
      setEdit(null); await load();
      onNotice(`Actor memory ${edit.action === "correct" ? "corrected" : `${edit.action}d`} with audit evidence.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Actor memory could not change"); }
    finally { setLoading(false); }
  }

  return <section className="memory-governance">
    <div className="memory-heading"><span><BrainCircuit size={20}/></span><div>
      <small>ACTOR-LOCAL MEMORY</small><h2>Govern this conversation</h2>
      <p>Only active turns enter future model context. Content stays in this Durable Object—not in D1 or KV.</p>
    </div>{!memory && <button disabled={loading} onClick={() => void load()}>
      {loading ? "Loading…" : "Inspect memory"}</button>}</div>
    {memory && <><div className="memory-policy">
      <span><strong>{memory.turns.filter((turn) => turn.status === "active").length}</strong> active turns</span>
      <span><strong>{memory.contextPolicy.maximumTurns}</strong> turn context ceiling</span>
      <span><strong>{memory.contextPolicy.maximumCharacters.toLocaleString()}</strong> character ceiling</span>
      <span><strong>Off</strong> automatic fact promotion</span>
    </div>
    <div className="memory-turns">{memory.turns.length ? memory.turns.map((turn) =>
      <article className={turn.status} key={turn.id}><header><span>{turn.role}</span>
        <em>{turn.status} · revision {turn.revision}</em></header>
        <p>{turn.content}</p>
        <footer><small>{formatDate(turn.createdAt)}{turn.sourceExecutionId ? ` · run ${turn.sourceExecutionId.slice(0, 8)}` : " · legacy turn"}</small>
          {turn.status !== "deleted" && <span>
            <button onClick={() => start(turn, "correct")}><Pencil size={12}/>Correct</button>
            {turn.status === "active"
              ? <button onClick={() => start(turn, "quarantine")}><XCircle size={12}/>Quarantine</button>
              : <button onClick={() => start(turn, "restore")}><Undo2 size={12}/>Restore</button>}
            <button className="delete" onClick={() => start(turn, "delete")}><Trash2 size={12}/>Delete</button>
          </span>}</footer>
        {turn.lastReason && <aside>Last change: {turn.lastReason}</aside>}
      </article>) : <p className="memory-empty">This actor has no stored conversation turns yet.</p>}</div></>}
    {edit && <div className="memory-editor"><div><strong>{edit.action} memory turn</strong>
      <button onClick={() => setEdit(null)}>Cancel</button></div>
      {edit.action === "correct" && <label>Corrected content<textarea maxLength={8000}
        value={content} onChange={(event) => setContent(event.target.value)}/></label>}
      <label>Reason<textarea maxLength={500} placeholder="Why is this change necessary?"
        value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      <button disabled={loading || !reason.trim() || (edit.action === "correct" && !content.trim())}
        onClick={() => void save()}>Apply governed change</button></div>}
  </section>;
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
function autonomyEvidenceTitle(disposition: string) {
  return ({
    observed: "Observed without model inference",
    recommended: "Recommendation only",
    waiting_approval: "Human decision required",
    guarded_safe: "Guarded read-only completion",
    autonomous: "Autonomous completion",
    approved: "Human-approved outcome",
    rejected: "Human-rejected outcome"
  } as Record<string, string>)[disposition] ?? disposition.replaceAll("_", " ");
}
function autonomyEvidenceDetail(disposition: string) {
  return ({
    observed: "The request was recorded with zero model tokens.",
    recommended: "No external action was authorized.",
    waiting_approval: "The proposal is visible in the Work Inbox and is not accepted yet.",
    guarded_safe: "No consequential tools were declared by the published process.",
    autonomous: "The published release permitted completion without review.",
    approved: "An authorized reviewer accepted the proposal.",
    rejected: "An authorized reviewer declined the proposal."
  } as Record<string, string>)[disposition] ?? "Runtime autonomy policy recorded.";
}
function toolEvidence(value: string | null | undefined) {
  if (!value) return [] as Array<{ id: string; name: string; accessMode: string; riskLevel: string; connectionReady: boolean }>;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is { id: string; name: string; accessMode: string; riskLevel: string; connectionReady: boolean } =>
      Boolean(item && typeof item === "object" && "id" in item && "name" in item));
  } catch { return []; }
}
function canOperate(session: SessionData | null) {
  return Boolean(session && ["admin", "owner", "operator"].includes(session.user.role));
}
function canGovernMemory(session: SessionData | null) {
  return Boolean(session && ["admin", "builder", "owner", "operator"].includes(session.user.role));
}
function hasActorMemory(profile: string) {
  return ["conversation", "consumer", "entity", "shared_shard", "temporary_durable"].includes(profile);
}
