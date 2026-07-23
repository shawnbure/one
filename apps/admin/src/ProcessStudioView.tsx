import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, Boxes, Check, ChevronRight, Clock3, FileCode2, GitBranch, History, Play, Plus, Rocket, Save, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";
import { api, type ProcessRelease, type StudioData } from "./api";

interface Props { processId: string | null; processes: AgentBlueprint[]; onSelect: (id: string | null) => void; onNotice: (message: string) => void; }

export function ProcessStudioView({ processId, processes, onSelect, onNotice }: Props) {
  if (!processId) return <ProcessPortfolio processes={processes} onSelect={onSelect}/>;
  return <Studio processId={processId} onBack={() => onSelect(null)} onNotice={onNotice}/>;
}

function ProcessPortfolio({ processes, onSelect }: { processes: AgentBlueprint[]; onSelect: (id: string) => void }) {
  return <section className="studio-page"><div className="page-title"><div><span className="eyebrow"><Workflow size={14}/> PROCESS PORTFOLIO</span><h1>AI processes</h1><p>Operational capabilities with explicit owners, releases, models, and human controls.</p></div><button className="primary"><Plus size={16}/>Create process</button></div><div className="portfolio-grid">{processes.map((process) => <button key={process.id} className="portfolio-card panel" onClick={() => onSelect(process.id)}><div><span className={`process-icon ${process.executionProfile}`}><Workflow size={19}/></span><span className={`status ${process.status}`}><i/>{process.status}</span></div><h2>{process.name}</h2><p>{process.description}</p><dl><div><dt>Execution</dt><dd>{process.executionProfile.replaceAll("_", " ")}</dd></div><div><dt>Model</dt><dd>{process.modelProfile}</dd></div><div><dt>Autonomy</dt><dd>{process.autonomy}</dd></div></dl><span className="open-studio">Open Process Studio <ChevronRight size={15}/></span></button>)}</div></section>;
}

