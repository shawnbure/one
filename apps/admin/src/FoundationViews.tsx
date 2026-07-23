import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Box,
  Check,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  FileText,
  GitCompare,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  Plus,
  ShieldCheck,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import { api, type EvaluationDetail, type GovernanceData } from "./api";

interface Props {
  section: "Connections" | "Knowledge" | "Evaluations" | "Governance";
  onNotice: (message: string) => void;
}

export function FoundationView({ section, onNotice }: Props) {
  const [data, setData] = useState<GovernanceData | null>(null);
  async function load() {
    try {
      setData((await api.governance()).data);
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Could not load governance data",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (!data)
    return <div className="loading-card">Loading {section.toLowerCase()}…</div>;
  if (section === "Connections") return <Connections data={data} onReload={load} onNotice={onNotice} />;
  if (section === "Knowledge") return <Knowledge data={data} />;
  if (section === "Evaluations") return <Evaluations data={data} onReload={load} onNotice={onNotice} />;
  return <Governance data={data} onReload={load} onNotice={onNotice} />;
}

function Connections({ data, onReload, onNotice }: { data: GovernanceData; onReload: () => Promise<void>; onNotice: (message: string) => void }) {
  const [checking, setChecking] = useState<string | null>(null);
  async function test(id: string) {
    setChecking(id);
    try {
      const result = await api.testConnection(id);
      onNotice(result.data.detail);
      await onReload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Connection check failed");
    } finally {
      setChecking(null);
    }
  }
  return (
    <section className="foundation-page">
      <Title
        icon={<Link2 size={14} />}
        eyebrow="INTEGRATION BOUNDARY"
        title="Connections"
        text="Credentials, permissions, ownership, and health for every system an AI process can reach."
      />
      <div className="foundation-grid">
        {data.connections.map((item) => (
          <article className="foundation-card panel" key={String(item.id)}>
            <div>
              <span className="foundation-icon">
                <Link2 size={18} />
              </span>
              <span className={`connection-state ${item.status}`}>
                <i />
                {item.status}
              </span>
            </div>
            <h2>{item.name}</h2>
            <p>
              {String(item.kind).replaceAll("_", " ")} ·{" "}
              {String(item.access_mode).replaceAll("_", " ")} access
            </p>
            <dl>
              <div>
                <dt>Owner</dt>
                <dd>{item.owner}</dd>
              </div>
              <div>
                <dt>Credential</dt>
                <dd>
                  {Number(item.secret_configured) ? "Configured" : "Required"}
                </dd>
              </div>
              <div>
                <dt>Last health check</dt>
                <dd>{item.last_checked_at || "Never"}</dd>
              </div>
            </dl>
            <div className="scope-row">
              {parseArray(String(item.scopes_json)).map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
            </div>
            <button disabled={checking === String(item.id)} onClick={() => void test(String(item.id))}>
              <RefreshCw size={14} />
              {checking === String(item.id) ? "Checking…" : "Test connection"}
            </button>
          </article>
        ))}
      </div>
      <div className="webhook-section">
        <div className="section-head">
          <div>
            <h2>Inbound webhooks</h2>
            <p>Signed, idempotent process triggers with Queue buffering.</p>
          </div>
        </div>
        {data.webhooks.map((webhook) => (
          <article className="webhook-row panel" key={webhook.id}>
            <span className="foundation-icon">
              <KeyRound size={17} />
            </span>
            <span>
              <strong>{webhook.name}</strong>
              <small>
                POST /webhooks/{webhook.id} · {webhook.blueprint_id}
              </small>
            </span>
            <span>
              <small>ACCEPTS</small>
              <strong>
                {parseArray(webhook.accepted_events_json).join(", ")}
              </strong>
            </span>
            <span>
              <small>SECRET</small>
              <strong>
                {webhook.secret_configured ? "Configured" : "Required"}
              </strong>
            </span>
            <span
              className={`connection-state ${webhook.status === "active" ? "healthy" : "attention"}`}
            >
              <i />
              {webhook.status}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
function Knowledge({ data }: { data: GovernanceData }) {
  return (
    <section className="foundation-page">
      <Title
        icon={<Database size={14} />}
        eyebrow="PROVENANCE AND ACCESS"
        title="Knowledge"
        text="Approved sources remain attributable, sensitivity-labelled, and explicitly bound to processes."
      />
      <div className="knowledge-list panel">
        {data.knowledge.map((item) => (
          <article key={String(item.id)}>
            <span className="knowledge-icon">
              <FileText size={19} />
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.provenance}</small>
              <em>
                {parseArray(item.allowed_processes_json ?? "[]").join(" · ")}
              </em>
            </span>
            <span>
              <small>SENSITIVITY</small>
              <strong>{item.sensitivity}</strong>
            </span>
            <span>
              <small>OWNER</small>
              <strong>{item.owner}</strong>
            </span>
            <span className={`connection-state ${item.status}`}>
              <i />
              {item.status}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
function Evaluations({ data, onReload, onNotice }: { data: GovernanceData; onReload: () => Promise<void>; onNotice: (message: string) => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [savingCase, setSavingCase] = useState(false);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [sampleExecution, setSampleExecution] = useState("");
  const [candidateProfile, setCandidateProfile] = useState("fast");
  const [trialRunning, setTrialRunning] = useState(false);
  const [caseForm, setCaseForm] = useState({ name: "", input: "", expected: "", prohibited: "", format: "text" as "text" | "json", maxChars: 2000 });
  const passing = data.evaluations.filter(
    (item) => item.status === "passing",
  ).length;
  async function inspect(id: string) {
    setSelected(id);
    try {
      const next = (await api.evaluation(id)).data;
      setDetail(next);
      const baseline = next.runs[0]?.model_profile;
      setCandidateProfile((current) => current !== baseline ? current : (next.modelProfiles.find((profile) => profile.id !== baseline)?.id ?? current));
    }
    catch (error) { onNotice(error instanceof Error ? error.message : "Evaluation detail could not load"); }
  }
  async function run(id: string) {
    setRunning(id);
    try {
      const result = await api.runEvaluation(id);
      onNotice(`Evaluation ${result.data.status}: ${(result.data.score * 100).toFixed(0)}% · ${result.data.passedAssertions}/${result.data.assertionCount} assertions`);
      await onReload();
      if (selected === id) await inspect(id);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Evaluation could not run");
    } finally {
      setRunning(null);
    }
  }
  async function addCase() {
    if (!selected) return;
    setSavingCase(true);
    try {
      await api.createEvaluationCase(selected, {
        name: caseForm.name, input: caseForm.input,
        expectedPhrases: phrases(caseForm.expected), prohibitedPhrases: phrases(caseForm.prohibited),
        format: caseForm.format, maxChars: caseForm.maxChars
      });
      setCaseForm({ name: "", input: "", expected: "", prohibited: "", format: "text", maxChars: 2000 });
      await inspect(selected);
      await onReload();
      onNotice("Golden case added; the scenario must be rerun before release promotion.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Evaluation case could not be created"); }
    finally { setSavingCase(false); }
  }
  async function queueSuite() {
    if (!selected) return;
    setSuiteRunning(true);
    try {
      const result = await api.queueEvaluationSuite(selected);
      await inspect(selected);
      onNotice(`Durable regression suite queued (${result.data.id.slice(0, 8)}). It will continue if the request disconnects.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Evaluation suite could not be queued"); }
    finally { setSuiteRunning(false); }
  }
  async function review(resultId: string, score: number, verdict: "acceptable" | "needs_work" | "unsafe") {
    try {
      await api.reviewEvaluationResult(resultId, { score, verdict });
      if (selected) await inspect(selected);
      onNotice("Human quality score saved to the release evidence.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Human review could not be saved"); }
  }
  async function promoteSample() {
    if (!selected || !sampleExecution.trim()) return;
    try {
      await api.promoteEvaluationSample(selected, {
        executionId: sampleExecution.trim(), expectedPhrases: phrases(caseForm.expected),
        prohibitedPhrases: phrases(caseForm.prohibited), format: caseForm.format, maxChars: caseForm.maxChars
      });
      setSampleExecution("");
      await inspect(selected);
      await onReload();
      onNotice("The stored, truncated execution preview was promoted into a regression case.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Production sample could not be promoted"); }
  }
  async function compareModels() {
    if (!selected) return;
    setTrialRunning(true);
    try {
      const result = await api.queueModelTrial(selected, { candidateProfile });
      await inspect(selected);
      onNotice(`${result.data.baselineProfile} vs ${result.data.candidateProfile} queued as an isolated Workflow trial.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Model comparison could not be queued"); }
    finally { setTrialRunning(false); }
  }
  const latest = detail?.runs[0];
  const previous = detail?.runs.find((run) => run.release_id !== latest?.release_id) ?? detail?.runs[1];
  const delta = latest && previous ? (Number(latest.score) - Number(previous.score)) * 100 : null;
  return (
    <section className="foundation-page">
      <Title
        icon={<FileCheck2 size={14} />}
        eyebrow="QUALITY AND RELEASE GATES"
        title="Evaluations"
        text="Deterministic policy checks and golden scenarios protect every behavior release."
      />
      <div className="evaluation-score panel">
        <span className="score-ring">
          {passing}/{data.evaluations.length}
        </span>
        <div>
          <h2>Release gate health</h2>
          <p>
            All required scenarios must pass before a high-impact process
            release can be promoted.
          </p>
        </div>
        <span className={passing === data.evaluations.length && passing > 0 ? "healthy" : "connection-state attention"}>
          <i />
          {passing === data.evaluations.length && passing > 0 ? "Passing" : "Action required"}
        </span>
      </div>
      <div className="evaluation-list panel">
        {data.evaluations.map((item) => (
          <article key={String(item.id)}>
            <span className={`eval-icon ${item.status}`}>
              {item.status === "passing" ? (
                <CheckCircle2 size={18} />
              ) : (
                <XCircle size={18} />
              )}
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.process_name} · {item.category}
              </small>
            </span>
            <span>
              <small>ASSERTIONS</small>
              <strong>{item.assertion_count}</strong>
            </span>
            <span>
              <small>LAST RUN</small>
              <strong>{item.last_run_at}</strong>
            </span>
            <span className={`connection-state ${item.status}`}>
              <i />
              {item.status}
            </span>
            <span className="evaluation-actions"><button onClick={() => void inspect(String(item.id))}><GitCompare size={14}/>Compare</button>
              <button disabled={running === item.id} onClick={() => void run(String(item.id))}><RefreshCw size={14} /> {running === item.id ? "Running…" : "Run"}</button></span>
          </article>
        ))}
      </div>
      {selected && <div className="evaluation-lab panel">
        {!detail ? <div className="loading-card">Loading evaluation lab…</div> : <>
          <div className="section-head"><div><h2>{detail.scenario.name}</h2><p>{detail.scenario.process_name} · exact-release golden-case regression</p></div><span className="evaluation-lab-actions"><span>{detail.cases.length} cases</span><button disabled={suiteRunning} onClick={() => void queueSuite()}><Workflow size={15}/>{suiteRunning ? "Queueing…" : "Run durable suite"}</button></span></div>
          <div className="comparison-strip">
            <article><small>LATEST RELEASE</small><strong>{latest ? `v${latest.release_version ?? "?"} · ${(Number(latest.score) * 100).toFixed(0)}%` : "Not run"}</strong><span className={`connection-state ${latest?.status ?? "attention"}`}><i/>{latest?.status ?? "not run"}</span></article>
            <article><small>PREVIOUS COMPARISON</small><strong>{previous ? `v${previous.release_version ?? "?"} · ${(Number(previous.score) * 100).toFixed(0)}%` : "No baseline"}</strong><span>{delta === null ? "Run another release to compare" : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)} percentage points`}</span></article>
            <article><small>RELEASE COST</small><strong>{latest ? money(Number(latest.estimated_cost_usd)) : "$0.0000"}</strong><span>{latest ? `${number(Number(latest.total_tokens))} model tokens` : "No inference recorded"}</span></article>
          </div>
          <div className="model-trials">
            <div className="section-head"><div><h3>Cloudflare model shadow comparison</h3><p>Run identical release prompts and cases without changing the live process model.</p></div><span className="trial-controls"><select value={candidateProfile} onChange={(event) => setCandidateProfile(event.target.value)}>{detail.modelProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.use}</option>)}</select><button disabled={trialRunning} onClick={() => void compareModels()}><GitCompare size={15}/>{trialRunning ? "Queueing…" : "Compare model"}</button></span></div>
            {detail.modelTrials.length ? detail.modelTrials.slice(0, 4).map((trial) => <article key={trial.id}><span><strong>{trial.baseline_profile} baseline</strong><small>{trial.baseline_score === null ? "Waiting" : `${(Number(trial.baseline_score) * 100).toFixed(0)}% · ${money(Number(trial.baseline_cost_usd))} · ${number(Number(trial.baseline_tokens))} tokens`}</small></span><GitCompare size={17}/><span><strong>{trial.candidate_profile} candidate</strong><small>{trial.candidate_score === null ? "Waiting" : `${(Number(trial.candidate_score) * 100).toFixed(0)}% · ${money(Number(trial.candidate_cost_usd))} · ${number(Number(trial.candidate_tokens))} tokens`}</small></span><span className={`connection-state ${trial.status}`}><i/>{trial.status}</span><p>{trial.recommendation ?? trial.error ?? "Workflow trial is running"}</p></article>) : <p className="empty-copy">No model trials yet. The release baseline remains unchanged until you create and publish a new release.</p>}
          </div>
          <div className="suite-history">
            <div className="section-head"><div><h3>Durable suite history</h3><p>Cloudflare Workflows preserve retries and completion outside the browser request.</p></div></div>
            {detail.suites.length ? detail.suites.slice(0, 5).map((suite) => <article key={suite.id}><Workflow size={16}/><span><strong>{suite.mode} · {suite.id.slice(0, 8)}</strong><small>{suite.completed_at ?? suite.started_at ?? suite.created_at}</small></span><span className={`connection-state ${suite.status}`}><i/>{suite.status}</span><strong>{suite.score === null ? "—" : `${(Number(suite.score) * 100).toFixed(0)}%`}</strong></article>) : <p className="empty-copy">No durable suites queued yet. The quick Run action remains available for small interactive checks.</p>}
          </div>
          <div className="golden-layout">
            <div className="golden-cases"><div className="section-head"><div><h3>Golden cases</h3><p>Anonymized inputs and deterministic output properties.</p></div></div>
              {detail.cases.map((item) => { const result = latest ? detail.caseResults.find((row) => row.run_id === latest.id && row.case_id === item.id) : null; const human = result ? detail.humanReviews.find((row) => row.case_result_id === result.id) : null; const redaction = redactionLabel(item.redaction_json); return <article key={item.id}><span className={`eval-icon ${result?.status ?? "attention"}`}>{result?.status === "passing" ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}</span><span><strong>{item.name}</strong><small>{assertionLabel(item.assertions_json)} · {item.source}{redaction ? ` · ${redaction}` : ""}</small>{result && <span className="human-score"><small>Human score: {human ? `${human.score}/5 · ${human.verdict.replaceAll("_", " ")}` : "not reviewed"}</small><button onClick={() => void review(result.id, 5, "acceptable")}>Accept</button><button onClick={() => void review(result.id, 3, "needs_work")}>Needs work</button><button onClick={() => void review(result.id, 1, "unsafe")}>Unsafe</button></span>}</span><span className={`connection-state ${result?.status ?? "attention"}`}><i/>{result?.status ?? "not run"}</span>{result && <small>{result.latency_ms} ms · {result.passed_assertions}/{result.assertion_count}</small>}</article>; })}
            </div>
            <div className="case-builder"><div className="section-head"><div><h3>Add golden case</h3><p>Use anonymized facts only.</p></div><Plus size={16}/></div>
              <label>Case name<input value={caseForm.name} onChange={(event) => setCaseForm({ ...caseForm, name: event.target.value })}/></label>
              <label>Anonymized input<textarea value={caseForm.input} onChange={(event) => setCaseForm({ ...caseForm, input: event.target.value })}/></label>
              <label>Required phrases <small>comma separated</small><input value={caseForm.expected} onChange={(event) => setCaseForm({ ...caseForm, expected: event.target.value })}/></label>
              <label>Prohibited phrases <small>comma separated</small><input value={caseForm.prohibited} onChange={(event) => setCaseForm({ ...caseForm, prohibited: event.target.value })}/></label>
              <div className="case-fields"><label>Format<select value={caseForm.format} onChange={(event) => setCaseForm({ ...caseForm, format: event.target.value as "text" | "json" })}><option value="text">Text</option><option value="json">Valid JSON</option></select></label><label>Max characters<input type="number" min="1" max="50000" value={caseForm.maxChars} onChange={(event) => setCaseForm({ ...caseForm, maxChars: Number(event.target.value) })}/></label></div>
              <button className="primary" disabled={savingCase} onClick={() => void addCase()}>{savingCase ? "Adding…" : "Add regression case"}</button>
              <div className="sample-promoter"><strong>Promote a production sample</strong><small>Explicitly reuse only Workrr’s stored, truncated input preview. Required/prohibited assertions above apply.</small><input placeholder="Completed execution ID" value={sampleExecution} onChange={(event) => setSampleExecution(event.target.value)}/><button disabled={!sampleExecution.trim()} onClick={() => void promoteSample()}>Promote redacted preview</button></div>
            </div>
          </div>
        </>}
      </div>}
    </section>
  );
}

function phrases(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function assertionLabel(value: string) {
  try { const items = JSON.parse(value) as Array<{ type: string }>; return `${items.length} assertions · ${items.map((item) => item.type.replaceAll("_", " ")).join(" · ")}`; }
  catch { return "Assertions require review"; }
}
function redactionLabel(value: string) {
  try { const item = JSON.parse(value) as { count?: number }; return item.count ? `${item.count} sensitive value${item.count === 1 ? "" : "s"} masked` : ""; }
  catch { return ""; }
}
function money(value: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value || 0); }
function number(value: number) { return new Intl.NumberFormat().format(value || 0); }

function Governance({
  data,
  onReload,
  onNotice,
}: {
  data: GovernanceData;
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const ready = data.readiness.filter((item) => item.ready).length;
  const [containmentReason, setContainmentReason] = useState("");
  const [incidentNote, setIncidentNote] = useState("");
  const [incidentForm, setIncidentForm] = useState({ title: "", severity: "medium", blueprintId: "", impact: "" });
  const [incidentBusy, setIncidentBusy] = useState(false);
  async function mode(processId: string | undefined, nextMode: string) {
    if (!processId) return;
    try {
      await api.setProcessMode(
        processId,
        nextMode,
        "Changed from Governance Center",
      );
      onNotice(
        `Process operating mode changed to ${nextMode.replaceAll("_", " ")}.`,
      );
      await onReload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Mode change failed");
    }
  }
  async function tenantMode(next: "active" | "drain" | "emergency_stop") {
    if (!containmentReason.trim()) { onNotice("Enter a containment or recovery reason first."); return; }
    setIncidentBusy(true);
    try {
      await api.setTenantMode({ mode: next, reason: containmentReason,
        incidentId: data.tenantControl.incident_id ?? undefined });
      setContainmentReason("");
      await onReload();
      onNotice(`Tenant operating mode changed to ${next.replaceAll("_", " ")}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Tenant mode change failed"); }
    finally { setIncidentBusy(false); }
  }
  async function openIncident() {
    if (!incidentForm.title.trim()) { onNotice("Incident title is required."); return; }
    setIncidentBusy(true);
    try {
      await api.createIncident({ ...incidentForm, blueprintId: incidentForm.blueprintId || undefined, category: "operations" });
      setIncidentForm({ title: "", severity: "medium", blueprintId: "", impact: "" });
      await onReload();
      onNotice("Incident opened with an evidence timeline.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Incident could not be opened"); }
    finally { setIncidentBusy(false); }
  }
  async function transition(id: string, status: string) {
    if (!incidentNote.trim()) { onNotice("Enter a transition note first."); return; }
    setIncidentBusy(true);
    try {
      await api.transitionIncident(id, { status, note: incidentNote });
      setIncidentNote("");
      await onReload();
      onNotice(`Incident moved to ${status}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Incident transition failed"); }
    finally { setIncidentBusy(false); }
  }
  return (
    <section className="foundation-page">
      <div className="governance-title">
        <Title
          icon={<ShieldCheck size={14} />}
          eyebrow="PRIVACY AND CONTROL"
          title="Governance"
          text="A demonstrable private-AI posture: models, data flows, roles, retention, releases, and emergency controls."
        />
        <a className="export-button" href="/api/governance/export">
          <Download size={15} /> Export readiness evidence
        </a>
      </div>
      <div className="governance-top">
        <article className="readiness panel">
          <div className="section-head">
            <div>
              <h2>Deployment readiness</h2>
              <p>
                {ready} of {data.readiness.length} controls ready
              </p>
            </div>
            <span
              className={
                ready === data.readiness.length
                  ? "ready-badge"
                  : "attention-badge"
              }
            >
              {Math.round((ready / data.readiness.length) * 100)}%
            </span>
          </div>
          <div className="readiness-bar">
            <i style={{ width: `${(ready / data.readiness.length) * 100}%` }} />
          </div>
          {data.readiness.map((item) => (
            <div className="readiness-row" key={item.id}>
              {item.ready ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )}
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
        </article>
        <article className="data-flow panel">
          <div className="section-head">
            <div>
              <h2>Private AI data flow</h2>
              <p>Customer-dedicated Cloudflare boundary</p>
            </div>
            <LockKeyhole size={18} />
          </div>
          <div>
            {data.dataFlow.map((node, index) => (
              <span key={node}>
                <i>
                  {index === 0 ? (
                    <Box size={16} />
                  ) : index === 3 ? (
                    <Bot size={16} />
                  ) : index === 4 ? (
                    <Users size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                </i>
                <strong>{node}</strong>
                {index < data.dataFlow.length - 1 && <ArrowRight size={14} />}
              </span>
            ))}
          </div>
        </article>
      </div>
      <div className="governance-section panel">
        <div className="section-head">
          <div>
            <h2>Process operating controls</h2>
            <p>
              Changes take effect immediately and are recorded in the
              administrative audit log.
            </p>
          </div>
        </div>
        {data.processes.map((process) => (
          <div className="control-row" key={process.id}>
            <span>
              <strong>{process.name}</strong>
              <small>
                {process.business_owner} · {process.risk_level} risk ·{" "}
                {process.autonomy} autonomy
              </small>
            </span>
            <select
              value={process.operating_mode}
              onChange={(event) => void mode(process.id, event.target.value)}
            >
              <option value="active">Active</option>
              <option value="read_only">Read only</option>
              <option value="approval_only">Approval only</option>
              <option value="paused">Paused</option>
              <option value="drain">Drain</option>
              <option value="emergency_stop">Emergency stop</option>
            </select>
          </div>
        ))}
      </div>
      <div className={`incident-command panel tenant-${data.tenantControl.mode}`}>
        <div className="section-head"><div><span className="eyebrow"><AlertTriangle size={14}/> INCIDENT RESPONSE</span><h2>Containment & recovery</h2><p>Stop new work immediately, preserve evidence, and recover only after containment.</p></div><span className={`tenant-mode ${data.tenantControl.mode}`}><i/>{data.tenantControl.mode.replaceAll("_", " ")}</span></div>
        <div className="tenant-containment">
          <span><strong>Tenant-wide admission control</strong><small>{data.tenantControl.reason || "All processes currently use their individual operating modes."}</small></span>
          <input placeholder="Required containment or recovery reason" value={containmentReason} onChange={(event) => setContainmentReason(event.target.value)}/>
          <button disabled={incidentBusy} onClick={() => void tenantMode("drain")}>Drain new work</button>
          <button className="danger" disabled={incidentBusy} onClick={() => void tenantMode("emergency_stop")}>Emergency stop</button>
          <button className="recover" disabled={incidentBusy || data.tenantControl.mode === "active"} onClick={() => void tenantMode("active")}>Restore tenant</button>
        </div>
        <div className="incident-layout">
          <div className="incident-register"><div className="section-head"><div><h3>Incident register</h3><p>Owner, severity, containment state, and immutable timeline evidence.</p></div></div>
            <label className="incident-note">Transition evidence<input placeholder="Required note for the next incident transition" value={incidentNote} onChange={(event) => setIncidentNote(event.target.value)}/></label>
            {data.incidents.length ? data.incidents.map((incident) => <article key={incident.id}><span className={`incident-severity ${incident.severity}`}>{incident.severity}</span><span><strong>{incident.title}</strong><small>{incident.process_name || "Tenant-wide"} · {incident.category} · opened {incident.opened_at}</small><em>{incident.impact || "Impact assessment pending"}</em></span><span className={`connection-state ${incident.status}`}><i/>{incident.status}</span><span className="incident-actions">{nextIncidentActions(incident.status).map((action) => <button key={action} disabled={incidentBusy} onClick={() => void transition(incident.id, action)}>{action}</button>)}</span></article>) : <p className="empty-copy">No incidents recorded. Controls remain ready.</p>}
          </div>
          <div className="incident-builder"><div className="section-head"><div><h3>Open incident</h3><p>Start the evidence record before investigation.</p></div></div>
            <label>Title<input value={incidentForm.title} onChange={(event) => setIncidentForm({ ...incidentForm, title: event.target.value })}/></label>
            <label>Severity<select value={incidentForm.severity} onChange={(event) => setIncidentForm({ ...incidentForm, severity: event.target.value })}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <label>Affected process<select value={incidentForm.blueprintId} onChange={(event) => setIncidentForm({ ...incidentForm, blueprintId: event.target.value })}><option value="">Tenant-wide / unknown</option>{data.processes.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}</select></label>
            <label>Known impact<textarea value={incidentForm.impact} onChange={(event) => setIncidentForm({ ...incidentForm, impact: event.target.value })}/></label>
            <button className="primary" disabled={incidentBusy} onClick={() => void openIncident()}>Open incident</button>
          </div>
        </div>
      </div>
      <div className="governance-bottom">
        <article className="model-inventory panel">
          <div className="section-head">
            <div>
              <h2>Model inventory</h2>
              <p>Approved inference profiles</p>
            </div>
          </div>
          {data.models.map((model) => (
            <div key={model.profile}>
              <span className="foundation-icon">
                <Bot size={16} />
              </span>
              <span>
                <strong>{model.profile}</strong>
                <small>
                  {model.provider} · {model.boundary}
                </small>
              </span>
              <em>{model.processes} processes</em>
            </div>
          ))}
        </article>
        <article className="retention panel">
          <div className="section-head">
            <div>
              <h2>Retention policy</h2>
              <p>Scheduled lifecycle controls</p>
            </div>
          </div>
          {data.retention.map((policy) => (
            <div key={String(policy.id)}>
              <span>
                <strong>{policy.name}</strong>
                <small>
                  {policy.data_class} ·{" "}
                  {String(policy.deletion_mode).replaceAll("_", " ")}
                </small>
              </span>
              <em>{policy.retention_days} days</em>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}

function nextIncidentActions(status: string) {
  if (status === "open") return ["investigating", "contained"];
  if (status === "investigating") return ["contained", "resolved"];
  if (status === "contained") return ["monitoring", "resolved"];
  if (status === "monitoring") return ["resolved", "investigating"];
  if (status === "resolved") return ["closed", "investigating"];
  return [];
}

function Title({
  icon,
  eyebrow,
  title,
  text,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">
          {icon}
          {eyebrow}
        </span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
function parseArray(value: string): string[] {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}
