import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, CalendarClock, Check, KeyRound, Laptop, LockKeyhole, Plus, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { api, type AccessOperationsData, type ApprovalDelegation, type Member, type ServicePrincipal, type SessionData } from "./api";
import "./machine-access.css";

const roleInfo: Record<string, string> = {
  admin: "Environment, identity, releases, and every process control",
  builder: "Build, test, and create draft process releases",
  owner: "Own processes, publish releases, and change operating modes",
  operator: "Operate runs, exceptions, assignments, and safe replay",
  reviewer: "Approve or decline consequential actions",
  viewer: "Read operations, audit, and governance information",
  consumer: "Start and participate in authorized AI processes",
};

export function TeamRolesView({ session, onNotice }: { session: SessionData | null; onNotice: (message: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [machines, setMachines] = useState<ServicePrincipal[]>([]);
  const [delegations, setDelegations] = useState<ApprovalDelegation[]>([]);
  const [access, setAccess] = useState<AccessOperationsData | null>(null);
  const [emergencyMember, setEmergencyMember] = useState("");
  const [emergencyProcedure, setEmergencyProcedure] = useState("");
  const [emergencyEvidence, setEmergencyEvidence] = useState("");
  const [emergencyReviewDue, setEmergencyReviewDue] = useState("");
  const [emergencyEnabled, setEmergencyEnabled] = useState(true);
  const [eventDrafts, setEventDrafts] = useState<Record<string, { classification: "drill" | "incident" | "false_positive"; note: string }>>({});
  const [modal, setModal] = useState<"member" | "machine" | "machine-lifecycle" | "delegation" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [commonName, setCommonName] = useState("");
  const [machineRole, setMachineRole] = useState<"operator" | "viewer">("operator");
  const [machineExpiry, setMachineExpiry] = useState("");
  const [machineOwner, setMachineOwner] = useState("");
  const [machineRotatedAt, setMachineRotatedAt] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<ServicePrincipal | null>(null);
  const [delegatingMemberId, setDelegatingMemberId] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [delegationReason, setDelegationReason] = useState("");
  const [delegationEnabled, setDelegationEnabled] = useState(true);
  const privileged = ["admin", "owner"].includes(session?.user.role ?? "");
  async function load() { try {
    const [people, coverage, principals, accessData] = await Promise.all([
      api.members(), api.approvalDelegations(),
      ["admin", "owner", "viewer"].includes(session?.user.role ?? "") ? api.servicePrincipals() : Promise.resolve({ data: [] }),
      ["admin", "owner", "viewer"].includes(session?.user.role ?? "") ? api.accessOperations() : Promise.resolve({ data: null })
    ]);
    setMembers(people.data); setDelegations(coverage.data); setMachines(principals.data);
    setAccess(accessData.data);
    if (accessData.data?.plan) {
      setEmergencyMember(accessData.data.plan.member_id);
      setEmergencyProcedure(accessData.data.plan.procedure_summary);
      setEmergencyEvidence(accessData.data.plan.evidence_reference);
      setEmergencyReviewDue(accessData.data.plan.review_due_at.slice(0, 10));
      setEmergencyEnabled(Boolean(accessData.data.plan.enabled));
    } else if (accessData.data) {
      setEmergencyReviewDue(new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
    }
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not load identities"); } }
  useEffect(() => { void load(); }, []);
  async function invite() { try { await api.createMember({ name, email, role }); onNotice(`${name} added. Cloudflare Access must also allow this email.`);
    setModal(null); setName(""); setEmail(""); await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not add member"); } }
  async function updateMember(id: string, body: { role?: string; status?: string }) { try { await api.updateMember(id, body);
    onNotice("Membership updated and audited."); await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update member"); } }
  async function addMachine() { try { await api.createServicePrincipal({ commonName, displayName: name,
    role: machineRole, credentialExpiresAt: new Date(`${machineExpiry}T23:59:59Z`).toISOString(),
    rotationOwner: machineOwner });
    onNotice("Machine identity registered. Its secret remains in your secret manager."); setModal(null); setName(""); setCommonName(""); await load();
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not add machine identity"); } }
  async function updateMachine(machine: ServicePrincipal,
    body: { role?: "operator" | "viewer"; status?: "active" | "suspended"; credentialExpiresAt?: string;
      rotationOwner?: string; lastRotatedAt?: string }) { try {
    await api.updateServicePrincipal(machine.id, { ...body, expectedRevision: machine.revision });
    onNotice("Machine identity updated and audited."); await load();
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update machine identity"); } }
  function openMachineLifecycle(machine: ServicePrincipal) {
    setSelectedMachine(machine); setMachineExpiry(machine.credential_expires_at.slice(0, 10));
    setMachineOwner(machine.rotation_owner ?? ""); setMachineRotatedAt(machine.last_rotated_at?.slice(0, 10) ?? "");
    setModal("machine-lifecycle");
  }
  async function saveMachineLifecycle() {
    if (!selectedMachine) return;
    await updateMachine(selectedMachine, {
      credentialExpiresAt: new Date(`${machineExpiry}T23:59:59Z`).toISOString(),
      rotationOwner: machineOwner,
      ...(machineRotatedAt ? { lastRotatedAt: new Date(`${machineRotatedAt}T12:00:00Z`).toISOString() } : {})
    });
    setModal(null); setSelectedMachine(null);
  }
  function openDelegation(member: Member) {
    const current = delegations.find((item) => item.member_id === member.id);
    const start = current ? new Date(current.starts_at) : new Date();
    const end = current ? new Date(current.ends_at) : new Date(Date.now() + 7 * 86_400_000);
    setDelegatingMemberId(member.id); setDelegateId(current?.delegate_id ?? "");
    setStartsAt(localDateTime(start)); setEndsAt(localDateTime(end));
    setDelegationReason(current?.reason ?? "Out of office coverage");
    setDelegationEnabled(current ? Boolean(current.enabled) : true); setModal("delegation");
  }
  async function saveDelegation() { try {
    const current = delegations.find((item) => item.member_id === delegatingMemberId);
    await api.setApprovalDelegation(delegatingMemberId, {
      delegateId, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
      reason: delegationReason, enabled: delegationEnabled, expectedRevision: current?.revision
    });
    onNotice("Approval coverage saved and audited."); setModal(null); await load();
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not save approval coverage"); } }
  async function saveEmergencyPlan() { try {
    const response = await api.updateEmergencyAccessPlan({
      memberId: emergencyMember, procedureSummary: emergencyProcedure,
      evidenceReference: emergencyEvidence, reviewDueAt: new Date(`${emergencyReviewDue}T23:59:59Z`).toISOString(),
      enabled: emergencyEnabled, expectedRevision: access?.plan?.revision ?? 0
    });
    setAccess(response.data); onNotice("Emergency access plan saved and audited.");
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not save emergency access plan"); } }
  async function reviewEmergencyEvent(eventId: string, revision: number) { try {
    const draft = eventDrafts[eventId] ?? { classification: "drill" as const, note: "" };
    const response = await api.reviewEmergencyAccessEvent(eventId, { ...draft, expectedRevision: revision });
    setAccess(response.data); onNotice("Emergency session classified and audited.");
  } catch (error) { onNotice(error instanceof Error ? error.message : "Could not review emergency session"); } }

  return <section className="team-page">
    <div className="page-title"><div><span className="eyebrow"><Users size={14}/> ORGANIZATION ACCESS</span><h1>Team & Roles</h1>
      <p>Cloudflare Access verifies identity. Workrr membership controls tenant scope and application capabilities.</p></div>
      {session?.user.role === "admin" && <button className="primary" onClick={() => { setName(""); setModal("member"); }}><Plus size={15}/>Add member</button>}</div>
    <div className="identity-boundary panel"><LockKeyhole size={20}/><span><strong>Two-layer identity boundary</strong>
      <small>Every person or machine must pass Cloudflare Access and have an active, tenant-scoped Workrr identity.</small></span>
      <span className="healthy"><i/>Enforced</span></div>
    <IdentityTable members={members} session={session} update={updateMember}/>
    <div className="machine-heading coverage-heading"><div><span className="eyebrow"><CalendarClock size={14}/> APPROVAL COVERAGE</span>
      <h2>Substitute approvers</h2><p>Route new approval work to a trusted teammate during a scheduled absence.</p></div></div>
    <div className="coverage-grid">
      {members.filter((member) => ["admin", "owner", "operator", "reviewer"].includes(member.role) && member.status === "active")
        .map((member) => {
          const coverage = delegations.find((item) => item.member_id === member.id);
          const manageable = privileged || member.id === session?.user.id;
          return <article className="coverage-card panel" key={member.id}><span className={coverage?.active_now ? "coverage-state active" : "coverage-state"}>
            {coverage?.active_now ? "Active now" : coverage?.enabled ? "Scheduled" : "No coverage"}</span>
            <strong>{member.display_name}</strong>
            <p>{coverage ? `Routes to ${coverage.delegate_name}` : "New approvals stay with this person."}</p>
            {coverage && <small>{formatCoverage(coverage.starts_at)} → {formatCoverage(coverage.ends_at)} · {coverage.reason}</small>}
            {manageable && <button onClick={() => openDelegation(member)}><CalendarClock size={14}/>{coverage ? "Edit coverage" : "Schedule coverage"}</button>}
          </article>;
        })}
    </div>
    <div className="machine-heading"><div><span className="eyebrow"><Bot size={14}/> MACHINE ACCESS</span><h2>Service principals</h2>
      <p>Register only an Access service-token Client ID. Workrr never receives or stores its secret.</p></div>
      {privileged && <button onClick={() => { setName(""); setMachineExpiry(new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
        setMachineOwner(members.find((member) => member.id === session?.user.id)?.id ??
          members.find((member) => ["owner", "admin", "operator"].includes(member.role) && member.status === "active")?.id ?? "");
        setModal("machine"); }}><Plus size={15}/>Add machine</button>}</div>
    <div className="members-table machine-principals panel"><div className="members-head"><span>Machine</span><span>Role</span><span>Status</span><span>Rotation</span><span>Last active</span></div>
      {machines.length === 0 && <div className="machine-empty">No machine identities registered.</div>}
      {machines.map((machine) => <div className="member-row" key={machine.id}><span><i><Bot size={16}/></i><span>
        <strong>{machine.display_name}</strong><small>{machine.access_common_name}</small></span></span>
        <select value={machine.role} disabled={!privileged} onChange={(event) => void updateMachine(machine, { role: event.target.value as "operator" | "viewer" })}>
          <option value="operator">operator</option><option value="viewer">viewer</option></select>
        <button className={`member-status ${machine.status}`} disabled={!privileged} onClick={() => void updateMachine(machine,
          { status: machine.status === "active" ? "suspended" : "active" })}><i/>{machine.status}</button>
        <button className={new Date(machine.credential_expires_at) <= new Date(Date.now() + 30 * 86_400_000) ? "rotation-due" : "rotation-ready"}
          disabled={!privileged} onClick={() => openMachineLifecycle(machine)}>
          <strong>{formatMachineExpiry(machine.credential_expires_at)}</strong>
          <small>{machine.rotation_owner_name ?? "Owner required"}</small></button>
        <span>{machine.last_seen_at ?? "Never"}</span></div>)}</div>
    {access && <AccessOperations access={access} session={session} privileged={privileged}
      memberId={emergencyMember} setMemberId={setEmergencyMember}
      procedure={emergencyProcedure} setProcedure={setEmergencyProcedure}
      evidence={emergencyEvidence} setEvidence={setEmergencyEvidence}
      reviewDue={emergencyReviewDue} setReviewDue={setEmergencyReviewDue}
      enabled={emergencyEnabled} setEnabled={setEmergencyEnabled}
      drafts={eventDrafts} setDrafts={setEventDrafts}
      savePlan={saveEmergencyPlan} reviewEvent={reviewEmergencyEvent}/>}
    <div className="roles-grid">{Object.entries(roleInfo).map(([roleName, description]) => <article className="panel" key={roleName}>
      <span><ShieldCheck size={17}/></span><div><strong>{roleName}</strong><small>{description}</small></div></article>)}</div>
    {modal === "member" && <IdentityModal title="Add organization member" icon={<UserRound size={20}/>}
      detail="This creates Workrr authorization. Add the same email to the customer’s Cloudflare Access policy."
      close={() => setModal(null)} action={invite} disabled={!name.trim() || !email.includes("@")}>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus/></label>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      <label>Initial role<select value={role} onChange={(event) => setRole(event.target.value)}>
        {Object.keys(roleInfo).map((value) => <option key={value}>{value}</option>)}</select></label>
    </IdentityModal>}
    {modal === "machine" && <IdentityModal title="Add machine identity" icon={<Bot size={20}/>}
      detail="Paste only the Cloudflare Access service-token Client ID. Keep the Client Secret in your deployment secret manager."
      close={() => setModal(null)} action={addMachine}
      disabled={!name.trim() || !commonName.endsWith(".access") || !machineExpiry || !machineOwner}>
      <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus/></label>
      <label>Access Client ID<input value={commonName} placeholder="…access" onChange={(event) => setCommonName(event.target.value)}/></label>
      <label>Role<select value={machineRole} onChange={(event) => setMachineRole(event.target.value as "operator" | "viewer")}>
        <option value="operator">Operator — smoke and operate</option><option value="viewer">Viewer — read only</option></select></label>
      <label>Credential expires<input type="date" value={machineExpiry}
        onChange={(event) => setMachineExpiry(event.target.value)}/></label>
      <label>Rotation owner<select value={machineOwner} onChange={(event) => setMachineOwner(event.target.value)}>
        <option value="">Choose an accountable owner</option>
        {members.filter((member) => member.status === "active" && ["admin", "owner", "operator"].includes(member.role))
          .map((member) => <option value={member.id} key={member.id}>{member.display_name} · {member.role}</option>)}</select></label>
    </IdentityModal>}
    {modal === "machine-lifecycle" && selectedMachine && <IdentityModal title="Manage machine credential"
      icon={<KeyRound size={20}/>} detail="Update lifecycle evidence after rotating the Cloudflare Access token. Workrr never receives the Client Secret."
      close={() => setModal(null)} action={saveMachineLifecycle}
      disabled={!machineExpiry || !machineOwner} actionLabel="Save lifecycle">
      <label>Credential expires<input type="date" value={machineExpiry}
        onChange={(event) => setMachineExpiry(event.target.value)}/></label>
      <label>Rotation owner<select value={machineOwner} onChange={(event) => setMachineOwner(event.target.value)}>
        {members.filter((member) => member.status === "active" && ["admin", "owner", "operator"].includes(member.role))
          .map((member) => <option value={member.id} key={member.id}>{member.display_name} · {member.role}</option>)}</select></label>
      <label>Last rotated<input type="date" value={machineRotatedAt}
        onChange={(event) => setMachineRotatedAt(event.target.value)}/></label>
    </IdentityModal>}
    {modal === "delegation" && <IdentityModal title="Schedule approval coverage" icon={<CalendarClock size={20}/>}
      detail="Only new assignments during this window are routed. Existing review items do not move."
      close={() => setModal(null)} action={saveDelegation}
      disabled={!delegateId || !startsAt || !endsAt || delegationReason.trim().length < 5} actionLabel="Save coverage">
      <label>Covering teammate<select value={delegateId} onChange={(event) => setDelegateId(event.target.value)}>
        <option value="">Choose an approver</option>
        {members.filter((member) => member.id !== delegatingMemberId && member.status === "active" &&
          ["admin", "owner", "operator", "reviewer"].includes(member.role))
          .map((member) => <option value={member.id} key={member.id}>{member.display_name} · {member.role}</option>)}</select></label>
      <label>Starts<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)}/></label>
      <label>Ends<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/></label>
      <label>Reason<input value={delegationReason} maxLength={500} onChange={(event) => setDelegationReason(event.target.value)}/></label>
      <label className="coverage-toggle"><input type="checkbox" checked={delegationEnabled}
        onChange={(event) => setDelegationEnabled(event.target.checked)}/>Route new approvals during this window</label>
    </IdentityModal>}
  </section>;
}
function AccessOperations({ access, session, privileged, memberId, setMemberId, procedure, setProcedure, evidence, setEvidence,
  reviewDue, setReviewDue, enabled, setEnabled, drafts, setDrafts, savePlan, reviewEvent }: {
  access: AccessOperationsData; session: SessionData | null; privileged: boolean;
  memberId: string; setMemberId: (value: string) => void; procedure: string; setProcedure: (value: string) => void;
  evidence: string; setEvidence: (value: string) => void; reviewDue: string; setReviewDue: (value: string) => void;
  enabled: boolean; setEnabled: (value: boolean) => void;
  drafts: Record<string, { classification: "drill" | "incident" | "false_positive"; note: string }>;
  setDrafts: (value: Record<string, { classification: "drill" | "incident" | "false_positive"; note: string }>) => void;
  savePlan: () => Promise<void>; reviewEvent: (id: string, revision: number) => Promise<void>;
}) {
  const openEvents = access.events.filter((event) => event.status === "open");
  const overdue = Boolean(access.plan && new Date(access.plan.review_due_at) < new Date());
  return <div className="access-ops">
    <div className="machine-heading"><div><span className="eyebrow"><Laptop size={14}/> ACCESS EVIDENCE</span>
      <h2>Recent authenticated sessions</h2>
      <p>Privacy-bounded evidence from Cloudflare Access. Session keys are hashed; IP addresses and raw browser strings are not stored.</p></div></div>
    <div className="session-grid">
      {access.sessions.length === 0 && <div className="panel machine-empty">Session evidence will appear after an authenticated request.</div>}
      {access.sessions.slice(0, 12).map((item) => <article className="session-card panel" key={item.id}>
        <span className={`session-kind ${item.identity_type}`}>{item.identity_type}</span>
        <strong>{item.actor_name}</strong><small>{item.actor_email}</small>
        <dl><div><dt>Client</dt><dd>{item.client_label}</dd></div>
          <div><dt>Edge</dt><dd>{[item.country_code, item.colo_code].filter(Boolean).join(" · ") || "Not reported"}</dd></div>
          <div><dt>Last seen</dt><dd>{formatMoment(item.last_seen_at)}</dd></div>
          <div><dt>Heartbeats</dt><dd>{item.request_count}</dd></div></dl>
      </article>)}
    </div>
    <div className={`emergency-panel panel ${openEvents.length || overdue ? "attention" : ""}`}>
      <div className="emergency-title"><span><KeyRound size={20}/></span><div><h2>Emergency administrator</h2>
        <p>A separate Workrr administrator that still must pass Cloudflare Access. Every new session opens a review item.</p></div>
        {(openEvents.length > 0 || overdue) && <b><AlertTriangle size={14}/>{openEvents.length ? `${openEvents.length} open review` : "Review overdue"}</b>}</div>
      <div className="emergency-form">
        <label>Dedicated administrator<select value={memberId} disabled={!privileged} onChange={(event) => setMemberId(event.target.value)}>
          <option value="">Choose a separate admin</option>
          {access.eligibleAdmins.filter((admin) => admin.id !== session?.user.id).map((admin) =>
            <option key={admin.id} value={admin.id}>{admin.display_name} · {admin.email}</option>)}</select></label>
        <label>Evidence reference<input value={evidence} disabled={!privileged} placeholder="Password vault item or runbook reference"
          onChange={(event) => setEvidence(event.target.value)}/></label>
        <label>Review due<input type="date" value={reviewDue} disabled={!privileged} onChange={(event) => setReviewDue(event.target.value)}/></label>
        <label className="procedure">Recovery procedure<textarea value={procedure} disabled={!privileged} rows={3}
          placeholder="Describe who may authorize use, how Access is recovered, and the required follow-up."
          onChange={(event) => setProcedure(event.target.value)}/></label>
        {privileged && <div className="emergency-actions"><label><input type="checkbox" checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}/>Monitor this identity</label>
          <button className="primary" disabled={!memberId || procedure.trim().length < 20 || evidence.trim().length < 5 || !reviewDue}
            onClick={() => void savePlan()}><Check size={15}/>Save plan</button></div>}
      </div>
      {access.events.length > 0 && <div className="emergency-events"><h3>Emergency session reviews</h3>
        {access.events.map((event) => {
          const draft = drafts[event.id] ?? { classification: "drill" as const, note: "" };
          return <article key={event.id} className={event.status === "open" ? "open" : ""}>
            <div><strong>{event.member_name}</strong><small>{formatMoment(event.observed_at)} · {event.client_label} · {[event.country_code, event.colo_code].filter(Boolean).join(" / ") || "edge unknown"}</small></div>
            {event.status === "reviewed" ? <span className="reviewed">Reviewed · {event.classification?.replace("_", " ")}</span> :
              privileged ? <div className="event-review"><select value={draft.classification} onChange={(e) =>
                setDrafts({ ...drafts, [event.id]: { ...draft, classification: e.target.value as typeof draft.classification } })}>
                <option value="drill">Planned drill</option><option value="incident">Incident</option><option value="false_positive">False positive</option></select>
                <input value={draft.note} placeholder="Review note (10+ characters)" onChange={(e) =>
                  setDrafts({ ...drafts, [event.id]: { ...draft, note: e.target.value } })}/>
                <button disabled={draft.note.trim().length < 10} onClick={() => void reviewEvent(event.id, event.revision)}>Complete review</button></div> :
                <span className="needs-review">Needs admin review</span>}
          </article>;
        })}</div>}
    </div>
  </div>;
}

function IdentityTable({ members, session, update }: { members: Member[]; session: SessionData | null;
  update: (id: string, body: { role?: string; status?: string }) => Promise<void> }) {
  const canManage = session?.user.role === "admin";
  return <div className="members-table panel"><div className="members-head"><span>Member</span><span>Role</span><span>Status</span><span>Last active</span></div>
    {members.map((member) => <div className="member-row" key={member.id}><span><i>{initials(member.display_name)}</i><span>
      <strong>{member.display_name}</strong><small>{member.email}{member.id === session?.user.id ? " · You" : ""}</small></span></span>
      <select value={member.role} disabled={!canManage || member.id === session?.user.id} onChange={(event) => void update(member.id, { role: event.target.value })}>
        {Object.keys(roleInfo).map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <button className={`member-status ${member.status}`} disabled={!canManage || member.id === session?.user.id}
        onClick={() => void update(member.id, { status: member.status === "active" ? "suspended" : "active" })}><i/>{member.status}</button>
      <span>{member.last_seen_at ?? "Never"}</span></div>)}</div>;
}
function IdentityModal({ title, detail, icon, close, action, disabled, children, actionLabel = "Add identity" }: { title: string; detail: string; icon: ReactNode;
  close: () => void; action: () => Promise<void>; disabled: boolean; children: ReactNode; actionLabel?: string }) {
  return <div className="mini-modal-backdrop"><div className="invite-modal"><button className="close" onClick={close}><X size={16}/></button>
    <span className="wizard-icon">{icon}</span><h2>{title}</h2><p>{detail}</p>{children}
    <button className="primary" disabled={disabled} onClick={() => void action()}><Check size={15}/>{actionLabel}</button></div></div>;
}
function initials(value: string) { return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatMachineExpiry(value: string) {
  const expiry = new Date(value);
  if (expiry <= new Date()) return `Expired ${expiry.toLocaleDateString()}`;
  const days = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} · ${expiry.toLocaleDateString()}`;
}
function formatCoverage(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(value));
}
function formatMoment(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