function Studio({ processId, onBack, onNotice }: { processId: string; onBack: () => void; onNotice: (message: string) => void }) {
  const [data, setData] = useState<StudioData | null>(null);
  const [tab, setTab] = useState<"design" | "behavior" | "releases">("design");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [guardrails, setGuardrails] = useState("");
  const [modelProfile, setModelProfile] = useState("balanced");
  const [autonomy, setAutonomy] = useState("approve");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const result = (await api.studio(processId)).data; setData(result);
      setSystemPrompt(result.prompt.system_prompt); setInstructions(parseList(result.prompt.instructions_json).join("\n")); setGuardrails(parseList(result.prompt.guardrails_json).join("\n"));
      setModelProfile(result.blueprint.model_profile ?? "balanced"); setAutonomy(result.blueprint.autonomy ?? "approve");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not load Process Studio"); }
  }
  useEffect(() => { void load(); }, [processId]);
  const activeRelease = useMemo(() => data?.releases.find((release) => release.status === "published"), [data]);

  async function saveDraft() {
    setBusy(true);
    try { const result = await api.createRelease(processId, { systemPrompt, instructions: lines(instructions), guardrails: lines(guardrails), modelProfile, autonomy, releaseNotes: notes }); onNotice(`Draft release v${result.version} created.`); setNotes(""); setTab("releases"); await load(); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Could not create release"); }
    finally { setBusy(false); }
  }
  async function publish(release: ProcessRelease) {
    setBusy(true);
    try { const result = await api.publishRelease(processId, release.id); onNotice(`${release.status === "retired" ? "Rollback" : "Release"} v${result.version} is now active.`); await load(); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Could not publish release"); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="loading-card">Loading Process Studio…</div>;
  const blueprint = data.blueprint;
  const executionProfile = blueprint.execution_profile ?? "instant";
  const tools = JSON.parse(blueprint.tools_json ?? "[]") as string[];
  return <section className="studio-page"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/>Process portfolio</button><div className="studio-title"><div><span className={`process-icon large ${blueprint.execution_profile}`}><Workflow size={21}/></span><div><span className="eyebrow">PROCESS STUDIO</span><h1>{blueprint.name}</h1><p>{blueprint.description}</p></div></div><div className="release-chip"><i/><span><small>ACTIVE RELEASE</small><strong>v{activeRelease?.version ?? "—"} · {activeRelease?.status ?? "unreleased"}</strong></span></div></div><nav className="studio-tabs">{(["design", "behavior", "releases"] as const).map((value) => <button className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{value === "design" ? <GitBranch size={15}/> : value === "behavior" ? <FileCode2 size={15}/> : <History size={15}/>} {value}</button>)}</nav>
    {tab === "design" && <div className="studio-layout"><article className="topology panel"><div className="section-head"><div><h2>Generated process topology</h2><p>Cloudflare primitives selected from this process definition.</p></div><span><Sparkles size={14}/>Live definition</span></div><div className="topology-flow">{data.topology.nodes.map((node, index) => <div className="topology-step" key={node.id}>{index > 0 && <i className="connector"/>}<span className={`topology-node ${node.type}`}>{nodeIcon(node.type)}</span><strong>{node.label}</strong><small>{node.type}</small></div>)}</div></article><aside className="configuration panel"><h2>Configuration</h2><dl><div><dt>Execution profile</dt><dd>{executionProfile.replaceAll("_", " ")}</dd></div><div><dt>Operating mode</dt><dd>{blueprint.operating_mode}</dd></div><div><dt>Risk</dt><dd>{blueprint.risk_level}</dd></div><div><dt>Owner</dt><dd>{blueprint.business_owner}</dd></div><div><dt>Department</dt><dd>{blueprint.department}</dd></div></dl><h3>Authorized tools</h3>{tools.map((tool) => <span className="authorized-tool" key={tool}><Check size={13}/>{tool.replaceAll("_", " ")}</span>)}</aside></div>}
    {tab === "behavior" && <div className="behavior-layout"><article className="behavior-form panel"><div className="section-head"><div><h2>Behavior release</h2><p>Create an immutable draft without changing the active process.</p></div><span className="token-count">~{Math.ceil((systemPrompt.length + instructions.length + guardrails.length) / 4)} tokens</span></div><label>System purpose<textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)}/></label><div className="two-fields"><label>Instructions <small>One per line</small><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)}/></label><label>Guardrails <small>One per line</small><textarea value={guardrails} onChange={(event) => setGuardrails(event.target.value)}/></label></div><div className="two-fields"><label>Model profile<select value={modelProfile} onChange={(event) => setModelProfile(event.target.value)}><option value="fast">Fast · classification</option><option value="balanced">Balanced · general work</option><option value="reasoning">Reasoning · complex analysis</option></select></label><label>Autonomy<select value={autonomy} onChange={(event) => setAutonomy(event.target.value)}><option value="observe">Observe</option><option value="suggest">Suggest</option><option value="approve">Approve</option><option value="guarded">Guarded</option><option value="autonomous">Autonomous</option></select></label></div><label>Release notes<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What changed and why?"/></label><button className="primary save-release" disabled={busy || !systemPrompt.trim()} onClick={() => void saveDraft()}><Save size={16}/>{busy ? "Creating…" : "Create draft release"}</button></article><aside className="release-safety panel"><ShieldCheck size={23}/><h2>Release safety</h2><p>The active process is unchanged until an authorized owner publishes this draft.</p><ul><li>Immutable compiled bundle</li><li>Prompt and policy checksum</li><li>Explicit model selection</li><li>Audited publisher identity</li><li>One-click rollback</li></ul></aside></div>}
    {tab === "releases" && <div className="release-list panel"><div className="section-head"><div><h2>Release history</h2><p>Published behavior, drafts, and rollback points.</p></div><button onClick={() => setTab("behavior")}><Plus size={14}/>New draft</button></div>{data.releases.map((release) => <div className="release-row" key={release.id}><span className={`release-version ${release.status}`}><strong>v{release.version}</strong><small>{release.status}</small></span><span className="release-copy"><strong>{release.release_notes || "Process behavior release"}</strong><small>{release.model_profile} model · {release.autonomy} autonomy · {release.checksum.slice(0, 10)}</small><em>Created {release.created_at} by {release.created_by}</em></span>{release.status !== "published" ? <button disabled={busy} onClick={() => void publish(release)}>{release.status === "draft" ? <Rocket size={14}/> : <History size={14}/>} {release.status === "draft" ? "Publish" : "Roll back"}</button> : <span className="active-label"><Check size={14}/>Active</span>}</div>)}</div>}
  </section>;
}

function nodeIcon(type: string) { if (type === "agent") return <Bot size={20}/>; if (type === "approval") return <ShieldCheck size={20}/>; if (type === "queue") return <Clock3 size={20}/>; if (type === "tool") return <Boxes size={20}/>; if (type === "outcome") return <Check size={20}/>; return <Play size={20}/>; }
function parseList(value: string): string[] { try { return JSON.parse(value) as string[]; } catch { return []; } }
function lines(value: string): string[] { return value.split("\n").map((line) => line.trim()).filter(Boolean); }
