import { useEffect, useState } from "react";
import { Check, LockKeyhole, Plus, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { api, type Member, type SessionData } from "./api";

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
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  async function load() { try { setMembers((await api.members()).data); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not load members"); } }
  useEffect(() => { void load(); }, []);
  async function invite() { try { await api.createMember({ name, email, role }); onNotice(`${name} added. Cloudflare Access must also allow this email.`); setInviting(false); setName(""); setEmail(""); await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not add member"); } }
  async function update(id: string, body: { role?: string; status?: string }) { try { await api.updateMember(id, body); onNotice("Membership updated and audited."); await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update member"); } }
  return <section className="team-page"><div className="page-title"><div><span className="eyebrow"><Users size={14}/> ORGANIZATION ACCESS</span><h1>Team & roles</h1><p>Cloudflare Access verifies identity. Workrr membership controls tenant scope and application capabilities.</p></div><button className="primary" onClick={() => setInviting(true)}><Plus size={15}/>Add member</button></div><div className="identity-boundary panel"><LockKeyhole size={20}/><span><strong>Two-layer identity boundary</strong><small>A person must pass Cloudflare Access and have an active Workrr membership. Removing either blocks access.</small></span><span className="healthy"><i/>Enforced</span></div><div className="members-table panel"><div className="members-head"><span>Member</span><span>Role</span><span>Status</span><span>Last active</span></div>{members.map((member) => <div className="member-row" key={member.id}><span><i>{initials(member.display_name)}</i><span><strong>{member.display_name}</strong><small>{member.email}{member.id === session?.user.id ? " · You" : ""}</small></span></span><select value={member.role} disabled={member.id === session?.user.id} onChange={(event) => void update(member.id, { role: event.target.value })}>{Object.keys(roleInfo).map((value) => <option key={value} value={value}>{value}</option>)}</select><button className={`member-status ${member.status}`} disabled={member.id === session?.user.id} onClick={() => void update(member.id, { status: member.status === "active" ? "suspended" : "active" })}><i/>{member.status}</button><span>{member.last_seen_at ?? "Never"}</span></div>)}</div><div className="roles-grid">{Object.entries(roleInfo).map(([roleName, description]) => <article className="panel" key={roleName}><span><ShieldCheck size={17}/></span><div><strong>{roleName}</strong><small>{description}</small></div></article>)}</div>{inviting && <div className="mini-modal-backdrop"><div className="invite-modal"><button className="close" onClick={() => setInviting(false)}><X size={16}/></button><span className="wizard-icon"><UserRound size={20}/></span><h2>Add organization member</h2><p>This creates Workrr authorization. Add the same email to the customer’s Cloudflare Access policy.</p><label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus/></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label><label>Initial role<select value={role} onChange={(event) => setRole(event.target.value)}>{Object.keys(roleInfo).map((value) => <option key={value}>{value}</option>)}</select></label><button className="primary" disabled={!name.trim() || !email.includes("@")} onClick={() => void invite()}><Check size={15}/>Add member</button></div></div>}</section>;
}
function initials(value: string) { return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
