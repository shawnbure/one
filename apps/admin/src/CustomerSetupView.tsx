import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Circle, Download, FileDown, KeyRound, LifeBuoy, Rocket, Settings2, ShieldCheck, UserPlus } from "lucide-react";
import { api, type ManagedLifecycleData, type OnboardingData, type ProcessTemplate, type SessionData } from "./api";

export function CustomerSetupView({ session, onNotice }: { session: SessionData | null; onNotice: (message: string) => void }) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [lifecycle, setLifecycle] = useState<ManagedLifecycleData | null>(null);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ organizationName: "", supportEmail: "", accentColor: "#1f7a5b", defaultModelProfile: "balanced", dataRegion: "Cloudflare global network" });
  const [launch, setLaunch] = useState({
    templateId: "template-customer-ops", processName: "Customer Operations", purpose: "Triage customer requests and prepare approved responses.",
    businessOwner: "Operations", department: "Operations", riskLevel: "medium", volumePerMonth: 500, minutesPerItem: 10,
    hourlyCost: 40, errorRatePercent: 5, teammateName: "", teammateEmail: "", teammateRole: "operator"
  });
  const [lifecycleForm, setLifecycleForm] = useState({
    supportOwnerId: "", recoveryOwnerId: "", escalationEmail: "", maintenanceDayUtc: 0,
    maintenanceHourUtc: 8, recoveryReviewDueAt: "", supportNotes: ""
  });

  async function load() {
    try {
      const [result, templateResult, lifecycleResult] = await Promise.all([
        api.onboarding(), api.processTemplates(), api.lifecycle()
      ]);
      setTemplates(templateResult.data);
      const next = result.data;
      setData(next);
      setLifecycle(lifecycleResult.data);
      const lifecycleSettings = lifecycleResult.data.settings;
      if (lifecycleSettings) setLifecycleForm({
        supportOwnerId: lifecycleSettings.support_owner_id ?? "",
        recoveryOwnerId: lifecycleSettings.recovery_owner_id ?? "",
        escalationEmail: lifecycleSettings.escalation_email,
        maintenanceDayUtc: Number(lifecycleSettings.maintenance_day_utc),
        maintenanceHourUtc: Number(lifecycleSettings.maintenance_hour_utc),
        recoveryReviewDueAt: lifecycleSettings.recovery_review_due_at?.slice(0, 10) ?? "",
        supportNotes: lifecycleSettings.support_notes ?? ""
      });
      if (next.settings) setForm({ organizationName: next.settings.organization_name, supportEmail: next.settings.support_email,
        accentColor: next.settings.accent_color, defaultModelProfile: next.settings.default_model_profile, dataRegion: next.settings.data_region });
    } catch (error) { onNotice(error instanceof Error ? error.message : "Customer setup could not load"); }
  }

  async function bootstrap() {
    setLaunching(true);
    try {
      const teammate = launch.teammateEmail.trim() && launch.teammateName.trim()
        ? { email: launch.teammateEmail.trim(), name: launch.teammateName.trim(), role: launch.teammateRole } : undefined;
      const result = await api.bootstrapCustomer({
        ...form, idempotencyKey, member: teammate,
        firstProcess: {
          templateId: launch.templateId, name: launch.processName, purpose: launch.purpose,
          businessOwner: launch.businessOwner, department: launch.department, riskLevel: launch.riskLevel,
          baseline: { volumePerMonth: launch.volumePerMonth, minutesPerItem: launch.minutesPerItem,
            hourlyCost: launch.hourlyCost, errorRate: launch.errorRatePercent / 100 }
        }
      });
      setData(result.data);
      onNotice(result.data.launch.alreadyCompleted ? "Customer baseline was already complete." : "Customer baseline launched as a paused, reviewable draft.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Customer launch failed"); }
    finally { setLaunching(false); }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    setSaving(true);
    try { setData((await api.updateOnboarding(form)).data); onNotice("Customer environment profile saved and audited."); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Customer setup could not be saved"); }
    finally { setSaving(false); }
  }
  async function saveLifecycle() {
    setSaving(true);
    try {
      const result = await api.updateLifecycle({
        ...lifecycleForm,
        recoveryReviewDueAt: lifecycleForm.recoveryReviewDueAt
          ? `${lifecycleForm.recoveryReviewDueAt}T23:59:59.000Z` : null
      });
      setLifecycle(result.data);
      onNotice("Managed lifecycle ownership and recovery review saved.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Lifecycle settings could not be saved"); }
    finally { setSaving(false); }
  }

  if (!data) return <div className="loading-card">Loading customer setup…</div>;
  const ready = data.checklist.filter((item) => item.ready).length;
  return <section className="setup-page">
    <div className="page-title"><div><span className="eyebrow"><Settings2 size={14}/> CUSTOMER ENVIRONMENT</span><h1>Customer setup</h1><p>One controlled manifest establishes the customer identity, operating defaults, and deployment handoff.</p></div>
      <a className="export-button" href="/api/onboarding/export"><Download size={15}/>Export portable manifest</a></div>
    <div className="setup-layout">
      <article className="setup-form panel">
        <div className="section-head"><div><h2>Organization profile</h2><p>Non-secret configuration that follows this customer deployment.</p></div><span>{session?.user.role ?? "viewer"}</span></div>
        <label>Organization name<input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })}/></label>
        <label>Support and security contact<input type="email" value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}/></label>
        <div className="setup-fields"><label>Brand accent<input type="color" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })}/></label>
          <label>Default model profile<select value={form.defaultModelProfile} onChange={(e) => setForm({ ...form, defaultModelProfile: e.target.value })}><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="reasoning">Reasoning</option></select></label></div>
        <label>Data execution boundary<input value={form.dataRegion} onChange={(e) => setForm({ ...form, dataRegion: e.target.value })}/></label>
        <div className="setup-note"><ShieldCheck size={17}/><span><strong>Secrets are intentionally excluded</strong><small>Credentials remain Cloudflare secrets and are never placed in a manifest or D1 export.</small></span></div>
        <button className="primary setup-save" disabled={saving || session?.user.role !== "admin"} onClick={() => void save()}>{saving ? "Saving…" : "Save customer profile"}</button>
      </article>
      <aside className="setup-checklist panel"><span className="score-ring">{ready}/{data.checklist.length}</span><h2>Environment readiness</h2><p>These controls make the deployment supportable before customer handoff.</p>
        <div>{data.checklist.map((item) => <span key={item.id} className={item.ready ? "ready" : "pending"}>{item.ready ? <CheckCircle2 size={17}/> : <Circle size={17}/>}<strong>{item.label}</strong><small>{item.ready ? "Ready" : "Action required"}</small></span>)}</div>
      </aside>
    </div>
    <article className="setup-launch panel">
      <div className="section-head"><div><h2>Customer launch package</h2><p>Provision one supportable baseline. The first process remains paused and draft until its evaluation and release review pass.</p></div><span className={`connection-state ${data.bootstrap?.status === "completed" ? "healthy" : "attention"}`}><i/>{data.bootstrap?.status ?? "Not launched"}</span></div>
      {data.bootstrap?.status === "completed" ? <div className="launch-complete"><span className="launch-icon"><CheckCircle2 size={24}/></span><span><strong>Baseline environment established</strong><small>Process {data.bootstrap.process_id} · membership {data.bootstrap.member_id} · completed {formatDate(data.bootstrap.completed_at)}</small></span><ShieldCheck size={20}/></div> :
      <div className="launch-grid">
        <div className="launch-process">
          <h3><Rocket size={16}/> First process</h3>
          <label>Starting template<select value={launch.templateId} onChange={(event) => setLaunch({ ...launch, templateId: event.target.value })}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <div className="setup-fields"><label>Process name<input value={launch.processName} onChange={(event) => setLaunch({ ...launch, processName: event.target.value })}/></label><label>Department<input value={launch.department} onChange={(event) => setLaunch({ ...launch, department: event.target.value })}/></label></div>
          <label>Business purpose<textarea value={launch.purpose} onChange={(event) => setLaunch({ ...launch, purpose: event.target.value })}/></label>
          <div className="setup-fields"><label>Business owner<input value={launch.businessOwner} onChange={(event) => setLaunch({ ...launch, businessOwner: event.target.value })}/></label><label>Risk level<select value={launch.riskLevel} onChange={(event) => setLaunch({ ...launch, riskLevel: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
          <div className="baseline-fields"><label>Items / month<input type="number" min="0" value={launch.volumePerMonth} onChange={(event) => setLaunch({ ...launch, volumePerMonth: Number(event.target.value) })}/></label><label>Minutes / item<input type="number" min="0" value={launch.minutesPerItem} onChange={(event) => setLaunch({ ...launch, minutesPerItem: Number(event.target.value) })}/></label><label>Hourly cost<input type="number" min="0" value={launch.hourlyCost} onChange={(event) => setLaunch({ ...launch, hourlyCost: Number(event.target.value) })}/></label><label>Error rate %<input type="number" min="0" max="100" value={launch.errorRatePercent} onChange={(event) => setLaunch({ ...launch, errorRatePercent: Number(event.target.value) })}/></label></div>
        </div>
        <div className="launch-member">
          <h3><UserPlus size={16}/> First operating teammate <em>Optional</em></h3>
          <p>The authenticated administrator is already retained. Add the first operator now or manage the team later.</p>
          <label>Name<input value={launch.teammateName} onChange={(event) => setLaunch({ ...launch, teammateName: event.target.value })}/></label>
          <label>Email<input type="email" value={launch.teammateEmail} onChange={(event) => setLaunch({ ...launch, teammateEmail: event.target.value })}/></label>
          <label>Role<select value={launch.teammateRole} onChange={(event) => setLaunch({ ...launch, teammateRole: event.target.value })}><option value="operator">Operator</option><option value="owner">Owner</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option><option value="builder">Builder</option></select></label>
          <div className="setup-note"><ShieldCheck size={17}/><span><strong>Safe first state</strong><small>The process is paused, the release is draft, and no connector credential is included.</small></span></div>
          <button className="primary launch-button" disabled={launching || session?.user.role !== "admin"} onClick={() => void bootstrap()}><Rocket size={15}/>{launching ? "Launching…" : "Launch customer baseline"}</button>
        </div>
      </div>}
    </article>
    <article className="access-handoff panel">
      <span className="access-handoff-icon"><KeyRound size={21}/></span>
      <span><strong>Cloudflare Access member handoff</strong><small>Export the active Workrr member allowlist for review and idempotent application by an FDE. No API token or customer secret is included.</small></span>
      <a className="export-button" href="/api/onboarding/access-handoff"><Download size={15}/>Download Access handoff</a>
    </article>
    {lifecycle && <article className="lifecycle-center panel">
      <div className="section-head"><div><h2><LifeBuoy size={18}/> Managed lifecycle</h2><p>Named ownership, maintenance timing, recovery review, and redacted evidence for the team operating Workrr after handoff.</p></div>
        <span className={`connection-state ${lifecycle.preflight.status === "ready" ? "healthy" : "attention"}`}><i/>
          {lifecycle.preflight.ready}/{lifecycle.preflight.total} ready</span></div>
      <div className="lifecycle-grid"><section className="lifecycle-form">
        <div className="setup-fields"><label>Support owner<select value={lifecycleForm.supportOwnerId} onChange={(event) =>
          setLifecycleForm({ ...lifecycleForm, supportOwnerId: event.target.value })}><option value="">Select owner</option>
          {lifecycle.members.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.role}</option>)}</select></label>
          <label>Recovery owner<select value={lifecycleForm.recoveryOwnerId} onChange={(event) =>
            setLifecycleForm({ ...lifecycleForm, recoveryOwnerId: event.target.value })}><option value="">Select owner</option>
          {lifecycle.members.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.role}</option>)}</select></label></div>
        <label>Escalation contact<input type="email" value={lifecycleForm.escalationEmail} onChange={(event) =>
          setLifecycleForm({ ...lifecycleForm, escalationEmail: event.target.value })}/></label>
        <div className="lifecycle-maintenance"><CalendarClock size={18}/><label>Maintenance day UTC<select value={lifecycleForm.maintenanceDayUtc} onChange={(event) =>
          setLifecycleForm({ ...lifecycleForm, maintenanceDayUtc: Number(event.target.value) })}>
          {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day, index) =>
            <option key={day} value={index}>{day}</option>)}</select></label>
          <label>Hour UTC<input type="number" min="0" max="23" value={lifecycleForm.maintenanceHourUtc} onChange={(event) =>
            setLifecycleForm({ ...lifecycleForm, maintenanceHourUtc: Number(event.target.value) })}/></label>
          <label>Recovery review due<input type="date" value={lifecycleForm.recoveryReviewDueAt} onChange={(event) =>
            setLifecycleForm({ ...lifecycleForm, recoveryReviewDueAt: event.target.value })}/></label></div>
        <label>Support and recovery notes<textarea maxLength={2000} placeholder="Escalation path, maintenance constraints, recovery evidence location, and customer contacts."
          value={lifecycleForm.supportNotes} onChange={(event) => setLifecycleForm({ ...lifecycleForm, supportNotes: event.target.value })}/></label>
        <div className="lifecycle-actions"><button className="primary" disabled={saving || !["admin","owner"].includes(session?.user.role ?? "")}
          onClick={() => void saveLifecycle()}>{saving ? "Saving…" : "Save lifecycle controls"}</button>
          {["admin","owner","operator"].includes(session?.user.role ?? "") && <a className="export-button" href="/api/lifecycle/support-bundle">
            <FileDown size={15}/>Download redacted support bundle</a>}</div>
        <small className="bundle-boundary">The support bundle excludes credentials, destinations, prompts, knowledge content, execution payloads, member emails, and API bodies.</small>
      </section><section className="preflight-list"><h3>Environment preflight</h3>{lifecycle.preflight.checks.map((item) =>
        <div key={item.id} className={item.ready ? "ready" : "pending"}>{item.ready ? <CheckCircle2 size={17}/> : <Circle size={17}/>}
          <span><strong>{item.label}</strong><small>{item.detail}</small></span><em>{item.category}</em></div>)}</section></div>
    </article>}
  </section>;
}
function formatDate(value: string | null) {
  if (!value) return "recorded";
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
