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
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";
import { api, type ActorLocalWork, type Approval, type AuditEvent, type Execution, type ExecutionKnowledgeCitation,
  type DurableActorFact, type ExecutionExplanation, type ExecutionMemory, type GovernedMemoryTurn,
  type QueueOperationsData, type RecoveryOperations, type RecoveryTask, type SessionData,
  type ShadowReview,
  type ToolActionDispatch, type ToolActionOperationsData,
  type ToolInvocation } from "./api";
import "./queue-operations.css";
import "./durable-facts.css";

interface Props {
  processes: AgentBlueprint[];
  session: SessionData | null;
  onNotice: (message: string) => void;
}

export function ActivityView({ processes, session, onNotice }: Props) {
  const [runs, setRuns] = useState<Execution[]>([]);
  const [queue, setQueue] = useState<QueueOperationsData>({ summary: [], jobs: [] });
  const [recovery, setRecovery] = useState<RecoveryOperations>({
    summary: { open: 0, investigating: 0, overdue: 0, resolved: 0, acceptedRisk: 0 },
    tasks: [], eligibleOwners: []
  });
  const [actionQueue, setActionQueue] = useState<ToolActionOperationsData>({ summary: [], actions: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Execution | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [citations, setCitations] = useState<ExecutionKnowledgeCitation[]>([]);
  const [toolInvocations, setToolInvocations] = useState<ToolInvocation[]>([]);
  const [toolActions, setToolActions] = useState<ToolActionDispatch[]>([]);
  const [explanation, setExplanation] = useState<ExecutionExplanation | null>(null);
  const [shadowReview, setShadowReview] = useState<ShadowReview | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");

  async function load() {
    try {
      const [executions, queueOperations, actionOperations, recoveryOperations] = await Promise.all([
        api.executions(), api.queueOperations(), api.toolActions(), api.recovery()
      ]);
      setRuns(executions.data);
      setQueue(queueOperations.data);
      setActionQueue(actionOperations.data);
      setRecovery(recoveryOperations.data);
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
      setShadowReview(null);
      setCancelling(false);
      setCancellationReason("");
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
        setShadowReview(result.shadowReview);
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
        ["failed", "blocked", "deferred", "waiting_approval"].includes(run.status),
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

  async function cancelExecution() {
    if (!detail || cancellationReason.trim().length < 10) {
      onNotice("Add a specific cancellation reason of at least ten characters.");
      return;
    }
    setBusy(true);
    try {
      const response = await api.cancelExecution(detail.id, cancellationReason.trim());
      const refreshed = await api.execution(detail.id);
      setDetail(refreshed.data);
      setAudit(refreshed.audit);
      setExplanation(refreshed.explanation);
      setCancelling(false);
      setCancellationReason("");
      await load();
      onNotice(`${response.data.executionProfile === "workflow" ? "Workflow" : "Queue"} execution cancelled before processing.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Queued execution could not be cancelled");
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
                  {canOperate(session) && detail.status === "queued" &&
                    <button className="cancel-work" disabled={busy} onClick={() => setCancelling(true)}>
                      <XCircle size={15}/>Cancel queued work
                    </button>}
                  <button
                    disabled={busy || ["running", "queued"].includes(detail.status)}
                    onClick={() => void retry()}>
                    <RefreshCw size={15} />
                    {busy ? "Starting…" : "Replay safely"}
                  </button>
                </div>
              </div>
              {cancelling && detail.status === "queued" && <section className="execution-cancellation">
                <div><strong>Cancel this queued execution?</strong>
                  <p>Workrr will stop its Cloudflare Workflow or make the Queue delivery a no-op. Work that has already started cannot be cancelled here.</p></div>
                <label>Operational reason<textarea maxLength={500} value={cancellationReason}
                  onChange={(event) => setCancellationReason(event.target.value)}
                  placeholder="Why this queued work should not proceed"/></label>
                <footer><button disabled={busy} onClick={() => {
                  setCancelling(false); setCancellationReason("");
                }}>Keep queued</button><button className="danger" disabled={busy || cancellationReason.trim().length < 10}
                  onClick={() => void cancelExecution()}>{busy ? "Cancelling…" : "Confirm cancellation"}</button></footer>
              </section>}
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
                  <small>INFERENCE BOUNDARY</small>
                  <strong>{detail.inference_provider === "ai_gateway"
                    ? `AI Gateway · ${detail.gateway_id ?? "default"}`
                    : "Workers AI"}</strong>
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
              {shadowReview && <ShadowReviewPanel review={shadowReview} session={session}
                onSaved={setShadowReview} onNotice={onNotice}/>}
              {hasActorMemory(detail.execution_profile) && canGovernMemory(session) &&
                <MemoryGovernance key={detail.id} executionId={detail.id} onNotice={onNotice}/>}
              {hasActorMemory(detail.execution_profile) &&
                <ActorLocalWorkPanel key={`work-${detail.id}`} executionId={detail.id}
                  session={session} onNotice={onNotice}/>}
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
              {detail.actor_ref && (
                <div className="affinity-note">
                  <GitBranch size={16} />
                  <span>
                    <strong>Durable actor affinity</strong>
                    <small>{detail.actor_type?.replaceAll("_", " ")} · {detail.actor_ref} · {
                      detail.actor_isolation?.replaceAll("_", " ")
                    }</small>
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
                {detail.actor_ref && (
                  <TraceItem
                    title="Durable actor selected"
                    detail={`${detail.actor_type?.replaceAll("_", " ")} · ${detail.actor_ref}`}
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
      <RecoveryQueue data={recovery} runs={runs} canManage={canOperate(session)}
        canAcceptRisk={Boolean(session && ["admin", "owner"].includes(session.user.role))}
        busy={busy} setBusy={setBusy} onReload={load} onOpenExecution={setSelectedId} onNotice={onNotice}/>
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
          {["dead_lettered", "enqueue_failed"].includes(job.status) && <div className="queue-recovery">
            <UserRoundCheck size={17}/><span><strong>{job.recovery_owner_name ?? "Recovery owner unassigned"}</strong>
              <small>{job.recovery_status
                ? `${job.recovery_status.replaceAll("_", " ")} · due ${formatDate(job.recovery_due_at!)}`
                : "Recovery task is being established"}</small></span>
            <p>Correct the Queue handoff condition, replay safely, then close recovery with a completed same-process run.</p>
            <button onClick={() => setSelectedId(job.execution_id)}>Open recovery run</button>
          </div>}
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
            <option value="cancelled">Cancelled</option>
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

function RecoveryQueue({ data, runs, canManage, canAcceptRisk, busy, setBusy, onReload,
  onOpenExecution, onNotice }: {
  data: RecoveryOperations; runs: Execution[]; canManage: boolean; canAcceptRisk: boolean;
  busy: boolean; setBusy: (value: boolean) => void; onReload: () => Promise<void>;
  onOpenExecution: (id: string) => void; onNotice: (message: string) => void;
}) {
  const [pending, setPending] = useState<{ task: RecoveryTask;
    action: "investigate" | "resolve" | "accept_risk" | "reopen" } | null>(null);
  const [note, setNote] = useState("");
  const [verification, setVerification] = useState("");
  async function change(task: RecoveryTask, action: "assign" | "investigate" | "resolve" | "accept_risk" | "reopen",
    assignedTo?: string) {
    setBusy(true);
    try {
      await api.updateRecovery(task.id, {
        action, expectedRevision: task.revision, assignedTo,
        note: action === "assign" ? undefined : note.trim(),
        resolutionExecutionId: action === "resolve" ? verification : undefined
      });
      setPending(null); setNote(""); setVerification(""); await onReload();
      onNotice(action === "assign" ? "Recovery owner assigned." : `Recovery task moved to ${action.replaceAll("_", " ")}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Recovery task could not change"); }
    finally { setBusy(false); }
  }
  return <article className="recovery-queue panel">
    <div className="section-head"><div><span className="eyebrow"><UserRoundCheck size={14}/> ACCOUNTABLE RECOVERY</span>
      <h2>Failures have owners and closure evidence</h2>
      <p>Blocked, deferred, and failed executions remain here until a completed verification run proves the repair or an owner accepts the risk.</p></div>
      <div className="queue-badges"><span>{data.summary.open} open</span>
        <span className={data.summary.investigating ? "attention" : ""}>{data.summary.investigating} investigating</span>
        <span className={data.summary.overdue ? "danger" : ""}>{data.summary.overdue} overdue</span></div></div>
    <div className="recovery-list">{data.tasks.slice(0, 12).map((task) => {
      const completed = runs.filter((run) => run.blueprint_id === task.blueprint_id &&
        run.status === "completed" && run.id !== task.execution_id);
      return <section className={`${task.status} ${task.overdue ? "overdue" : ""}`} key={task.id}>
        <button className="recovery-run" onClick={() => onOpenExecution(task.execution_id)}>
          <span><strong>{task.process_name}</strong><small>{task.category.replaceAll("_", " ")} · run {task.execution_id.slice(0, 8)}</small></span>
          <em className={task.execution_status}>{task.execution_status}</em></button>
        <div className="recovery-accountability"><span><small>OWNER</small>
          {canManage && !["resolved", "accepted_risk"].includes(task.status)
            ? <select value={task.assigned_to ?? ""} onChange={(event) => {
              if (event.target.value) void change(task, "assign", event.target.value);
            }}><option value="">Unassigned</option>{data.eligibleOwners.map((owner) =>
              <option value={owner.id} key={owner.id}>{owner.display_name} · {owner.role}</option>)}</select>
            : <strong>{task.assignee_name ?? "Unassigned"}</strong>}</span>
          <span><small>DUE</small><strong>{formatDate(task.due_at)}{task.overdue ? " · overdue" : ""}</strong></span>
          <span><small>STATE</small><strong>{task.status.replaceAll("_", " ")}</strong></span></div>
        <p>{task.nextAction}</p>
        {task.resolution && <aside><strong>Closure evidence</strong>{task.resolution}
          {task.resolution_execution_id && <button onClick={() => onOpenExecution(task.resolution_execution_id!)}>
            Verification run {task.resolution_execution_id.slice(0, 8)}</button>}</aside>}
        {canManage && <footer>{["resolved", "accepted_risk"].includes(task.status)
          ? <button onClick={() => { setPending({ task, action: "reopen" }); setNote(""); }}>Reopen</button>
          : <><button onClick={() => { setPending({ task, action: "investigate" }); setNote(""); }}>Investigate</button>
            <button onClick={() => { setPending({ task, action: "resolve" }); setNote(""); setVerification(""); }}>Resolve with proof</button>
            {canAcceptRisk && <button className="risk" onClick={() => {
              setPending({ task, action: "accept_risk" }); setNote("");
            }}>Accept risk</button>}</>}</footer>}
        {pending?.task.id === task.id && <div className="recovery-editor"><header><strong>
          {pending.action.replaceAll("_", " ")} recovery task</strong><button onClick={() => setPending(null)}>Cancel</button></header>
          {pending.action === "resolve" && <label>Completed verification run<select value={verification}
            onChange={(event) => setVerification(event.target.value)}><option value="">Select proof</option>
            {completed.map((run) => <option value={run.id} key={run.id}>{run.id.slice(0, 8)} · {formatDate(run.completed_at!)}</option>)}
          </select>{!completed.length && <small>No completed same-process run is available yet. Replay after correcting the cause.</small>}</label>}
          <label>{pending.action === "accept_risk" ? "Risk acceptance rationale" : "Recovery evidence"}
            <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)}
              placeholder="Record what was investigated, changed, or intentionally accepted."/></label>
          <button disabled={busy || note.trim().length < 5 || (pending.action === "resolve" && !verification)}
            onClick={() => void change(task, pending.action)}>Apply accountable change</button></div>}
      </section>;
    })}</div>
    {!data.tasks.length && <div className="queue-empty">No failed, blocked, or deferred execution requires recovery.</div>}
  </article>;
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
  const [migrationReason, setMigrationReason] = useState("");
  const [factDraft, setFactDraft] = useState<{ sourceTurnId: string; content: string;
    category: DurableActorFact["category"]; reason: string; expiresAt: string } | null>(null);
  const [factAction, setFactAction] = useState<{ fact: DurableActorFact;
    action: "approve" | "correct" | "retire"; content: string; reason: string } | null>(null);

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
  async function migrateRelease() {
    if (!memory?.activeReleaseId || !memory.currentReleaseId || migrationReason.trim().length < 10) {
      onNotice("Add a specific migration reason of at least ten characters."); return;
    }
    setLoading(true);
    try {
      const result = await api.migrateExecutionActorRelease(executionId, {
        targetReleaseId: memory.activeReleaseId,
        confirmFromReleaseId: memory.currentReleaseId,
        reason: migrationReason.trim()
      });
      await load(); setMigrationReason("");
      onNotice(result.data.changed
        ? `Conversation migrated to release v${result.data.targetVersion ?? "current"} with audit evidence.`
        : "Conversation already uses the current release.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Actor release could not migrate"); }
    finally { setLoading(false); }
  }
  function proposeFrom(turn: GovernedMemoryTurn) {
    setFactDraft({
      sourceTurnId: turn.id, content: turn.content.slice(0, 500), category: "customer_context",
      reason: "", expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)
    });
  }
  async function saveFactProposal() {
    if (!factDraft || !factDraft.content.trim() || factDraft.reason.trim().length < 5) {
      onNotice("Add a bounded fact and a specific reason of at least five characters."); return;
    }
    setLoading(true);
    try {
      await api.proposeExecutionFact(executionId, {
        ...factDraft, content: factDraft.content.trim(), reason: factDraft.reason.trim(),
        expiresAt: new Date(`${factDraft.expiresAt}T23:59:59.000Z`).toISOString()
      });
      setFactDraft(null); await load();
      onNotice("Durable fact proposed. It will not enter model context until separately approved.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Durable fact could not be proposed"); }
    finally { setLoading(false); }
  }
  async function saveFactAction() {
    if (!factAction || factAction.reason.trim().length < 5) {
      onNotice("Add a specific reason of at least five characters."); return;
    }
    setLoading(true);
    try {
      await api.governExecutionFact(executionId, factAction.fact.id, {
        action: factAction.action, expectedRevision: factAction.fact.revision,
        reason: factAction.reason.trim(),
        content: factAction.action === "correct" ? factAction.content.trim() : undefined
      });
      setFactAction(null); await load();
      onNotice(`Durable fact ${factAction.action === "approve" ? "approved for context" : `${factAction.action}d`}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Durable fact could not change"); }
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
      <span><strong>{memory.facts.filter((fact) => fact.status === "active").length}</strong> approved durable facts</span>
    </div>
    <div className={`actor-release-state ${memory.migrationAvailable ? "update" : "current"}`}>
      <div><small>INSTALLED RELEASE</small><strong>v{memory.currentVersion ?? "unknown"}</strong>
        <span>{memory.currentReleaseId ?? "No actor release recorded"}</span></div>
      <div><small>CURRENT PROCESS RELEASE</small><strong>v{memory.activeVersion ?? "none"}</strong>
        <span>{memory.activeReleaseId ?? "No published release"}</span></div>
      {memory.migrationAvailable ? <div className="actor-release-migrate">
        <label>Migration reason<textarea maxLength={500} value={migrationReason}
          placeholder="Why should this existing conversation adopt the current release?"
          onChange={(event) => setMigrationReason(event.target.value)}/></label>
        <button disabled={loading || migrationReason.trim().length < 10}
          onClick={() => void migrateRelease()}>Migrate this conversation</button>
        <small>Memory remains with this actor. Prompt, model, contracts, and tool policy move together.</small>
      </div> : <em>{memory.currentReleaseId && memory.currentReleaseId === memory.activeReleaseId
        ? "Current" : "No migration available"}</em>}
    </div>
    <div className="memory-turns">{memory.turns.length ? memory.turns.map((turn) =>
      <article className={turn.status} key={turn.id}><header><span>{turn.role}</span>
        <em>{turn.status} · revision {turn.revision}</em></header>
        <p>{turn.content}</p>
        <footer><small>{formatDate(turn.createdAt)}{turn.sourceExecutionId ? ` · run ${turn.sourceExecutionId.slice(0, 8)}` : " · legacy turn"}</small>
          {turn.status !== "deleted" && <span>
            <button onClick={() => proposeFrom(turn)}><BrainCircuit size={12}/>Propose fact</button>
            <button onClick={() => start(turn, "correct")}><Pencil size={12}/>Correct</button>
            {turn.status === "active"
              ? <button onClick={() => start(turn, "quarantine")}><XCircle size={12}/>Quarantine</button>
              : <button onClick={() => start(turn, "restore")}><Undo2 size={12}/>Restore</button>}
            <button className="delete" onClick={() => start(turn, "delete")}><Trash2 size={12}/>Delete</button>
          </span>}</footer>
        {turn.lastReason && <aside>Last change: {turn.lastReason}</aside>}
      </article>) : <p className="memory-empty">This actor has no stored conversation turns yet.</p>}</div>
    <div className="durable-facts"><header><div><small>APPROVED LONG-TERM CONTEXT</small>
      <h3>Durable facts</h3><p>Facts require provenance and a separate approval. Expired, proposed, and retired facts never enter model context.</p>
    </div><span>{memory.factPolicy.maximumActiveFacts} fact ceiling · {memory.factPolicy.maximumContextCharacters.toLocaleString()} characters</span></header>
      {memory.facts.length ? memory.facts.map((fact) => <article className={fact.status} key={fact.id}>
        <div><span>{fact.category.replace("_", " ")}</span><em>{fact.status} · revision {fact.revision}</em></div>
        <p>{fact.content}</p><small>Source turn {fact.sourceTurnId.slice(0, 8)} · expires {formatDate(fact.expiresAt)}</small>
        <footer>{fact.status === "proposed" && <button onClick={() => setFactAction({
          fact, action: "approve", content: fact.content, reason: ""
        })}>Approve for context</button>}
        {fact.status !== "retired" && <><button onClick={() => setFactAction({
          fact, action: "correct", content: fact.content, reason: ""
        })}>Correct proposal</button><button className="delete" onClick={() => setFactAction({
          fact, action: "retire", content: fact.content, reason: ""
        })}>Retire</button></>}</footer>
      </article>) : <p className="memory-empty">No durable facts have been proposed for this actor.</p>}
    </div></>}
    {edit && <div className="memory-editor"><div><strong>{edit.action} memory turn</strong>
      <button onClick={() => setEdit(null)}>Cancel</button></div>
      {edit.action === "correct" && <label>Corrected content<textarea maxLength={8000}
        value={content} onChange={(event) => setContent(event.target.value)}/></label>}
      <label>Reason<textarea maxLength={500} placeholder="Why is this change necessary?"
        value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      <button disabled={loading || !reason.trim() || (edit.action === "correct" && !content.trim())}
        onClick={() => void save()}>Apply governed change</button></div>}
    {factDraft && <div className="memory-editor"><div><strong>Propose durable fact</strong>
      <button onClick={() => setFactDraft(null)}>Cancel</button></div>
      <label>Category<select value={factDraft.category} onChange={(event) => setFactDraft({
        ...factDraft, category: event.target.value as DurableActorFact["category"]
      })}><option value="customer_context">Customer context</option><option value="preference">Preference</option>
        <option value="process_context">Process context</option><option value="constraint">Constraint</option></select></label>
      <label>Bounded fact<textarea maxLength={500} value={factDraft.content}
        onChange={(event) => setFactDraft({ ...factDraft, content: event.target.value })}/></label>
      <label>Expiry<input type="date" value={factDraft.expiresAt}
        onChange={(event) => setFactDraft({ ...factDraft, expiresAt: event.target.value })}/></label>
      <label>Proposal reason<textarea maxLength={500} value={factDraft.reason}
        placeholder="Why should this source turn become reusable context?"
        onChange={(event) => setFactDraft({ ...factDraft, reason: event.target.value })}/></label>
      <button disabled={loading || !factDraft.content.trim() || factDraft.reason.trim().length < 5}
        onClick={() => void saveFactProposal()}>Create reviewable proposal</button></div>}
    {factAction && <div className="memory-editor"><div><strong>{factAction.action} durable fact</strong>
      <button onClick={() => setFactAction(null)}>Cancel</button></div>
      {factAction.action === "correct" && <label>Corrected fact<textarea maxLength={500}
        value={factAction.content} onChange={(event) => setFactAction({ ...factAction, content: event.target.value })}/></label>}
      <label>Reason<textarea maxLength={500} value={factAction.reason}
        placeholder="Record the evidence for this decision."
        onChange={(event) => setFactAction({ ...factAction, reason: event.target.value })}/></label>
      <button disabled={loading || factAction.reason.trim().length < 5 ||
        (factAction.action === "correct" && !factAction.content.trim())}
        onClick={() => void saveFactAction()}>Apply fact decision</button></div>}
  </section>;
}

function ActorLocalWorkPanel({ executionId, session, onNotice }: {
  executionId: string; session: SessionData | null; onNotice: (message: string) => void;
}) {
  const [work, setWork] = useState<ActorLocalWork | null>(null);
  const [label, setLabel] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = ["admin", "builder", "owner", "operator"].includes(session?.user.role ?? "");
  async function load() {
    try { setWork((await api.actorLocalWork(executionId)).data); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Actor-local work could not load"); }
  }
  useEffect(() => { void load(); }, [executionId]);
  async function queueNow() {
    if (label.trim().length < 3) return onNotice("Describe the actor task with at least three characters.");
    setBusy(true);
    try {
      await api.queueActorLocalWork(executionId, label.trim());
      setLabel(""); await load(); onNotice("Task queued inside this durable actor.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Actor task could not be queued"); }
    finally { setBusy(false); }
  }
  async function schedule() {
    if (label.trim().length < 3 || !dueAt) return onNotice("Add a task description and due time.");
    setBusy(true);
    try {
      await api.scheduleActorLocalWork(executionId, label.trim(), new Date(dueAt).toISOString());
      setLabel(""); setDueAt(""); await load(); onNotice("Durable actor follow-up scheduled.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Follow-up could not be scheduled"); }
    finally { setBusy(false); }
  }
  async function cancel(scheduleId: string) {
    setBusy(true);
    try {
      await api.cancelActorLocalSchedule(executionId, scheduleId);
      await load(); onNotice("Actor follow-up cancelled.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Follow-up could not be cancelled"); }
    finally { setBusy(false); }
  }
  return <section className="actor-local-work">
    <header><span><Clock3 size={20}/></span><div><small>DURABLE ACTOR WORK</small>
      <h2>Tasks that stay with this actor</h2>
      <p>FIFO tasks and timed follow-ups live in the Durable Object. Worker restarts do not lose them, and D1 is not read on every turn.</p>
    </div><button disabled={busy} onClick={() => void load()} aria-label="Refresh actor work"><RefreshCw size={15}/></button></header>
    {canManage && <div className="actor-work-composer">
      <label>Task or follow-up description<input maxLength={160} value={label}
        placeholder="Review the customer response and notify the process owner"
        onChange={(event) => setLabel(event.target.value)}/></label>
      <label>Follow-up time<input type="datetime-local" value={dueAt}
        onChange={(event) => setDueAt(event.target.value)}/></label>
      <div><button disabled={busy || label.trim().length < 3} onClick={() => void queueNow()}>Queue now</button>
        <button disabled={busy || label.trim().length < 3 || !dueAt} onClick={() => void schedule()}>Schedule follow-up</button></div>
      <small>Descriptions pass through tenant DLP before actor storage. Follow-ups may be scheduled from 10 seconds to 30 days.</small>
    </div>}
    <div className="actor-work-list">{work?.tasks.length ? work.tasks.map((task) =>
      <article key={task.id} className={task.status}><div><strong>{task.label}</strong>
        <small>{task.kind === "schedule" && task.dueAt ? `Due ${formatDate(task.dueAt)}` :
          `Created ${formatDate(task.createdAt)}`}</small></div><span>{task.status.replaceAll("_", " ")}</span>
        {canManage && task.kind === "schedule" && task.status === "scheduled" && task.sdkReferenceId &&
          <button disabled={busy} onClick={() => void cancel(task.sdkReferenceId!)}>Cancel</button>}</article>)
      : <p>No actor-local tasks or follow-ups have been created.</p>}</div>
  </section>;
}

function ShadowReviewPanel({ review, session, onSaved, onNotice }: {
  review: ShadowReview; session: SessionData | null;
  onSaved: (review: ShadowReview) => void; onNotice: (message: string) => void;
}) {
  const [verdict, setVerdict] = useState<"match" | "partial" | "miss" | "unsafe">(review.verdict ?? "match");
  const [actualOutcome, setActualOutcome] = useState(review.actual_outcome ?? "");
  const [note, setNote] = useState(review.note ?? "");
  const [saving, setSaving] = useState(false);
  const canReview = Boolean(session && ["admin", "builder", "owner", "operator", "reviewer"].includes(session.user.role));
  async function save() {
    if (!actualOutcome.trim()) { onNotice("Record the actual human outcome before saving."); return; }
    setSaving(true);
    try {
      const result = await api.reviewShadowExecution(review.execution_id, {
        expectedRevision: review.revision, verdict, actualOutcome: actualOutcome.trim(), note: note.trim()
      });
      onSaved(result.data);
      onNotice("Shadow proposal compared with the actual outcome.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Shadow review could not be saved"); }
    finally { setSaving(false); }
  }
  return <section className="shadow-review">
    <header><span><Sparkles size={20}/></span><div><small>SAFE LEARNING MODE</small>
      <h2>Shadow outcome comparison</h2>
      <p>This model response was proposal-only. It triggered no external action and was not added to accepted assistant memory.</p>
    </div><em className={review.status}>{review.status}</em></header>
    {review.status === "reviewed" ? <div className="shadow-result">
      <span><small>VERDICT</small><strong>{review.verdict?.replaceAll("_", " ")}</strong></span>
      <span><small>ACTUAL HUMAN OUTCOME</small><strong>{review.actual_outcome}</strong></span>
      {review.note && <span><small>REVIEW NOTE</small><strong>{review.note}</strong></span>}
      <footer>Reviewed by {review.reviewer_name ?? "an authorized reviewer"} · {review.reviewed_at ? formatDate(review.reviewed_at) : "time unavailable"}</footer>
    </div> : canReview ? <div className="shadow-editor">
      <label>Comparison verdict<select value={verdict} onChange={(event) => setVerdict(event.target.value as typeof verdict)}>
        <option value="match">Match</option><option value="partial">Partial match</option>
        <option value="miss">Miss</option><option value="unsafe">Unsafe proposal</option>
      </select></label>
      <label>Actual human outcome<textarea maxLength={2000} value={actualOutcome}
        placeholder="What actually happened when a person completed this work?"
        onChange={(event) => setActualOutcome(event.target.value)}/></label>
      <label>Review note (optional)<textarea maxLength={1000} value={note}
        placeholder="Explain the important difference or learning."
        onChange={(event) => setNote(event.target.value)}/></label>
      <button disabled={saving || !actualOutcome.trim()} onClick={() => void save()}>
        {saving ? "Saving…" : "Save comparison evidence"}</button>
    </div> : <p className="shadow-readonly">An authorized reviewer must record the actual outcome.</p>}
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
    shadowed: "Shadow proposal only",
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
    shadowed: "No external action occurred and the response did not enter accepted assistant memory.",
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
