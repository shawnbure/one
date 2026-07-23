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
} from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";
import { api, type ProcessRelease, type ScheduleData, type StudioData } from "./api";
import "./schedule-studio.css";

interface Props {
  processId: string | null;
  processes: AgentBlueprint[];
  onSelect: (id: string | null) => void;
  onNotice: (message: string) => void;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
}

export function ProcessStudioView({
  processId,
  processes,
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
  onBack,
  onNotice,
}: {
  processId: string;
  onBack: () => void;
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<StudioData | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData>({ schedules: [], dispatches: [] });
  const [tab, setTab] = useState<"design" | "behavior" | "schedules" | "releases">("design");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [guardrails, setGuardrails] = useState("");
  const [modelProfile, setModelProfile] = useState("balanced");
  const [autonomy, setAutonomy] = useState("approve");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [result, schedules] = await Promise.all([
        api.studio(processId).then((response) => response.data),
        api.schedules(processId).then((response) => response.data),
      ]);
      setData(result);
      setScheduleData(schedules);
      setSystemPrompt(result.prompt.system_prompt);
      setInstructions(parseList(result.prompt.instructions_json).join("\n"));
      setGuardrails(parseList(result.prompt.guardrails_json).join("\n"));
      setModelProfile(result.blueprint.model_profile ?? "balanced");
      setAutonomy(result.blueprint.autonomy ?? "approve");
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

  async function saveDraft() {
    setBusy(true);
    try {
      const result = await api.createRelease(processId, {
        systemPrompt,
        instructions: lines(instructions),
        guardrails: lines(guardrails),
        modelProfile,
        autonomy,
        releaseNotes: notes,
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

  if (!data) return <div className="loading-card">Loading Process Studio…</div>;
  const blueprint = data.blueprint;
  const executionProfile = blueprint.execution_profile ?? "instant";
  const tools = JSON.parse(blueprint.tools_json ?? "[]") as string[];
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
        {(["design", "behavior", "schedules", "releases"] as const).map((value) => (
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
                  onChange={(event) => setModelProfile(event.target.value)}
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
                <em>
                  Created {release.created_at} by {release.created_by}
                </em>
                <span className={`release-gate ${release.evaluation_status}`}>
                  <ShieldCheck size={12}/> Evaluation {release.evaluation_status.replaceAll("_", " ")}
                </span>
              </span>
              {release.status !== "published" ? (
                <button disabled={busy} onClick={() => void publish(release)}>
                  {release.status === "draft" ? (
                    <Rocket size={14} />
                  ) : (
                    <History size={14} />
                  )}{" "}
                  {release.status === "draft" ? "Publish" : "Roll back"}
                </button>
              ) : (
                <span className="active-label">
                  <Check size={14} />
                  Active
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
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
