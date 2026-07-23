import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  Clock3,
  FileCode2,
  Download,
  GitBranch,
  History,
  Play,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  Workflow,
  Upload,
  Archive,
  AlertTriangle,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import {
  modelProfiles,
  supportedWorkersAIModels,
  workersAIModelCatalog,
  type AgentBlueprint,
  type SupportedWorkersAIModel,
} from "@workrr/contracts";
import { api, type ActorReleaseRollout, type ProcessRelease, type ProcessRetirementData, type ScheduleData, type SessionData, type StudioData } from "./api";
import "./schedule-studio.css";
import "./autonomy-safety.css";

interface Props {
  processId: string | null;
  processes: AgentBlueprint[];
  session: SessionData | null;
  onSelect: (id: string | null) => void;
  onNotice: (message: string) => void;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
}

export function ProcessStudioView({
  processId,
  processes,
  session,
  onSelect,
  onNotice,
  onCreate,
  onRefresh,
}: Props) {
  if (!processId)
    return <ProcessPortfolio processes={processes} onSelect={onSelect} onCreate={onCreate} onNotice={onNotice} onRefresh={onRefresh} />;
  return (
    <Studio
      processId={processId}
      session={session}
      onBack={() => onSelect(null)}
      onNotice={onNotice}
    />
  );
}

