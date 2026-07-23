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
  Upload,
  XCircle,
} from "lucide-react";
import { api, type EvaluationDetail, type GovernanceData, type KnowledgeCitation, type ToolAdapterDefinition,
  type ToolDefinition } from "./api";
import "./governed-standards.css";

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
  if (section === "Knowledge") return <Knowledge data={data} onReload={load} onNotice={onNotice} />;
  if (section === "Evaluations") return <Evaluations data={data} onReload={load} onNotice={onNotice} />;
  return <Governance data={data} onReload={load} onNotice={onNotice} />;
}

function Connections({ data, onReload, onNotice }: { data: GovernanceData; onReload: () => Promise<void>; onNotice: (message: string) => void }) {
  const [checking, setChecking] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolAdapters, setToolAdapters] = useState<ToolAdapterDefinition[]>([]);
  const [toolBusy, setToolBusy] = useState(false);
  const [toolForm, setToolForm] = useState({
    name: "", description: "", owner: "", adapterKind: "mock", connectionId: "", handlerKey: "",
    accessMode: "read", riskLevel: "low", dataClassification: "internal", rateLimitPerMinute: "60",
    supportInstructions: "", processIds: [] as string[],
    inputSchema: '{\n  "type": "object",\n  "additionalProperties": true\n}',
    outputSchema: '{\n  "type": "object",\n  "additionalProperties": true\n}'
  });
  const [capabilities, setCapabilities] = useState({ mail: true, mail_send: true, calendar: true, files: false });
  async function loadTools() {
    try {
      const [catalog, adapters] = await Promise.all([api.tools(), api.toolAdapters()]);
      setTools(catalog.data);
      setToolAdapters(adapters.data);
    }
    catch (error) { onNotice(error instanceof Error ? error.message : "Tool catalog could not be loaded"); }
  }
  useEffect(() => { void loadTools(); }, []);
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
  async function connectMicrosoft() {
    setOauthBusy(true);
    try {
      const selected = Object.entries(capabilities).filter(([, enabled]) => enabled).map(([name]) => name);
      const result = await api.startMicrosoftOAuth(selected);
      window.location.assign(result.data.authorizationUrl);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Microsoft authorization could not start");
      setOauthBusy(false);
    }
  }
  async function disconnectMicrosoftConnection() {
    if (!window.confirm("Disconnect Microsoft 365 and remove the stored delegated refresh token?")) return;
    setOauthBusy(true);
    try {
      await api.disconnectMicrosoft();
      await onReload();
      onNotice("Microsoft 365 disconnected. Stored token material is no longer usable.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Microsoft 365 could not be disconnected");
    } finally { setOauthBusy(false); }
  }
  async function createTypedTool(event: React.FormEvent) {
    event.preventDefault();
    setToolBusy(true);
    try {
      await api.createTool({
        ...toolForm,
        connectionId: toolForm.connectionId || null,
        rateLimitPerMinute: Number(toolForm.rateLimitPerMinute),
        inputSchema: JSON.parse(toolForm.inputSchema),
        outputSchema: JSON.parse(toolForm.outputSchema)
      });
      setToolForm((current) => ({ ...current, name: "", description: "", supportInstructions: "", processIds: [] }));
      await loadTools();
      onNotice("Typed tool created. It will enter a process only through a new immutable release.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Tool could not be created"); }
    finally { setToolBusy(false); }
  }
  async function toggleTool(tool: ToolDefinition) {
    setToolBusy(true);
    try {
      await api.setToolEnabled(tool.id, !Number(tool.enabled));
      await loadTools();
      onNotice(`${tool.name} ${Number(tool.enabled) ? "disabled" : "enabled"}. Existing release snapshots remain unchanged.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Tool status could not be changed"); }
    finally { setToolBusy(false); }
  }
  async function toggleToolProcess(tool: ToolDefinition, processId: string) {
    const current = tool.process_ids ? tool.process_ids.split(",").filter(Boolean) : [];
    const next = current.includes(processId) ? current.filter((id) => id !== processId) : [...current, processId];
    setToolBusy(true);
    try {
      await api.setToolBindings(tool.id, next);
      await loadTools();
      onNotice(`${tool.name} process scope updated. Publish a new release to activate the change.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Tool process scope could not be changed"); }
    finally { setToolBusy(false); }
  }
  const microsoft = data.connections.find((item) => item.name === "Microsoft 365");
  const microsoftConnected = microsoft && Number(microsoft.secret_configured) === 1;
  return (
    <section className="foundation-page">
      <Title
        icon={<Link2 size={14} />}
        eyebrow="INTEGRATION BOUNDARY"
        title="Connections"
        text="Credentials, permissions, ownership, and health for every system an AI process can reach."
      />
      <article className="microsoft-connect panel">
        <div className="microsoft-mark">M</div>
        <div><span className="eyebrow"><KeyRound size={14}/> DELEGATED OAUTH</span><h2>Microsoft 365</h2>
          <p>Connect one operating account with selectable least-privilege permissions. Tokens are encrypted before D1 persistence and never returned to the browser.</p>
          {microsoftConnected && <small className="oauth-account">Connected as {String(microsoft?.oauth_account_email || microsoft?.oauth_account_name || "delegated account")}</small>}
        </div>
        <div className="oauth-capabilities">
          <strong>Requested capabilities</strong>
          <label><input type="checkbox" checked={capabilities.mail} onChange={(event) => setCapabilities({ ...capabilities, mail: event.target.checked })}/> Mail metadata <small>Mail.ReadBasic</small></label>
          <label><input type="checkbox" checked={capabilities.mail_send} onChange={(event) => setCapabilities({ ...capabilities, mail_send: event.target.checked })}/> Send notifications <small>Mail.Send</small></label>
          <label><input type="checkbox" checked={capabilities.calendar} onChange={(event) => setCapabilities({ ...capabilities, calendar: event.target.checked })}/> Calendar basics <small>Calendars.ReadBasic</small></label>
          <label><input type="checkbox" checked={capabilities.files} onChange={(event) => setCapabilities({ ...capabilities, files: event.target.checked })}/> User files <small>Files.Read</small></label>
        </div>
        <div className="oauth-actions">
          <button className="primary" disabled={oauthBusy} onClick={() => void connectMicrosoft()}>{oauthBusy ? "Working…" : microsoftConnected ? "Reconnect permissions" : "Connect Microsoft 365"}</button>
          {microsoftConnected && <button disabled={oauthBusy} onClick={() => void disconnectMicrosoftConnection()}>Disconnect</button>}
        </div>
      </article>
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
              {item.oauth_account_email && <div><dt>Delegated account</dt><dd>{item.oauth_account_email}</dd></div>}
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
      <div className="tool-catalog panel">
        <div className="section-head"><div><span className="eyebrow"><Box size={14}/> GOVERNED CAPABILITIES</span>
          <h2>Typed tool catalog</h2><p>Define schemas, risk, ownership, limits, connection readiness, and process scope. Mock tools are safe extension points and do not perform external actions.</p></div></div>
        <div className="tool-layout">
          <div className="typed-tool-list">
            {tools.length ? tools.map((tool) => {
              const connectionReady = tool.adapter_kind === "mock" ||
                (Boolean(tool.connection_id) && tool.connection_status === "healthy" && Number(tool.connection_secret_configured) === 1);
              const implementationReady = Boolean(tool.handler_key && Number(tool.handler_ready));
              return <article key={tool.id} className={!Number(tool.enabled) ? "disabled" : ""}>
                <span className={`tool-access ${tool.access_mode}`}>{tool.access_mode}</span>
                <span><strong>{tool.name.replaceAll("_", " ")}</strong><small>{tool.description}</small>
                  <em>{tool.adapter_kind.replaceAll("_", " ")} · {tool.risk_level} risk · {tool.data_classification} · {tool.rate_limit_per_minute}/min</em>
                  <small>{tool.handler_key ? `Bound implementation · ${tool.handler_key}` : "Proposal-only implementation"}</small>
                  <small>{tool.process_names || "Not bound to a process"} · Owner {tool.owner}</small>
                  <span className="tool-process-bindings">{data.processes.map((process) => {
                    const bound = (tool.process_ids || "").split(",").includes(String(process.id));
                    return <button type="button" disabled={toolBusy} className={bound ? "bound" : ""}
                      key={String(process.id)} onClick={() => void toggleToolProcess(tool, String(process.id))}>
                      {bound ? "✓ " : "+ "}{processOptionLabel(process, data.processes)}</button>;
                  })}</span></span>
                <span className={`connection-state ${implementationReady || (tool.adapter_kind === "mock" && connectionReady) ? "healthy" : "attention"}`}><i/>
                  {implementationReady ? "bound adapter ready" : tool.handler_key ? "scope or connection required" :
                    tool.adapter_kind === "mock" ? "simulation ready" : "proposal only"}</span>
                <button disabled={toolBusy} onClick={() => void toggleTool(tool)}>{Number(tool.enabled) ? "Disable" : "Enable"}</button>
              </article>;
            }) : <p className="empty-copy">No typed tools are registered yet.</p>}
          </div>
          <form className="tool-builder" onSubmit={(event) => void createTypedTool(event)}>
            <div className="section-head"><div><h3>Add a typed tool</h3><p>New bindings affect only future releases.</p></div></div>
            <label>Tool name<input required pattern="[a-z][a-z0-9_]{2,63}" placeholder="lookup_customer" value={toolForm.name}
              onChange={(event) => setToolForm({ ...toolForm, name: event.target.value.toLowerCase().replaceAll("-", "_").replace(/[^a-z0-9_]/g, "") })}/></label>
            <label>Description<textarea required maxLength={500} placeholder="Read the approved customer record by identifier." value={toolForm.description}
              onChange={(event) => setToolForm({ ...toolForm, description: event.target.value })}/></label>
            <div className="two-fields"><label>Owner<input required maxLength={120} placeholder="Customer Operations" value={toolForm.owner}
              onChange={(event) => setToolForm({ ...toolForm, owner: event.target.value })}/></label>
              <label>Adapter<select value={toolForm.adapterKind} onChange={(event) => setToolForm({
                ...toolForm, adapterKind: event.target.value, handlerKey: "", connectionId: ""
              })}>
                <option value="mock">Mock / local extension</option><option value="http">Typed HTTP</option>
                <option value="microsoft">Microsoft 365</option><option value="database">Database</option>
                <option value="import_export">Import / export</option></select></label></div>
            <label>Implementation<select value={toolForm.handlerKey} onChange={(event) => setToolForm({
              ...toolForm, handlerKey: event.target.value,
              accessMode: event.target.value ? "read" : toolForm.accessMode,
              riskLevel: event.target.value ? "low" : toolForm.riskLevel,
              connectionId: event.target.value
                ? String(data.connections.find((item) => String(item.name) === "Microsoft 365")?.id ?? "")
                : toolForm.connectionId,
              inputSchema: event.target.value
                ? JSON.stringify(toolAdapters.find((adapter) => adapter.key === event.target.value)?.inputSchema ?? {}, null, 2)
                : toolForm.inputSchema
            })}>
              <option value="">Proposal only · no external call</option>
              {toolAdapters.filter((adapter) => adapter.adapterKind === toolForm.adapterKind).map((adapter) =>
                <option key={adapter.key} value={adapter.key}>{adapter.label} ({adapter.scope})</option>)}
            </select><small>Only registered fixed-endpoint adapters can run. Generic HTTP remains proposal-only.</small></label>
            <div className="two-fields"><label>Access<select value={toolForm.accessMode} onChange={(event) => setToolForm({ ...toolForm, accessMode: event.target.value })}>
              <option value="read">Read</option><option value="write">Write</option></select></label>
              <label>Risk<select value={toolForm.riskLevel} onChange={(event) => setToolForm({ ...toolForm, riskLevel: event.target.value })}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
            <div className="two-fields"><label>Data class<select value={toolForm.dataClassification} onChange={(event) => setToolForm({ ...toolForm, dataClassification: event.target.value })}>
              <option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></label>
              <label>Rate / minute<input type="number" min="1" max="10000" value={toolForm.rateLimitPerMinute}
                onChange={(event) => setToolForm({ ...toolForm, rateLimitPerMinute: event.target.value })}/></label></div>
            <label>Connection<select value={toolForm.connectionId} onChange={(event) => setToolForm({ ...toolForm, connectionId: event.target.value })}>
              <option value="">No connection · mock only</option>{data.connections.map((connection) =>
                <option key={String(connection.id)} value={String(connection.id)}>{String(connection.name)}</option>)}</select></label>
            <fieldset><legend>Bind to processes</legend>{data.processes.map((process) => <label key={String(process.id)}>
              <input type="checkbox" checked={toolForm.processIds.includes(String(process.id))} onChange={(event) =>
                setToolForm({ ...toolForm, processIds: event.target.checked ? [...toolForm.processIds, String(process.id)] :
                  toolForm.processIds.filter((id) => id !== String(process.id)) })}/>{processOptionLabel(process, data.processes)}</label>)}</fieldset>
            <label>Input JSON Schema<textarea className="tool-schema" disabled={Boolean(toolForm.handlerKey)}
              value={toolForm.inputSchema} onChange={(event) => setToolForm({ ...toolForm, inputSchema: event.target.value })}/>
              {toolForm.handlerKey && <small>The registered adapter fixes this bounded input contract.</small>}</label>
            <label>Output JSON Schema<textarea className="tool-schema" value={toolForm.outputSchema} onChange={(event) => setToolForm({ ...toolForm, outputSchema: event.target.value })}/></label>
            <label>Support instructions<textarea maxLength={2000} placeholder="Owner, escalation, sandbox, and recovery notes." value={toolForm.supportInstructions}
              onChange={(event) => setToolForm({ ...toolForm, supportInstructions: event.target.value })}/></label>
            <button className="primary" disabled={toolBusy}>{toolBusy ? "Saving…" : "Create typed tool"}</button>
          </form>
        </div>
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
function Knowledge({ data, onReload, onNotice }: {
  data: GovernanceData; onReload: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [form, setForm] = useState({ name: "", owner: "", provenance: "", sensitivity: "internal", expiresAt: "", text: "" });
  const [file, setFile] = useState<File | null>(null);
  const [processes, setProcesses] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [queryProcess, setQueryProcess] = useState("");
  const [citations, setCitations] = useState<KnowledgeCitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    setBusy("upload");
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      body.set("allowedProcesses", JSON.stringify(processes));
      if (file) body.set("file", file);
      await api.createKnowledgeSource(body);
      setForm({ name: "", owner: "", provenance: "", sensitivity: "internal", expiresAt: "", text: "" });
      setFile(null);
      setProcesses([]);
      onNotice("Source accepted. Cloudflare Queue is indexing it now.");
      await onReload();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Source upload failed"); }
    finally { setBusy(null); }
  }
  async function testQuery(event: React.FormEvent) {
    event.preventDefault();
    setBusy("query");
    try {
      const result = await api.queryKnowledge(query, queryProcess || undefined);
      setCitations(result.data);
      if (!result.data.length) onNotice("No approved source matched this query.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Knowledge query failed"); }
    finally { setBusy(null); }
  }
  async function reindex(id: string) {
    setBusy(id);
    try { await api.reindexKnowledgeSource(id); onNotice("Reindex queued."); await onReload(); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Reindex failed"); }
    finally { setBusy(null); }
  }
  async function review(id: string) {
    const proposed = window.prompt("Review expiry (YYYY-MM-DD). Leave blank for no expiry:", "");
    if (proposed === null) return;
    setBusy(id);
    try { await api.reviewKnowledgeSource(id, proposed || null); onNotice("Source review recorded and retrieval restored."); await onReload(); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Review failed"); }
    finally { setBusy(null); }
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove ${name} and its indexed chunks?`)) return;
    setBusy(id);
    try { await api.deleteKnowledgeSource(id); onNotice("Source and indexed chunks removed."); await onReload(); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Removal failed"); }
    finally { setBusy(null); }
  }
  return (
    <section className="foundation-page">
      <Title
        icon={<Database size={14} />}
        eyebrow="PROVENANCE AND ACCESS"
        title="Knowledge"
        text="Approved sources remain attributable, sensitivity-labelled, and explicitly bound to processes."
      />
      <div className="knowledge-workspace">
        <form className="panel knowledge-ingest" onSubmit={upload}>
          <div className="panel-head"><div><h2>Add an approved source</h2><p>Text, Markdown, CSV, or JSON · 2 MB maximum · DLP checked before storage</p></div></div>
          <div className="knowledge-form-grid">
            <label>Name<input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Business owner<input required maxLength={120} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
            <label>Provenance<input required maxLength={300} placeholder="Approved handbook v4" value={form.provenance}
              onChange={(e) => setForm({ ...form, provenance: e.target.value })} /></label>
            <label>Sensitivity<select value={form.sensitivity} onChange={(e) => setForm({ ...form, sensitivity: e.target.value })}>
              <option value="public">Public</option><option value="internal">Internal</option>
              <option value="confidential">Confidential</option><option value="restricted">Restricted</option>
            </select></label>
            <label>Review expiry<input type="date" value={form.expiresAt}
              min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
          </div>
          <label>Approved processes <small>Leave empty to make this source available to all processes.</small></label>
          <div className="knowledge-processes">
            {data.processes.map((process) => {
              const processId = String(process.id);
              return <label key={processId}><input type="checkbox" checked={processes.includes(processId)}
                onChange={(event) => setProcesses(event.target.checked ? [...processes, processId] : processes.filter((id) => id !== processId))} />
                {process.name}</label>;
            })}
          </div>
          <label>Paste source text<textarea rows={7} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })}
            placeholder="Paste a policy, playbook, procedure, or approved reference…" /></label>
          <div className="knowledge-upload-row">
            <label className="file-picker"><Upload size={16} /> Choose file<input type="file" accept=".txt,.md,.markdown,.csv,.json,text/*,application/json"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            <span>{file?.name ?? "No file selected"}</span>
            <button className="primary" disabled={busy === "upload"}>{busy === "upload" ? "Uploading…" : "Add and index"}</button>
          </div>
        </form>
        <form className="panel knowledge-test" onSubmit={testQuery}>
          <div className="panel-head"><div><h2>Retrieval test</h2><p>See exactly what a process can retrieve, with source evidence.</p></div></div>
          <label>Process scope<select value={queryProcess} onChange={(event) => setQueryProcess(event.target.value)}>
            <option value="">All approved sources</option>
            {data.processes.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}
          </select></label>
          <label>Question<textarea required rows={4} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="What does our policy say about…?" /></label>
          <button className="primary" disabled={busy === "query"}>{busy === "query" ? "Searching…" : "Test retrieval"}</button>
          <div className="citation-list">
            {citations.map((citation, index) => <article key={citation.chunkId}>
              <strong>[K{index + 1}] {citation.sourceName}</strong>
              <small>{Math.round(citation.score * 100)}% match · {citation.provenance}</small>
              <p>{citation.excerpt}</p>
            </article>)}
          </div>
        </form>
      </div>
      <div className="knowledge-section-head"><div><h2>Source catalog</h2><p>{data.knowledge.length} governed sources</p></div></div>
      <div className="knowledge-list panel">
        {data.knowledge.map((item) => (
          <article key={String(item.id)}>
            <span className="knowledge-icon">
              <FileText size={19} />
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.provenance}</small>
              <small>{item.chunk_count ? `${item.chunk_count} chunks · v${item.version}` : "No indexed content"}
                {item.expires_at ? ` · review by ${new Date(item.expires_at).toLocaleDateString()}` : " · no review expiry"}</small>
              <em>
                {parseArray(item.allowed_processes_json ?? "[]").join(" · ") || "All processes"}
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
            <span className="knowledge-actions">
              {item.object_key
                ? <button type="button" disabled={busy === item.id} onClick={() => void reindex(String(item.id))}><RefreshCw size={14} /> Reindex</button>
                : <small className="legacy-source">Legacy catalog entry</small>}
              {item.object_key && <button type="button" disabled={busy === item.id} onClick={() => void review(String(item.id))}>
                <FileCheck2 size={14} /> Review</button>}
              <button type="button" disabled={busy === item.id} onClick={() => void remove(String(item.id), String(item.name))}><XCircle size={14} /> Remove</button>
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
  const [datasetBusy, setDatasetBusy] = useState<"export" | "import" | null>(null);
  const [rubricPackageBusy, setRubricPackageBusy] = useState<"export" | "import" | null>(null);
  const [templateBusy, setTemplateBusy] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: "", description: "",
    criteria: [{ criterion: "", dimension: "completeness" as "groundedness" | "completeness" | "safety" | "clarity" | "format", weight: 1 }]
  });
  const [caseForm, setCaseForm] = useState({ name: "", input: "", expected: "", prohibited: "",
    format: "text" as "text" | "json", maxChars: 2000,
    dimension: "groundedness" as "groundedness" | "completeness" | "safety" | "clarity" | "format",
    assertionWeight: 1, caseWeight: 1, rubricCriterion: "", rubricTemplateId: "" });
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
        format: caseForm.format, maxChars: caseForm.maxChars, dimension: caseForm.dimension,
        assertionWeight: caseForm.assertionWeight, caseWeight: caseForm.caseWeight,
        rubricCriterion: caseForm.rubricCriterion, rubricTemplateId: caseForm.rubricTemplateId
      });
      setCaseForm({ name: "", input: "", expected: "", prohibited: "", format: "text", maxChars: 2000,
        dimension: "groundedness", assertionWeight: 1, caseWeight: 1, rubricCriterion: "", rubricTemplateId: "" });
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
  async function exportDataset() {
    if (!selected || !detail) return;
    setDatasetBusy("export");
    try {
      const result = await api.exportEvaluationDataset(selected);
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${detail.scenario.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "evaluation"}-workrr.json`;
      link.click();
      URL.revokeObjectURL(url);
      onNotice(`Exported ${result.data.scenario.cases.length} anonymized evaluation cases.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Evaluation package could not be exported"); }
    finally { setDatasetBusy(null); }
  }
  async function createTemplate() {
    if (!selected) return;
    setTemplateBusy("create");
    try {
      await api.createRubricTemplate({
        name: templateForm.name,
        description: templateForm.description,
        criteria: templateForm.criteria
      });
      setTemplateForm({ name: "", description: "",
        criteria: [{ criterion: "", dimension: "completeness", weight: 1 }] });
      await inspect(selected);
      onNotice("Organization rubric template created and ready for new evaluation cases.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Rubric template could not be created"); }
    finally { setTemplateBusy(null); }
  }
  async function toggleTemplate(id: string, enabled: boolean) {
    if (!selected) return;
    setTemplateBusy(id);
    try {
      await api.updateRubricTemplate(id, { enabled });
      await inspect(selected);
      onNotice(enabled ? "Rubric template restored." : "Rubric template archived; existing cases are unchanged.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Rubric template could not be updated"); }
    finally { setTemplateBusy(null); }
  }
  async function exportRubrics() {
    setRubricPackageBusy("export");
    try {
      const result = await api.exportRubricPackage();
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "workrr-organization-rubrics.json";
      link.click();
      URL.revokeObjectURL(url);
      onNotice(`Exported ${result.data.templates.length} organization rubric templates.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Rubric package could not be exported"); }
    finally { setRubricPackageBusy(null); }
  }
  async function importRubrics(file: File | undefined) {
    if (!selected || !file) return;
    setRubricPackageBusy("import");
    try {
      if (file.size > 250_000) throw new Error("Rubric packages must be smaller than 250 KB");
      const manifest = JSON.parse(await file.text());
      const result = await api.importRubricPackage(manifest);
      await inspect(selected);
      onNotice(result.data.pendingReview
        ? `Verified signed package queued for owner approval (${result.data.pendingReview.slice(0, 8)}).`
        : `Imported ${result.data.imported} archived templates; ${result.data.skipped} existing templates skipped.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Rubric package could not be imported"); }
    finally { setRubricPackageBusy(null); }
  }
  async function reviewRubrics(id: string, decision: "approved" | "rejected") {
    if (!selected) return;
    setTemplateBusy(id);
    try {
      const result = await api.reviewRubricPackage(id, decision);
      await inspect(selected);
      onNotice(decision === "approved"
        ? `Approved package; ${result.data.imported} templates imported archived for destination review.`
        : "Signed rubric package rejected and retained as audit evidence.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Package review could not be completed"); }
    finally { setTemplateBusy(null); }
  }
  async function trustPublisher(reviewId: string) {
    if (!selected) return;
    setTemplateBusy(reviewId);
    try {
      await api.trustRubricPublisher(reviewId, "manual");
      await inspect(selected);
      onNotice("Publisher key trusted with manual approval required. You can change its policy below.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Publisher trust could not be saved"); }
    finally { setTemplateBusy(null); }
  }
  async function updatePublisher(id: string, body: { policy?: "manual" | "auto_approve" | "block";
    status?: "active" | "suspended" }) {
    if (!selected) return;
    setTemplateBusy(id);
    try {
      await api.updateRubricPublisher(id, body);
      await inspect(selected);
      onNotice("Publisher trust policy updated and audited.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Publisher trust could not be updated"); }
    finally { setTemplateBusy(null); }
  }
  async function importDataset(file: File | undefined) {
    if (!selected || !file) return;
    setDatasetBusy("import");
    try {
      if (file.size > 1_000_000) throw new Error("Evaluation packages must be smaller than 1 MB");
      const manifest = JSON.parse(await file.text());
      const result = await api.importEvaluationDataset(selected, manifest);
      await inspect(selected);
      await onReload();
      onNotice(`Imported ${result.data.imported} cases; ${result.data.skipped} existing cases skipped.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Evaluation package could not be imported"); }
    finally { setDatasetBusy(null); }
  }
  const latest = detail?.runs[0];
  const rubric = latest ? rubricDimensions(latest.evidence_json) : [];
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
          <div className="section-head"><div><h2>{detail.scenario.name}</h2><p>{detail.scenario.process_name} · exact-release golden-case regression</p></div><span className="evaluation-lab-actions"><span>{detail.cases.length} {detail.cases.length === 1 ? "case" : "cases"}</span><button disabled={datasetBusy !== null} onClick={() => void exportDataset()}><Download size={15}/>{datasetBusy === "export" ? "Exporting…" : "Export package"}</button><label className="dataset-import"><Upload size={15}/>{datasetBusy === "import" ? "Importing…" : "Import package"}<input type="file" accept="application/json,.json" disabled={datasetBusy !== null} onChange={(event) => { void importDataset(event.target.files?.[0]); event.target.value = ""; }}/></label><button disabled={suiteRunning} onClick={() => void queueSuite()}><Workflow size={15}/>{suiteRunning ? "Queueing…" : "Run durable suite"}</button></span></div>
          <div className="comparison-strip">
            <article><small>LATEST RELEASE</small><strong>{latest ? `v${latest.release_version ?? "?"} · ${(Number(latest.score) * 100).toFixed(0)}%` : "Not run"}</strong><span className={`connection-state ${latest?.status ?? "attention"}`}><i/>{latest?.status ?? "not run"}</span></article>
            <article><small>PREVIOUS COMPARISON</small><strong>{previous ? `v${previous.release_version ?? "?"} · ${(Number(previous.score) * 100).toFixed(0)}%` : "No baseline"}</strong><span>{delta === null ? "Run another release to compare" : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)} percentage points`}</span></article>
            <article><small>RELEASE COST</small><strong>{latest ? money(Number(latest.estimated_cost_usd)) : "$0.0000"}</strong><span>{latest ? `${number(Number(latest.total_tokens))} model tokens` : "No inference recorded"}</span></article>
          </div>
          <div className="rubric-strip">
            <div><strong>Weighted quality rubric</strong><small>Each assertion contributes to a customer-selected quality dimension.</small></div>
            {rubric.length ? rubric.map((item) => <article key={item.dimension}><small>{item.dimension}</small>
              <strong>{(item.score * 100).toFixed(0)}%</strong><span>{item.weight.toFixed(1)} weight</span></article>)
              : <p className="empty-copy">Run the suite to populate dimension-level evidence.</p>}
          </div>
          <div className="rubric-library">
            <div className="section-head"><div><h3>Organization rubric templates</h3><p>Reusable standards are copied into each case, keeping durable runs independent from later template edits.</p></div><span className="rubric-library-actions"><small>{detail.rubricTemplates.length}/20 templates</small><button disabled={rubricPackageBusy !== null} onClick={() => void exportRubrics()}><Download size={14}/>{rubricPackageBusy === "export" ? "Exporting…" : "Export standards"}</button><label className="dataset-import"><Upload size={14}/>{rubricPackageBusy === "import" ? "Importing…" : "Import standards"}<input type="file" accept="application/json,.json" disabled={rubricPackageBusy !== null} onChange={(event) => { void importRubrics(event.target.files?.[0]); event.target.value = ""; }}/></label></span></div>
            {detail.rubricPackageReviews.filter((review) => review.status === "pending").map((review) => {
              const trust = detail.rubricPublisherTrust.find((item) => item.publisher_key_id === review.publisher_key_id);
              return <article className="rubric-package-review" key={review.id}><ShieldCheck size={18}/><span>
                <strong>{review.publisher_name}</strong><small>{trust
                  ? `Valid signature · recognized key · ${trust.status === "active" ? trust.policy.replace("_", " ") : "trust suspended"}`
                  : `Valid signature · untrusted until this tenant recognizes key ${review.publisher_key_id?.slice(0, 12)}…`}</small>
              </span>{!trust && <button disabled={templateBusy === review.id} onClick={() => void trustPublisher(review.id)}>Trust key</button>}
              <button disabled={templateBusy === review.id} onClick={() => void reviewRubrics(review.id, "rejected")}>Reject</button>
              <button className="primary" disabled={templateBusy === review.id} onClick={() => void reviewRubrics(review.id, "approved")}>Approve import</button></article>;
            })}
            {detail.rubricPublisherTrust.length > 0 && <div className="publisher-trust-list"><div><strong>Trusted publisher keys</strong>
              <small>Trust is tenant-specific. Automatic approval still imports templates archived.</small></div>
              {detail.rubricPublisherTrust.map((trust) => <article key={trust.id}><ShieldCheck size={16}/><span>
                <strong>{trust.publisher_name}</strong><small>{trust.publisher_key_id.slice(0, 16)}…</small></span>
                <select value={trust.policy} disabled={templateBusy === trust.id || trust.status === "suspended"}
                  onChange={(event) => void updatePublisher(trust.id, { policy: event.target.value as typeof trust.policy })}>
                  <option value="manual">Manual approval</option><option value="auto_approve">Auto-approve signed packages</option>
                  <option value="block">Block publisher</option></select>
                <button disabled={templateBusy === trust.id} onClick={() => void updatePublisher(trust.id,
                  { status: trust.status === "active" ? "suspended" : "active" })}>{trust.status === "active" ? "Suspend" : "Restore"}</button>
              </article>)}</div>}
            <div className="rubric-template-grid">
              <div className="rubric-template-list">
                {detail.rubricTemplates.map((template) => {
                  const criteria = rubricCriteria(template.criteria_json);
                  return <article key={template.id}><span><strong>{template.name}</strong><small>{template.description || "No description"}</small></span><span className="rubric-template-criteria">{criteria.map((criterion, index) => <small key={`${template.id}-${index}`}>{criterion.dimension} · {criterion.weight.toFixed(1)} — {criterion.criterion}</small>)}</span><button disabled={templateBusy === template.id} onClick={() => void toggleTemplate(template.id, !Boolean(template.enabled))}>{template.enabled ? "Archive" : "Restore"}</button></article>;
                })}
              </div>
              <div className="rubric-template-builder">
                <strong>Create reusable template</strong>
                <label>Name<input maxLength={120} value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })}/></label>
                <label>Description<textarea maxLength={500} value={templateForm.description} onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })}/></label>
                {templateForm.criteria.map((criterion, index) => <div className="rubric-criterion-row" key={index}>
                  <label>Criterion {index + 1}<textarea maxLength={500} value={criterion.criterion} onChange={(event) => setTemplateForm({ ...templateForm, criteria: templateForm.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, criterion: event.target.value } : item) })}/></label>
                  <div className="case-fields"><label>Dimension<select value={criterion.dimension} onChange={(event) => setTemplateForm({ ...templateForm, criteria: templateForm.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, dimension: event.target.value as typeof item.dimension } : item) })}><option value="groundedness">Groundedness</option><option value="completeness">Completeness</option><option value="safety">Safety</option><option value="clarity">Clarity</option><option value="format">Format</option></select></label><label>Weight<input type="number" min="0.1" max="10" step="0.1" value={criterion.weight} onChange={(event) => setTemplateForm({ ...templateForm, criteria: templateForm.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, weight: Number(event.target.value) } : item) })}/></label></div>
                </div>)}
                <span className="rubric-template-actions"><button disabled={templateForm.criteria.length >= 3} onClick={() => setTemplateForm({ ...templateForm, criteria: [...templateForm.criteria, { criterion: "", dimension: "completeness", weight: 1 }] })}>Add criterion</button>{templateForm.criteria.length > 1 && <button onClick={() => setTemplateForm({ ...templateForm, criteria: templateForm.criteria.slice(0, -1) })}>Remove last</button>}<button className="primary" disabled={templateBusy === "create"} onClick={() => void createTemplate()}>{templateBusy === "create" ? "Saving…" : "Save template"}</button></span>
              </div>
            </div>
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
              <label>Organization rubric <small>optional · copied into this case</small><select value={caseForm.rubricTemplateId} onChange={(event) => setCaseForm({ ...caseForm, rubricTemplateId: event.target.value })}><option value="">No reusable template</option>{detail.rubricTemplates.filter((template) => Boolean(template.enabled)).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
              <label>AI judge criterion <small>optional · one bounded Cloudflare AI grading call</small><textarea className="rubric-criterion" maxLength={500} placeholder="Example: The response identifies the operational risk and recommends a practical next action." value={caseForm.rubricCriterion} onChange={(event) => setCaseForm({ ...caseForm, rubricCriterion: event.target.value })}/></label>
              <div className="case-fields"><label>Quality dimension<select value={caseForm.dimension} onChange={(event) => setCaseForm({ ...caseForm, dimension: event.target.value as typeof caseForm.dimension })}><option value="groundedness">Groundedness</option><option value="completeness">Completeness</option><option value="safety">Safety</option><option value="clarity">Clarity</option><option value="format">Format</option></select></label><label>Case weight<input type="number" min="0.1" max="10" step="0.1" value={caseForm.caseWeight} onChange={(event) => setCaseForm({ ...caseForm, caseWeight: Number(event.target.value) })}/></label></div>
              <div className="case-fields"><label>Format<select value={caseForm.format} onChange={(event) => setCaseForm({ ...caseForm, format: event.target.value as "text" | "json" })}><option value="text">Text</option><option value="json">Valid JSON</option></select></label><label>Assertion weight<input type="number" min="0.1" max="10" step="0.1" value={caseForm.assertionWeight} onChange={(event) => setCaseForm({ ...caseForm, assertionWeight: Number(event.target.value) })}/></label></div>
              <label>Maximum characters<input type="number" min="1" max="50000" value={caseForm.maxChars} onChange={(event) => setCaseForm({ ...caseForm, maxChars: Number(event.target.value) })}/></label>
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
function rubricDimensions(value: string) {
  try {
    const evidence = JSON.parse(value) as { dimensions?: Array<{ dimension: string; score: number; weight: number }> };
    return Array.isArray(evidence.dimensions) ? evidence.dimensions.filter((item) =>
      typeof item.dimension === "string" && Number.isFinite(Number(item.score)) && Number.isFinite(Number(item.weight))) : [];
  } catch { return []; }
}
function rubricCriteria(value: string) {
  try {
    const criteria = JSON.parse(value) as Array<{ criterion: string; dimension: string; weight: number }>;
    return Array.isArray(criteria) ? criteria.filter((item) => typeof item.criterion === "string" &&
      typeof item.dimension === "string" && Number.isFinite(Number(item.weight))) : [];
  } catch { return []; }
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
  const [dlpBusy, setDlpBusy] = useState<string | null>(null);
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
  async function changeDlp(detector: string, action: "audit" | "redact" | "block",
    direction: "input" | "output" | "both", enabled: boolean) {
    setDlpBusy(detector);
    try {
      await api.updateDlpRule(detector, { action, direction, enabled });
      await onReload();
      onNotice(`${detector.replaceAll("_", " ")} DLP policy updated.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "DLP policy update failed"); }
    finally { setDlpBusy(null); }
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
      <article className="dlp-center panel">
        <div className="section-head"><div><span className="eyebrow"><LockKeyhole size={14}/> DATA LOSS PREVENTION</span><h2>Model-boundary DLP</h2><p>Inspect content before Queue, Workflow, Agent, model, and persisted-preview boundaries.</p></div><span className="dlp-total">{data.dlpEvents.reduce((sum, event) => sum + Number(event.match_count), 0)} detections recorded</span></div>
        <div className="dlp-layout">
          <div className="dlp-rules">
            {data.dlpRules.map((rule) => <div key={rule.detector}>
              <label className="dlp-toggle"><input type="checkbox" checked={Boolean(rule.enabled)} disabled={dlpBusy === rule.detector}
                onChange={(event) => void changeDlp(rule.detector, rule.action, rule.direction, event.target.checked)}/><span><strong>{rule.label}</strong><small>{rule.detector.replaceAll("_", " ")}</small></span></label>
              <select value={rule.action} disabled={dlpBusy === rule.detector} onChange={(event) =>
                void changeDlp(rule.detector, event.target.value as "audit" | "redact" | "block", rule.direction, Boolean(rule.enabled))}>
                <option value="audit">Audit only</option><option value="redact">Redact</option><option value="block">Block</option>
              </select>
              <select value={rule.direction} disabled={dlpBusy === rule.detector} onChange={(event) =>
                void changeDlp(rule.detector, rule.action, event.target.value as "input" | "output" | "both", Boolean(rule.enabled))}>
                <option value="both">Input + output</option><option value="input">Input only</option><option value="output">Output only</option>
              </select>
            </div>)}
          </div>
          <div className="dlp-evidence"><div className="section-head"><div><h3>Recent evidence</h3><p>Counts and policy actions only—matched content is never logged.</p></div></div>
            {data.dlpEvents.length ? data.dlpEvents.slice(0, 8).map((event, index) => <article key={`${event.created_at}-${event.detector}-${index}`}>
              <span className={`dlp-action ${event.action}`}>{event.action}</span><span><strong>{event.detector.replaceAll("_", " ")}</strong><small>{event.stage} · {event.direction} · {event.created_at}</small></span><em>{event.match_count}</em>
            </article>) : <p className="empty-copy">No sensitive-pattern detections recorded.</p>}
          </div>
        </div>
      </article>
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
function processOptionLabel(process: Record<string, string>, all: Array<Record<string, string>>) {
  const name = String(process.name);
  const duplicate = all.filter((item) => String(item.name) === name).length > 1;
  return duplicate ? `${name} · ${String(process.id).slice(-6)}` : name;
}