function ProcessPortfolio({
  processes,
  onSelect,
  onCreate,
  onNotice,
  onRefresh,
}: {
  processes: AgentBlueprint[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [importing, setImporting] = useState(false);
  async function importFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      if (file.size > 256_000) throw new Error("Process package exceeds 256 KB");
      const result = await api.importProcessPackage(JSON.parse(await file.text()));
      await onRefresh();
      onNotice(`Imported process ${result.data.id} as a paused draft.`);
      onSelect(result.data.id);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Process package import failed"); }
    finally { setImporting(false); }
  }
  return (
    <section className="studio-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            <Workflow size={14} /> PROCESS PORTFOLIO
          </span>
          <h1>AI processes</h1>
          <p>
            Operational capabilities with explicit owners, releases, models, and
            human controls.
          </p>
        </div>
        <div className="portfolio-actions"><label className="secondary import-package"><Upload size={16}/>{importing ? "Importing…" : "Import package"}<input type="file" accept="application/json,.json" disabled={importing} onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }}/></label><button className="primary" onClick={onCreate}><Plus size={16} />Create process</button></div>
      </div>
      <div className="portfolio-grid">
        {processes.map((process) => (
          <button
            key={process.id}
            className="portfolio-card panel"
            onClick={() => onSelect(process.id)}
          >
            <div>
              <span className={`process-icon ${process.executionProfile}`}>
                <Workflow size={19} />
              </span>
              <span className={`status ${process.status}`}>
                <i />
                {process.status}
              </span>
            </div>
            <h2>{process.name}</h2>
            <p>{process.description}</p>
            <dl>
              <div>
                <dt>Execution</dt>
                <dd>{process.executionProfile.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{process.modelProfile}</dd>
              </div>
              <div>
                <dt>Autonomy</dt>
                <dd>{process.autonomy}</dd>
              </div>
            </dl>
            <span className="open-studio">
              Open Process Studio <ChevronRight size={15} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Studio({
  processId,
  session,
  onBack,
  onNotice,
}: {
  processId: string;
  session: SessionData | null;
  onBack: () => void;
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<StudioData | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData>({ schedules: [], dispatches: [] });
  const [retirementData, setRetirementData] = useState<ProcessRetirementData | null>(null);
  const [rollouts, setRollouts] = useState<ActorReleaseRollout[]>([]);
  const [tab, setTab] = useState<"design" | "behavior" | "schedules" | "releases" | "retirement">("design");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [guardrails, setGuardrails] = useState("");
  const [modelProfile, setModelProfile] = useState("balanced");
  const [modelId, setModelId] = useState<SupportedWorkersAIModel>(modelProfiles.balanced.model);
  const [autonomy, setAutonomy] = useState("approve");
  const [notes, setNotes] = useState("");
  const [inputSchema, setInputSchema] = useState("");
  const [outputSchema, setOutputSchema] = useState("");
  const [busy, setBusy] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<ProcessRelease | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [rolloutPercentage, setRolloutPercentage] = useState(25);
  const [rolloutReason, setRolloutReason] = useState("");
  const [safetyForm, setSafetyForm] = useState({
    enabled: true, minTerminalRuns: 5, successThreshold: 70, windowHours: 24
  });
  const [safetyClearReason, setSafetyClearReason] = useState("");

  async function load() {
    try {
      const [result, schedules, retirement, actorRollouts] = await Promise.all([
        api.studio(processId).then((response) => response.data),
        api.schedules(processId).then((response) => response.data),
        api.processRetirement(processId).then((response) => response.data),
        api.actorReleaseRollouts(processId).then((response) => response.data),
      ]);
      setData(result);
      setScheduleData(schedules);
      setRetirementData(retirement);
      setRollouts(actorRollouts);
      setSystemPrompt(result.prompt.system_prompt);
      setInstructions(parseList(result.prompt.instructions_json).join("\n"));
      setGuardrails(parseList(result.prompt.guardrails_json).join("\n"));
      const active = result.releases.find((release) => release.status === "published");
      const loadedProfile = (active?.model_profile ?? result.blueprint.model_profile ?? "balanced") as keyof typeof modelProfiles;
      setModelProfile(loadedProfile);
      setModelId(
        active?.model_id && supportedWorkersAIModels.includes(active.model_id as SupportedWorkersAIModel)
          ? active.model_id as SupportedWorkersAIModel
          : modelProfiles[loadedProfile].model,
      );
      setAutonomy(result.blueprint.autonomy ?? "approve");
      setSafetyForm({
        enabled: result.autonomySafety.state.enabled,
        minTerminalRuns: result.autonomySafety.state.minTerminalRuns,
        successThreshold: result.autonomySafety.state.successThreshold,
        windowHours: result.autonomySafety.state.windowHours,
      });
      setInputSchema(prettySchema(active?.input_schema_json));
      setOutputSchema(prettySchema(active?.output_schema_json));
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Could not load Process Studio",
      );
    }
  }
  useEffect(() => {
    void load();
  }, [processId]);
  const activeRelease = useMemo(
    () => data?.releases.find((release) => release.status === "published"),
    [data],
  );
  const canManageSafety = ["admin", "owner"].includes(session?.user.role ?? "");

  async function saveSafetyPolicy() {
    if (!data) return;
    setBusy(true);
    try {
      const result = await api.updateAutonomySafety(processId, {
        ...safetyForm, expectedRevision: data.autonomySafety.state.revision
      });
      setData({ ...data, autonomySafety: result.data });
      onNotice("Automatic autonomy fallback policy saved and audited.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Fallback policy could not be saved");
    } finally { setBusy(false); }
  }

  async function clearSafetyFallback() {
    if (!data) return;
    setBusy(true);
    try {
      const result = await api.clearAutonomySafety(processId, {
        reason: safetyClearReason, expectedRevision: data.autonomySafety.state.revision
      });
      setData({ ...data, autonomySafety: result.data });
      setSafetyClearReason("");
      onNotice("Safety fallback cleared with owner evidence. Published autonomy is eligible again.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Safety fallback could not be cleared");
    } finally { setBusy(false); }
  }

  async function saveDraft() {
    setBusy(true);
    try {
      const parsedInputSchema = parseSchemaEditor(inputSchema, "Input");
      const parsedOutputSchema = parseSchemaEditor(outputSchema, "Output");
      const result = await api.createRelease(processId, {
        systemPrompt,
        instructions: lines(instructions),
        guardrails: lines(guardrails),
        modelProfile,
        modelId,
        autonomy,
        releaseNotes: notes,
        inputSchema: parsedInputSchema,
        outputSchema: parsedOutputSchema,
      });
      onNotice(`Draft release v${result.version} created.`);
      setNotes("");
      setTab("releases");
      await load();
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Could not create release",
      );
    } finally {
      setBusy(false);
    }
  }
  async function publish(release: ProcessRelease) {
    setBusy(true);
    try {
      const result = await api.publishRelease(processId, release.id);
      onNotice(
        `${release.status === "retired" ? "Rollback" : "Release"} v${result.version} is now active.`,
      );
      await load();
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Could not publish release",
      );
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    if (!rollbackTarget) return;
    setBusy(true);
    try {
      const result = await api.rollbackRelease(processId, rollbackTarget.id, {
        reason: rollbackReason.trim(), confirmVersion: Number(rollbackVersion)
      });
      onNotice(`Release v${result.version} restored with governed rollback evidence.`);
      setRollbackTarget(null); setRollbackReason(""); setRollbackVersion("");
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not roll back release");
    } finally { setBusy(false); }
  }

  async function startActorRollout() {
    if (!activeRelease) return;
    setBusy(true);
    try {
      const result = await api.createActorReleaseRollout(processId, {
        percentage: rolloutPercentage, targetReleaseId: activeRelease.id, reason: rolloutReason.trim()
      });
      setRolloutReason("");
      await load();
      onNotice(`Queued ${result.data.selectedActorCount} actor migration${result.data.selectedActorCount === 1 ? "" : "s"} in a durable Workflow.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Actor release rollout could not start");
    } finally { setBusy(false); }
  }

  if (!data) return <div className="loading-card">Loading Process Studio…</div>;
  const blueprint = data.blueprint;
  const canActivate = Boolean(session && ["admin", "owner"].includes(session.user.role));
  const activeActorRollout = rollouts.find((rollout) => ["queued", "running"].includes(rollout.status));
  const executionProfile = blueprint.execution_profile ?? "instant";
  const tools = data.activeTools ?? JSON.parse(blueprint.tools_json ?? "[]") as string[];
  return (
    <section className="studio-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        Process portfolio
      </button>
      <div className="studio-title">
        <div>
          <span className={`process-icon large ${blueprint.execution_profile}`}>
            <Workflow size={21} />
          </span>
          <div>
            <span className="eyebrow">PROCESS STUDIO</span>
            <h1>{blueprint.name}</h1>
            <p>{blueprint.description}</p>
          </div>
        </div>
        <div className="studio-title-actions"><a className="export-button" href={`/api/processes/${encodeURIComponent(processId)}/package`}><Download size={15}/>Export package</a><div className="release-chip">
          <i />
          <span>
            <small>ACTIVE RELEASE</small>
            <strong>
              v{activeRelease?.version ?? "—"} ·{" "}
              {activeRelease?.status ?? "unreleased"}
            </strong>
          </span>
        </div></div>
      </div>
      <nav className="studio-tabs">
        {(["design", "behavior", "schedules", "releases", "retirement"] as const).map((value) => (
          <button
            className={tab === value ? "active" : ""}
            key={value}
            onClick={() => setTab(value)}
          >
            {value === "design" ? (
              <GitBranch size={15} />
            ) : value === "behavior" ? (
              <FileCode2 size={15} />
            ) : value === "schedules" ? (
              <Clock3 size={15} />
            ) : value === "retirement" ? (
              <Archive size={15} />
            ) : (
              <History size={15} />
            )}{" "}
            {value}
          </button>
        ))}
      </nav>
      {tab === "design" && (
        <div className="studio-layout">
          <article className="topology panel">
            <div className="section-head">
              <div>
                <h2>Generated process topology</h2>
                <p>
                  Cloudflare primitives selected from this process definition.
                </p>
              </div>
              <span>
                <Sparkles size={14} />
                Live definition
              </span>
            </div>
            <div className="topology-flow">
              {data.topology.nodes.map((node, index) => (
                <div className="topology-step" key={node.id}>
                  {index > 0 && <i className="connector" />}
                  <span className={`topology-node ${node.type}`}>
                    {nodeIcon(node.type)}
                  </span>
                  <strong>{node.label}</strong>
                  <small>{node.type}</small>
                </div>
              ))}
            </div>
          </article>
          <aside className="configuration panel">
            <h2>Configuration</h2>
            <dl>
              <div>
                <dt>Execution profile</dt>
                <dd>{executionProfile.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Operating mode</dt>
                <dd>{blueprint.operating_mode}</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>{blueprint.risk_level}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{blueprint.business_owner}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{blueprint.department}</dd>
              </div>
            </dl>
            <h3>Authorized tools</h3>
            {tools.map((tool) => (
              <span className="authorized-tool" key={tool}>
                <Check size={13} />
                {tool.replaceAll("_", " ")}
              </span>
            ))}
          </aside>
        </div>
      )}
      {tab === "behavior" && (
        <div className="behavior-layout">
          <article className="behavior-form panel">
            <div className="section-head">
              <div>
                <h2>Behavior release</h2>
                <p>
                  Create an immutable draft without changing the active process.
                </p>
              </div>
              <span className="token-count">
                ~
                {Math.ceil(
                  (systemPrompt.length +
                    instructions.length +
                    guardrails.length) /
                    4,
                )}{" "}
                tokens
              </span>
            </div>
            <label>
              System purpose
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
              />
            </label>
            <div className="two-fields">
              <label>
                Instructions <small>One per line</small>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </label>
              <label>
                Guardrails <small>One per line</small>
                <textarea
                  value={guardrails}
                  onChange={(event) => setGuardrails(event.target.value)}
                />
              </label>
            </div>
            <div className="two-fields">
              <label>
                Model profile
                <select
                  value={modelProfile}
                  onChange={(event) => {
                    const profile = event.target.value as keyof typeof modelProfiles;
                    setModelProfile(profile);
                    setModelId(modelProfiles[profile].model);
                  }}
                >
                  <option value="fast">Fast · classification</option>
                  <option value="balanced">Balanced · general work</option>
                  <option value="reasoning">
                    Reasoning · complex analysis
                  </option>
                </select>
              </label>
              <label>
                Autonomy
                <select
                  value={autonomy}
                  onChange={(event) => setAutonomy(event.target.value)}
                >
                  <option value="observe">Observe</option>
                  <option value="suggest">Suggest</option>
                  <option value="approve">Approve</option>
                  <option value="guarded">Guarded</option>
                  <option value="autonomous">Autonomous</option>
                </select>
              </label>
            </div>
            <div className="model-selection">
              <div className="section-head">
                <div>
                  <h3>Exact Cloudflare model</h3>
                  <p>The exact Workers AI model is pinned into this immutable release. Future catalog changes cannot silently change production behavior.</p>
                </div>
                <span className="active-label">Cloudflare hosted</span>
              </div>
              <label>
                Release model
                <select
                  value={modelId}
                  onChange={(event) => {
                    const next = event.target.value as SupportedWorkersAIModel;
                    setModelId(next);
                    setModelProfile(workersAIModelCatalog[next].profile);
                  }}
                >
                  {supportedWorkersAIModels.map((id) => (
                    <option key={id} value={id}>{workersAIModelCatalog[id].label} · {workersAIModelCatalog[id].use}</option>
                  ))}
                </select>
              </label>
              <div className="model-evidence">
                <Bot size={18} />
                <span>
                  <strong>{workersAIModelCatalog[modelId].label}</strong>
                  <small>{workersAIModelCatalog[modelId].guidance}</small>
                  <code>{modelId}</code>
                </span>
              </div>
            </div>
            <div className={`autonomy-guidance level-${autonomy}`}>
              <ShieldCheck size={17} />
              <span>
                <strong>{autonomyLabel(autonomy)}</strong>
                <small>{autonomyDescription(autonomy)}</small>
              </span>
            </div>
            <section className={`autonomy-safety ${data.autonomySafety.state.cap ? "active" : ""}`}>
              <header><div><h3><ShieldCheck size={18}/> Automatic autonomy fallback</h3>
                <p>Unsafe human evidence caps the process at Suggest immediately. Sustained reliability below this policy caps it at Approve.</p></div>
                <span className={`safety-state ${data.autonomySafety.state.cap ? "active" : ""}`}>
                  {data.autonomySafety.state.cap ? <AlertTriangle size={14}/> : <Check size={14}/>}
                  {data.autonomySafety.state.cap ? `Capped at ${data.autonomySafety.state.cap}` : "Monitoring"}
                </span></header>
              {data.autonomySafety.state.cap && <div className="safety-alert"><AlertTriangle size={18}/><span>
                <strong>Published autonomy is temporarily restricted</strong>
                <small>{data.autonomySafety.state.reason} Trigger: {data.autonomySafety.state.trigger?.replaceAll("_", " ")}
                  {data.autonomySafety.state.triggeredAt ? ` · ${formatDate(data.autonomySafety.state.triggeredAt)}` : ""}</small>
              </span></div>}
              <div className="safety-policy-grid">
                <label><input type="checkbox" checked={safetyForm.enabled} disabled={!canManageSafety ||
                  Boolean(data.autonomySafety.state.cap)} onChange={(event) =>
                  setSafetyForm({ ...safetyForm, enabled: event.target.checked })}/>Enable automatic fallback</label>
                <label>Minimum terminal runs<input type="number" min={3} max={100}
                  disabled={!canManageSafety} value={safetyForm.minTerminalRuns} onChange={(event) =>
                  setSafetyForm({ ...safetyForm, minTerminalRuns: Number(event.target.value) })}/></label>
                <label>Minimum success %<input type="number" min={1} max={100}
                  disabled={!canManageSafety} value={safetyForm.successThreshold} onChange={(event) =>
                  setSafetyForm({ ...safetyForm, successThreshold: Number(event.target.value) })}/></label>
                <label>Window hours<input type="number" min={1} max={168}
                  disabled={!canManageSafety} value={safetyForm.windowHours} onChange={(event) =>
                  setSafetyForm({ ...safetyForm, windowHours: Number(event.target.value) })}/></label>
              </div>
              <div className="safety-evidence">
                <span><strong>{data.autonomySafety.evidence.completedRuns}/{data.autonomySafety.evidence.terminalRuns}</strong> completed</span>
                <span><strong>{data.autonomySafety.evidence.successRate == null ? "No sample" :
                  `${data.autonomySafety.evidence.successRate.toFixed(1)}%`}</strong> recent success</span>
                <span>Unsafe shadow and evaluation reviews trigger immediately</span>
              </div>
              <p className="safety-boundary">The cap is loaded with the existing process blueprint and applies equally to instant Workers, durable Agents, Queue jobs, and Workflows. It adds no per-turn D1 read.</p>
              {canManageSafety && <div className="safety-actions">
                <button className="primary" disabled={busy} onClick={() => void saveSafetyPolicy()}>
                  <Save size={14}/>Save fallback policy</button>
                {data.autonomySafety.state.cap && <div className="safety-clear"><input maxLength={500}
                  value={safetyClearReason} placeholder="Evidence that risk is resolved (10+ characters)"
                  onChange={(event) => setSafetyClearReason(event.target.value)}/>
                  <button disabled={busy || safetyClearReason.trim().length < 10}
                    onClick={() => void clearSafetyFallback()}>Clear with evidence</button></div>}
              </div>}
            </section>
            <div className="contract-editor">
              <div className="section-head">
                <div>
                  <h3>Process contracts</h3>
                  <p>
                    Optional JSON Schema contracts reject invalid input before model spend
                    and verify structured output before delivery.
                  </p>
                </div>
                <button type="button" className="quiet" onClick={() => {
                  setInputSchema(JSON.stringify(exampleInputSchema, null, 2));
                  setOutputSchema(JSON.stringify(exampleOutputSchema, null, 2));
                }}>
                  <FileCode2 size={14} /> Load example
                </button>
              </div>
              <div className="two-fields">
                <label>
                  Input JSON Schema <small>Root type must be object</small>
                  <textarea className="schema-editor" value={inputSchema}
                    onChange={(event) => setInputSchema(event.target.value)}
                    placeholder={'{\n  "type": "object",\n  "properties": { ... }\n}'} />
                </label>
                <label>
                  Output JSON Schema <small>Model returns one matching JSON object</small>
                  <textarea className="schema-editor" value={outputSchema}
                    onChange={(event) => setOutputSchema(event.target.value)}
                    placeholder={'{\n  "type": "object",\n  "properties": { ... }\n}'} />
                </label>
              </div>
            </div>
            <label>
              Release notes
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What changed and why?"
              />
            </label>
            <button
              className="primary save-release"
              disabled={busy || !systemPrompt.trim()}
              onClick={() => void saveDraft()}
            >
              <Save size={16} />
              {busy ? "Creating…" : "Create draft release"}
            </button>
          </article>
          <aside className="release-safety panel">
            <ShieldCheck size={23} />
            <h2>Release safety</h2>
            <p>
              The active process is unchanged until an authorized owner
              publishes this draft.
            </p>
            <ul>
              <li>Immutable compiled bundle</li>
              <li>Prompt and policy checksum</li>
              <li>Release-specific evaluation gate</li>
              <li>Explicit model selection</li>
              <li>Audited publisher identity</li>
              <li>One-click rollback</li>
            </ul>
          </aside>
        </div>
      )}
      {tab === "schedules" && (
        <ScheduleStudio processId={processId} executionProfile={executionProfile} data={scheduleData}
          busy={busy} setBusy={setBusy} onReload={load} onNotice={onNotice}/>
      )}
      {tab === "releases" && (
        <div className="release-operations">
        {data.actorAdoption.supported && <section className="actor-adoption panel">
          <div className="section-head"><div><span className="eyebrow"><Boxes size={14}/> DURABLE ACTOR FLEET</span>
            <h2>Release adoption</h2>
            <p>Known sticky actors by their latest execution and explicit migration evidence.</p></div>
            <em>{data.actorAdoption.currentActors}/{data.actorAdoption.knownActors} current</em>
          </div>
          <div className="actor-adoption-metrics">
            <span><strong>{data.actorAdoption.knownActors}</strong><small>Known actors</small></span>
            <span><strong>{data.actorAdoption.currentActors}</strong><small>Current release</small></span>
            <span className={data.actorAdoption.pinnedPreviousActors ? "attention" : ""}>
              <strong>{data.actorAdoption.pinnedPreviousActors}</strong><small>Pinned previous</small></span>
            <span className={data.actorAdoption.unattributedActors ? "risk" : ""}>
              <strong>{data.actorAdoption.unattributedActors}</strong><small>Unattributed</small></span>
          </div>
          <div className="actor-cohorts">{data.actorAdoption.cohorts.map((cohort) =>
            <article className={cohort.state} key={cohort.release_id ?? "unattributed"}>
              <span><strong>{cohort.version ? `Release v${cohort.version}` : "Unattributed release"}</strong>
                <small>{cohort.release_id ?? "No process-release evidence"}</small></span>
              <em>{cohort.actor_count} actor{cohort.actor_count === 1 ? "" : "s"}</em>
            </article>)}
            {!data.actorAdoption.cohorts.length && <p>No durable actor has been created for this process yet.</p>}
          </div>
          {(rollouts.length > 0 || data.actorAdoption.pinnedPreviousActors > 0) &&
            <section className="actor-rollout-control">
              <header><div><strong>Staged release rollout</strong>
                <small>Cloudflare Workflows migrates a bounded cohort one serialized actor at a time.</small></div>
                <button disabled={busy} onClick={() => void load()}>Refresh status</button></header>
              {activeActorRollout ?
                <article className="rollout-active">
                  <span><strong>Release v{activeActorRollout.target_version} · {activeActorRollout.percentage}% cohort</strong>
                    <small>{activeActorRollout.selected_actor_count} selected · requested by {activeActorRollout.requested_by_name ?? activeActorRollout.requested_by}</small></span>
                  <em>{activeActorRollout.status}</em>
                </article>
                : canActivate && data.actorAdoption.pinnedPreviousActors > 0 ? <div className="rollout-form">
                  <label>Cohort size<select value={rolloutPercentage}
                    onChange={(event) => setRolloutPercentage(Number(event.target.value))}>
                    <option value={10}>10% staged</option><option value={25}>25% staged</option>
                    <option value={50}>50% staged</option><option value={100}>100% remaining</option>
                  </select></label>
                  <label>Operational reason<textarea maxLength={500} value={rolloutReason}
                    placeholder="Why should this actor cohort adopt the current evaluated release?"
                    onChange={(event) => setRolloutReason(event.target.value)}/></label>
                  <button disabled={busy || rolloutReason.trim().length < 10 ||
                    activeRelease?.evaluation_status !== "passing"} onClick={() => void startActorRollout()}>
                    <Rocket size={14}/>{busy ? "Queuing…" : "Start durable rollout"}</button>
                  {activeRelease?.evaluation_status !== "passing" &&
                    <small className="rollout-blocked">The current release needs passing evaluation evidence before actor migration.</small>}
                </div> : null}
              {rollouts.length > 0 && <div className="rollout-history">{rollouts.slice(0, 5).map((rollout) =>
                <article key={rollout.id}><span><strong>v{rollout.target_version} · {rollout.percentage}%</strong>
                  <small>{rollout.reason}</small></span><span>{rollout.completed_count} completed · {rollout.skipped_count} skipped · {rollout.failed_count} failed</span>
                  <em className={rollout.status}>{rollout.status}</em></article>)}</div>}
            </section>}
          {data.actorAdoption.actors.length > 0 && <details className="actor-inventory">
            <summary>Inspect {data.actorAdoption.actors.length} recent actor identities</summary>
            <div><header><span>Actor identity</span><span>Release</span><span>State</span><span>Last evidence</span></header>
              {data.actorAdoption.actors.map((actor) => <article key={actor.instance_key}>
                <span><strong>{actorIdentityLabel(actor.instance_key)}</strong><small>{actor.instance_key}</small></span>
                <span>v{actor.version ?? "?"}</span><em className={actor.state}>{actor.state.replaceAll("_", " ")}</em>
                <span>{actor.migrated_at ?? actor.last_active_at}</span>
              </article>)}</div>
          </details>}
          <footer>Inventory is derived from tenant-scoped D1 evidence. Workrr does not enumerate Durable Objects or add reads to normal conversation turns.</footer>
        </section>}
        <div className="release-list panel">
          <div className="section-head">
            <div>
              <h2>Release history</h2>
              <p>Published behavior, drafts, and rollback points.</p>
            </div>
            <button onClick={() => setTab("behavior")}>
              <Plus size={14} />
              New draft
            </button>
          </div>
          {data.releases.map((release) => (
            <div className="release-row" key={release.id}>
              <span className={`release-version ${release.status}`}>
                <strong>v{release.version}</strong>
                <small>{release.status}</small>
              </span>
              <span className="release-copy">
                <strong>
                  {release.release_notes || "Process behavior release"}
                </strong>
                <small>
                  {release.model_profile} model · {release.autonomy} autonomy ·{" "}
                  {release.checksum.slice(0, 10)}
                </small>
                <small>{release.model_id ?? "Legacy profile mapping"} · release-pinned Workers AI model</small>
                <small>
                  {release.input_schema_json ? "Input contract" : "Free-text input"} ·{" "}
                  {release.output_schema_json ? "Structured output" : "Text output"} ·{" "}
                  {toolPolicyCount(release.tool_policy_json)} typed tools
                </small>
                <em>
                  Created {release.created_at} by {release.created_by}
                </em>
                <span className={`release-gate ${release.evaluation_status}`}>
                  <ShieldCheck size={12}/> Evaluation {release.evaluation_status.replaceAll("_", " ")}
                </span>
              </span>
              {release.status !== "published" && canActivate &&
                (release.status === "draft" || release.evaluation_status === "passing") ? (
                <button disabled={busy} onClick={() => release.status === "draft"
                  ? void publish(release) : (setRollbackTarget(release), setRollbackReason(""), setRollbackVersion(""))}>
                  {release.status === "draft" ? <Rocket size={14} /> : <History size={14} />}{" "}
                  {release.status === "draft" ? "Publish" : "Restore"}
                </button>
              ) : (
                <span className={`active-label ${release.status}`}>
                  <Check size={14} />
                  {release.status === "published" ? "Active" :
                    release.status === "retired" && release.evaluation_status !== "passing"
                      ? "Evaluation required" : "History"}
                </span>
              )}
              {rollbackTarget?.id === release.id && <div className="rollback-editor">
                <header><div><strong>Restore release v{release.version}</strong>
                  <small>This immediately retires v{activeRelease?.version} and restores this exact immutable bundle.</small>
                </div><button onClick={() => setRollbackTarget(null)}>Cancel</button></header>
                <label>Operational reason<textarea maxLength={500} value={rollbackReason}
                  placeholder="Why is the current release being rolled back?"
                  onChange={(event) => setRollbackReason(event.target.value)}/></label>
                <label>Enter version {release.version} to confirm<input inputMode="numeric"
                  value={rollbackVersion} onChange={(event) => setRollbackVersion(event.target.value)}/></label>
                <button className="rollback-confirm" disabled={busy || rollbackReason.trim().length < 5 ||
                  Number(rollbackVersion) !== release.version} onClick={() => void rollback()}>
                  <History size={14}/>{busy ? "Restoring…" : `Restore v${release.version}`}
                </button>
              </div>}
            </div>
          ))}
          {data.activations.length > 0 && <section className="activation-history">
            <div><History size={16}/><span><strong>Activation evidence</strong>
              <small>Publish and rollback history cannot be rewritten by later release changes.</small></span></div>
            {data.activations.slice(0, 8).map((activation) => <article key={activation.id}>
              <strong>{activation.activation_type === "rollback" ? "Rollback" : activation.activation_type} · v{activation.to_version}</strong>
              <p>{activation.reason}</p>
              <small>{activation.activated_by_name ?? activation.activated_by} · {activation.activated_at}</small>
            </article>)}
          </section>}
        </div>
        </div>
      )}
      {tab === "retirement" && retirementData && <RetirementStudio processId={processId}
        data={retirementData} session={session} busy={busy} setBusy={setBusy}
        onReload={load} onNotice={onNotice}/>}
    </section>
  );
}

function RetirementStudio({ processId, data, session, busy, setBusy, onReload, onNotice }: {
  processId: string; data: ProcessRetirementData; session: SessionData | null; busy: boolean;
  setBusy: (value: boolean) => void; onReload: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [scheduledFor, setScheduledFor] = useState(() => {
    const date = new Date(Date.now() + 48 * 60 * 60_000);
    return date.toISOString().slice(0, 16);
  });
  const [holdReason, setHoldReason] = useState("");
  const [deleteExecutionPayloads, setDeleteExecutionPayloads] = useState(true);
  const [deleteApprovalContent, setDeleteApprovalContent] = useState(true);
  const [deletePromptContent, setDeletePromptContent] = useState(false);
  const open = data.retirements.find((item) => ["requested","approved","disposing","failed"].includes(item.status));
  const canRequest = ["admin","builder","owner"].includes(session?.user.role ?? "");
  const canGovern = ["admin","owner"].includes(session?.user.role ?? "");
  async function requestRetirement() {
    setBusy(true);
    try {
      await api.requestProcessRetirement(processId, { reason, confirmName: confirmation,
        deleteExecutionPayloads, deleteApprovalContent, deletePromptContent });
      setReason(""); setConfirmation("");
      await onReload();
      onNotice("Retirement requested. The process, schedules, and webhooks are paused immediately.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Retirement request failed"); }
    finally { setBusy(false); }
  }
  async function transition(body: Parameters<typeof api.transitionProcessRetirement>[2]) {
    if (!open) return;
    setBusy(true);
    try {
      await api.transitionProcessRetirement(processId, open.id, body);
      setConfirmation(""); setHoldReason("");
      await onReload();
      onNotice(`Retirement ${body.action === "hold" ? body.legalHold ? "placed on legal hold" : "legal hold released" : body.action + "d"}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Retirement update failed"); }
    finally { setBusy(false); }
  }
  return <div className="retirement-layout">
    <article className="retirement-control panel"><div className="section-head"><div><h2><Archive size={17}/> Process retirement</h2>
      <p>Retirement stops new work first. Disposal requires a separate approver, a cooling period, and retained audit evidence.</p></div>
      <span className={`retirement-status ${open?.status ?? "available"}`}>{open?.status ?? "Available"}</span></div>
      {!open && <div className="retirement-request"><div className="retirement-warning"><Trash2 size={19}/><span><strong>This starts an irreversible governance workflow</strong>
        <small>The process is paused immediately. Actual disposal cannot occur for at least 24 hours.</small></span></div>
        <label>Business and compliance reason<textarea minLength={20} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)}
          placeholder="Why the process is being retired, who authorized the change, and what records must remain."/></label>
        <div className="retirement-scope"><label><input type="checkbox" checked={deleteExecutionPayloads} onChange={(event) => setDeleteExecutionPayloads(event.target.checked)}/>Dispose execution inputs and outputs</label>
          <label><input type="checkbox" checked={deleteApprovalContent} onChange={(event) => setDeleteApprovalContent(event.target.checked)}/>Dispose approval content and discussion</label>
          <label><input type="checkbox" checked={deletePromptContent} onChange={(event) => setDeletePromptContent(event.target.checked)}/>Dispose prompt content</label>
          <span><ShieldCheck size={15}/>Audit metadata is always retained.</span></div>
        <label>Enter the exact process name <strong>{data.process.name}</strong><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>
        <button className="danger-action" disabled={busy || !canRequest || reason.trim().length < 20 || confirmation !== data.process.name}
          onClick={() => void requestRetirement()}><Archive size={15}/>Request retirement and pause process</button></div>}
      {open && <div className="retirement-active"><dl><div><dt>Requested by</dt><dd>{open.requested_by_name ?? open.requested_by}</dd></div>
        <div><dt>Status</dt><dd>{open.status}</dd></div><div><dt>Legal hold</dt><dd>{open.legal_hold ? "Applied" : "None"}</dd></div>
        <div><dt>Scheduled</dt><dd>{open.scheduled_for ? formatStudioDate(open.scheduled_for) : "Not approved"}</dd></div></dl>
        {open.status === "disposing" && <div className="retirement-progress"><Workflow size={16}/>
          <span><strong>{open.processed_actors} durable actors cleared</strong>
            <small>{open.disposed_turns} conversation turns · {open.disposed_prompt_bundles} actor prompt bundles</small></span></div>}
        <p>{open.reason}</p>{open.last_error && <div className="retirement-error">{open.last_error}</div>}
        {open.evidence_json && <pre>{JSON.stringify(JSON.parse(open.evidence_json), null, 2)}</pre>}
        {canGovern && !["disposing","disposed"].includes(open.status) && <div className="retirement-governance">
          <section><h3><LockKeyhole size={15}/> Legal hold</h3>
            {open.legal_hold ? <><p>{open.legal_hold_reason}</p><label>Type RELEASE LEGAL HOLD<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>
              <button disabled={busy || confirmation !== "RELEASE LEGAL HOLD"} onClick={() => void transition({ action: "hold", legalHold: false, confirmation })}>Release hold</button></> :
              <><label>Hold reason<input minLength={10} value={holdReason} onChange={(event) => setHoldReason(event.target.value)}/></label>
              <button disabled={busy || holdReason.trim().length < 10} onClick={() => void transition({ action: "hold", legalHold: true, legalHoldReason: holdReason })}>Apply legal hold</button></>}</section>
          {!open.legal_hold && ["requested","failed"].includes(open.status) && <section><h3><ShieldCheck size={15}/> Independent approval</h3>
            <label>Disposal date and time<input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)}/></label>
            <label>Enter {data.process.name}<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>
            <button className="danger-action" disabled={busy || open.requested_by === session?.user.id || confirmation !== data.process.name}
              onClick={() => void transition({ action: "approve", scheduledFor: new Date(scheduledFor).toISOString(), confirmation })}>
              Approve scheduled disposal</button>{open.requested_by === session?.user.id && <small>A different administrator or owner must approve.</small>}</section>}
          <section><h3>Cancel retirement</h3><label>Type CANCEL RETIREMENT<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>
            <button disabled={busy || confirmation !== "CANCEL RETIREMENT"} onClick={() => void transition({ action: "cancel", confirmation })}>Cancel request</button></section>
        </div>}</div>}
    </article>
    <aside className="retirement-evidence panel"><h2>Preserved evidence</h2><ul><li>Retirement request and rationale</li><li>Legal-hold history</li>
      <li>Independent approval identity</li><li>Scheduled, resumable Cloudflare Workflow</li><li>Counts of cleared durable actors and payloads</li>
      <li>Immutable audit metadata</li></ul><p>Knowledge sources are not deleted because they may be shared. Process access is removed by pausing the process and its ingestion paths.</p>
      {data.retirements.filter((item) => !open || item.id !== open.id).map((item) => <div className="retirement-history" key={item.id}>
        <strong>{item.status}</strong><small>{formatStudioDate(item.requested_at)} · {item.requested_by_name ?? item.requested_by}</small></div>)}</aside>
  </div>;
}

function ScheduleStudio({ processId, executionProfile, data, busy, setBusy, onReload, onNotice }: {
  processId: string; executionProfile: string; data: ScheduleData; busy: boolean;
  setBusy: (value: boolean) => void; onReload: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState<"hourly" | "daily" | "weekly">("daily");
  const [timeUtc, setTimeUtc] = useState("09:00");
  const [weekdayUtc, setWeekdayUtc] = useState(1);
  const [input, setInput] = useState("");
  const [identityKey, setIdentityKey] = useState("");
  const identityLabel = executionProfile === "conversation" ? "Thread ID" :
    executionProfile === "consumer" ? "Consumer ID" : executionProfile === "entity" ? "Entity ID" :
    executionProfile === "shared_shard" ? "Shard key" : null;
  async function create() {
    setBusy(true);
    try {
      await api.createSchedule(processId, { name, cadence, timeUtc, weekdayUtc, input, identityKey });
      setName(""); setInput(""); setIdentityKey("");
      onNotice("Recurring process schedule created."); await onReload();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not create schedule"); }
    finally { setBusy(false); }
  }
  async function mutate(id: string, action: "run" | "pause" | "restore") {
    setBusy(true);
    try {
      if (action === "run") await api.runSchedule(id);
      else await api.updateSchedule(id, { status: action === "pause" ? "paused" : "active" });
      onNotice(action === "run" ? "Schedule handed to the process queue." : `Schedule ${action}d.`);
      await onReload();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Schedule update failed"); }
    finally { setBusy(false); }
  }
  return <div className="schedule-layout">
    <article className="schedule-form panel">
      <div className="section-head"><div><h2>Recurring process</h2>
        <p>Cron claims due work; Queues dispatch it to the selected execution profile.</p></div>
        <span><Clock3 size={14}/> UTC</span></div>
      <label>Schedule name<input value={name} onChange={(event) => setName(event.target.value)}
        placeholder="Daily intake review"/></label>
      <div className="schedule-fields">
        <label>Cadence<select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)}>
          <option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
        </select></label>
        {cadence !== "hourly" && <label>Hour (UTC)<select value={timeUtc} onChange={(event) => setTimeUtc(event.target.value)}>
          {Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`).map((time) =>
            <option value={time} key={time}>{time}</option>)}</select></label>}
        {cadence === "weekly" && <label>Weekday<select value={weekdayUtc}
          onChange={(event) => setWeekdayUtc(Number(event.target.value))}>
          {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day, index) =>
            <option value={index} key={day}>{day}</option>)}</select></label>}
      </div>
      {identityLabel && <label>{identityLabel}<input value={identityKey} onChange={(event) => setIdentityKey(event.target.value)}
        placeholder={`Stable ${identityLabel.toLowerCase()} for sticky state`}/></label>}
      <label>Process input<textarea value={input} onChange={(event) => setInput(event.target.value)}
        placeholder="Describe the recurring work and the data the process should handle."/></label>
      <button className="primary" disabled={busy || !name.trim() || !input.trim() || Boolean(identityLabel && !identityKey.trim())}
        onClick={() => void create()}><Plus size={15}/>Create schedule</button>
    </article>
    <section className="schedule-list">
      <div className="schedule-summary"><div><strong>{data.schedules.length}</strong><span>Schedules</span></div>
        <div><strong>{data.schedules.reduce((sum, schedule) => sum + Number(schedule.dispatch_count), 0)}</strong><span>Dispatches</span></div>
        <div><strong>{data.schedules.filter((schedule) => schedule.status === "active").length}</strong><span>Active</span></div></div>
      {data.schedules.length === 0 && <div className="schedule-empty panel"><Clock3 size={24}/><h2>No schedules yet</h2>
        <p>Add repeatable work without creating long-running compute.</p></div>}
      {data.schedules.map((schedule) => {
        const history = data.dispatches.filter((dispatch) => dispatch.schedule_id === schedule.id).slice(0, 3);
        return <article className="schedule-card panel" key={schedule.id}>
          <header><div><span className={`status ${schedule.status}`}><i/>{schedule.status}</span>
            <h2>{schedule.name}</h2><p>{schedule.cadence}{schedule.time_utc ? ` · ${schedule.time_utc} UTC` : ""}</p></div>
            <div className="schedule-actions"><button disabled={busy} onClick={() => void mutate(schedule.id, "run")}><Play size={14}/>Run now</button>
              <button disabled={busy} onClick={() => void mutate(schedule.id, schedule.status === "active" ? "pause" : "restore")}>
                {schedule.status === "active" ? "Pause" : "Restore"}</button></div></header>
          <dl><div><dt>Next run</dt><dd>{formatDate(schedule.next_run_at)}</dd></div>
            <div><dt>Last dispatch</dt><dd>{schedule.last_dispatched_at ? formatDate(schedule.last_dispatched_at) : "Not yet"}</dd></div>
            {schedule.identity_key && <div><dt>Sticky key</dt><dd>{schedule.identity_key}</dd></div>}</dl>
          {history.length > 0 && <div className="dispatch-history">{history.map((dispatch) =>
            <div key={dispatch.id}><span className={`dispatch-status ${dispatch.status}`}>{dispatch.status}</span>
              <span>{formatDate(dispatch.created_at)}</span><code>{dispatch.execution_id.slice(0, 8)}</code></div>)}</div>}
          {schedule.last_error && <p className="schedule-error">{schedule.last_error}</p>}
        </article>;
      })}
    </section>
  </div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}

function nodeIcon(type: string) {
  if (type === "agent") return <Bot size={20} />;
  if (type === "approval") return <ShieldCheck size={20} />;
  if (type === "queue") return <Clock3 size={20} />;
  if (type === "tool") return <Boxes size={20} />;
  if (type === "outcome") return <Check size={20} />;
  return <Play size={20} />;
}
function formatStudioDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  }).format(date);
}
function parseList(value: string): string[] {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}
function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
function prettySchema(value: string | null | undefined) {
  if (!value) return "";
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
}
function parseSchemaEditor(value: string, label: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} contract must be a valid JSON object`);
  }
}
function toolPolicyCount(value: string | null | undefined) {
  if (!value) return 0;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.length : 0; }
  catch { return 0; }
}
function actorIdentityLabel(instanceKey: string) {
  const marker = [":thread:", ":consumer:", ":entity:", ":shard:", ":temporary:"]
    .find((candidate) => instanceKey.includes(candidate));
  if (!marker) return "Durable actor";
  const identity = instanceKey.split(marker)[1];
  return `${marker.slice(1, -1).replace("_", " ")} · ${identity || "unknown"}`;
}
const exampleInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["requestId", "summary"],
  properties: {
    requestId: { type: "string", minLength: 1, maxLength: 100 },
    summary: { type: "string", minLength: 1, maxLength: 4000 },
    priority: { type: "string", enum: ["low", "normal", "high"] }
  }
};
const exampleOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "rationale"],
  properties: {
    decision: { type: "string", enum: ["accept", "review", "reject"] },
    rationale: { type: "string", minLength: 1, maxLength: 2000 },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};
function autonomyLabel(level: string) {
  return ({
    observe: "Level 0 · Observe only",
    suggest: "Level 1 · Recommend",
    approve: "Level 2 · Human approval",
    guarded: "Level 3 · Guarded execution",
    autonomous: "Level 4 · Autonomous"
  } as Record<string, string>)[level] ?? level;
}
function autonomyDescription(level: string) {
  return ({
    observe: "Records accepted input without invoking a model or producing a recommendation.",
    suggest: "Generates a recommendation but never authorizes an external action.",
    approve: "Generates a proposed result and routes it to the Work Inbox before acceptance.",
    guarded: "Completes read-only work; any process declaring consequential tools requires human review.",
    autonomous: "Completes within the published release and operating controls without a human checkpoint."
  } as Record<string, string>)[level] ?? "";
}
