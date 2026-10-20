import type { Env } from "./types";

const severities = ["critical", "high", "medium", "low"] as const;
const statuses = ["open", "investigating", "contained", "monitoring", "resolved", "closed"] as const;
type IncidentStatus = typeof statuses[number];

export async function getIncidentOperations(env: Env, tenantId: string) {
  const [control, incidents] = await Promise.all([
    env.DB.prepare("SELECT * FROM tenant_operating_controls WHERE tenant_id = ?").bind(tenantId).first(),
    env.DB.prepare(`SELECT i.*, b.name process_name FROM incidents i LEFT JOIN agent_blueprints b
      ON b.id = i.blueprint_id AND b.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1
      WHEN 'contained' THEN 2 WHEN 'monitoring' THEN 3 WHEN 'resolved' THEN 4 ELSE 5 END, i.opened_at DESC LIMIT 100`)
      .bind(tenantId).all()
  ]);
  return { control: control ?? { tenant_id: tenantId, mode: "active", incident_id: null, reason: null }, incidents: incidents.results };
}

export async function getIncidentDetail(env: Env, tenantId: string, incidentId: string) {
  const incident = await env.DB.prepare(`SELECT i.*, b.name process_name FROM incidents i LEFT JOIN agent_blueprints b
    ON b.id = i.blueprint_id AND b.tenant_id = i.tenant_id WHERE i.id = ? AND i.tenant_id = ?`)
    .bind(incidentId, tenantId).first();
  if (!incident) return null;
  const events = await env.DB.prepare(`SELECT id, actor_id, event_type, from_status, to_status, detail, evidence_json, created_at
    FROM incident_events WHERE tenant_id = ? AND incident_id = ? ORDER BY created_at, id`).bind(tenantId, incidentId).all();
  return { incident, events: events.results };
}

export async function createIncident(env: Env, tenantId: string, actorId: string, input: {
  title?: string; severity?: string; category?: string; impact?: string; blueprintId?: string; ownerId?: string; notes?: string;
}) {
  if (!input.title?.trim() || !input.severity || !severities.includes(input.severity as typeof severities[number])) {
    throw new Error("Incident title and valid severity are required");
  }
  if (input.blueprintId) {
    const process = await env.DB.prepare("SELECT id FROM agent_blueprints WHERE id = ? AND tenant_id = ?")
      .bind(input.blueprintId, tenantId).first();
    if (!process) throw new Error("Incident process not found");
  }
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO incidents
      (id, tenant_id, title, severity, status, notes, blueprint_id, owner_id, category, impact, detected_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(id, tenantId, input.title.trim().slice(0, 200), input.severity, input.notes?.trim().slice(0, 4000) ?? "",
        input.blueprintId ?? null, input.ownerId ?? actorId, input.category?.trim().slice(0, 80) || "operations",
        input.impact?.trim().slice(0, 1000) || ""),
    eventStatement(env, tenantId, id, actorId, "incident.opened", null, "open",
      input.notes?.trim() || "Incident opened", { severity: input.severity, blueprintId: input.blueprintId ?? null })
  ]);
  return { id, status: "open" as const };
}

export async function transitionIncident(env: Env, tenantId: string, actorId: string, incidentId: string, input: {
  status?: IncidentStatus; note?: string; ownerId?: string; rootCause?: string; resolution?: string;
}) {
  const incident = await env.DB.prepare("SELECT status FROM incidents WHERE id = ? AND tenant_id = ?")
    .bind(incidentId, tenantId).first<{ status: IncidentStatus }>();
  if (!incident) throw new Error("Incident not found");
  if (!input.status || !statuses.includes(input.status)) throw new Error("Valid incident status is required");
  const allowed: Record<IncidentStatus, IncidentStatus[]> = {
    open: ["investigating", "contained", "resolved"],
    investigating: ["contained", "monitoring", "resolved"],
    contained: ["monitoring", "resolved", "investigating"],
    monitoring: ["resolved", "investigating"],
    resolved: ["closed", "investigating"],
    closed: []
  };
  if (!allowed[incident.status].includes(input.status)) throw new Error(`Incident cannot move from ${incident.status} to ${input.status}`);
  if (!input.note?.trim()) throw new Error("A transition note is required");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE incidents SET status = ?, owner_id = COALESCE(?, owner_id),
      acknowledged_at = CASE WHEN ? = 'investigating' AND acknowledged_at IS NULL THEN ? ELSE acknowledged_at END,
      contained_at = CASE WHEN ? = 'contained' AND contained_at IS NULL THEN ? ELSE contained_at END,
      resolved_at = CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at, ?) ELSE resolved_at END,
      closed_by = CASE WHEN ? = 'closed' THEN ? ELSE closed_by END,
      root_cause = COALESCE(?, root_cause), resolution = COALESCE(?, resolution),
      notes = CASE WHEN notes = '' THEN ? ELSE notes || char(10) || ? END, updated_at = ?
      WHERE id = ? AND tenant_id = ?`)
      .bind(input.status, input.ownerId ?? null, input.status, now, input.status, now, input.status, now,
        input.status, actorId, input.rootCause?.trim().slice(0, 2000) || null, input.resolution?.trim().slice(0, 2000) || null,
        input.note.trim(), input.note.trim(), now, incidentId, tenantId),
    eventStatement(env, tenantId, incidentId, actorId, "incident.transitioned", incident.status, input.status,
      input.note.trim(), { ownerId: input.ownerId ?? null })
  ]);
  return { id: incidentId, from: incident.status, status: input.status, updatedAt: now };
}

export async function setTenantOperatingMode(env: Env, tenantId: string, actorId: string, input: {
  mode?: "active" | "drain" | "emergency_stop"; reason?: string; incidentId?: string;
}) {
  if (!input.mode || !["active", "drain", "emergency_stop"].includes(input.mode)) throw new Error("Valid tenant mode is required");
  if (!input.reason?.trim()) throw new Error("A containment or recovery reason is required");
  const current = await env.DB.prepare("SELECT mode, incident_id FROM tenant_operating_controls WHERE tenant_id = ?")
    .bind(tenantId).first<{ mode: string; incident_id: string | null }>();
  let incidentId = input.incidentId ?? current?.incident_id ?? null;
  if (input.mode === "emergency_stop" && !incidentId) {
    incidentId = (await createIncident(env, tenantId, actorId, {
      title: "Tenant emergency stop", severity: "critical", category: "containment",
      impact: input.reason, ownerId: actorId, notes: "Automatically opened by the tenant emergency stop."
    })).id;
  }
  if (incidentId) {
    const incident = await env.DB.prepare("SELECT status FROM incidents WHERE id = ? AND tenant_id = ?")
      .bind(incidentId, tenantId).first<{ status: string }>();
    if (!incident) throw new Error("Containment incident not found");
    if (input.mode === "active" && current?.mode === "emergency_stop" &&
        !["contained", "monitoring", "resolved", "closed"].includes(incident.status)) {
      throw new Error("Contain or resolve the linked incident before tenant recovery");
    }
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO tenant_operating_controls (tenant_id, mode, incident_id, reason, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode, incident_id=excluded.incident_id,
      reason=excluded.reason, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .bind(tenantId, input.mode, input.mode === "active" ? null : incidentId, input.reason.trim().slice(0, 1000), actorId, now).run();
  if (incidentId) {
    await env.DB.prepare(`UPDATE incidents SET containment_mode = ?,
      recovery_at = CASE WHEN ? = 'active' THEN ? ELSE recovery_at END, updated_at = ?
      WHERE id = ? AND tenant_id = ?`).bind(input.mode, input.mode, now, now, incidentId, tenantId).run();
    await eventStatement(env, tenantId, incidentId, actorId, `tenant.${input.mode}`, null, null,
      input.reason.trim(), { previousMode: current?.mode ?? "active", mode: input.mode }).run();
  }
  return { mode: input.mode, incidentId: input.mode === "active" ? null : incidentId, updatedAt: now };
}

export async function setProcessOperatingMode(env: Env, tenantId: string, actorId: string, processId: string, input: {
  mode?: string; reason?: string; incidentId?: string;
}) {
  const modes = ["active", "shadow", "read_only", "approval_only", "paused", "drain", "emergency_stop"];
  if (!input.mode || !modes.includes(input.mode)) throw new Error("A valid operating mode is required");
  const process = await env.DB.prepare("SELECT name, operating_mode FROM agent_blueprints WHERE id = ? AND tenant_id = ?")
    .bind(processId, tenantId).first<{ name: string; operating_mode: string }>();
  if (!process) throw new Error("Process not found");
  if (!input.reason?.trim()) throw new Error("A mode-change reason is required");
  let incidentId = input.incidentId ?? null;
  if (input.mode === "emergency_stop" && !incidentId) {
    incidentId = (await createIncident(env, tenantId, actorId, {
      title: `${process.name} emergency stop`, severity: "high", category: "containment", blueprintId: processId,
      impact: input.reason, ownerId: actorId, notes: "Automatically opened by the process emergency stop."
    })).id;
  }
  if (process.operating_mode === "emergency_stop" && input.mode !== "emergency_stop") {
    let linked: { id: string; status: string } | null = null;
    if (incidentId) {
      linked = await env.DB.prepare("SELECT id, status FROM incidents WHERE id = ? AND tenant_id = ? AND (blueprint_id = ? OR blueprint_id IS NULL)")
        .bind(incidentId, tenantId, processId).first<{ id: string; status: string }>();
    } else {
      linked = await env.DB.prepare(`SELECT id, status FROM incidents WHERE tenant_id = ? AND blueprint_id = ?
        AND containment_mode = 'emergency_stop' ORDER BY opened_at DESC LIMIT 1`).bind(tenantId, processId)
        .first<{ id: string; status: string }>();
    }
    incidentId = linked?.id ?? null;
    if (!linked || !["contained", "monitoring", "resolved", "closed"].includes(linked.status)) {
      throw new Error("Contain or resolve the linked incident before process recovery");
    }
  }
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE agent_blueprints SET operating_mode = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
    .bind(input.mode, now, tenantId, processId).run();
  if (incidentId) {
    await env.DB.prepare(`UPDATE incidents SET containment_mode = ?, recovery_at = CASE WHEN ? <> 'emergency_stop' THEN ? ELSE recovery_at END,
      updated_at = ? WHERE id = ? AND tenant_id = ? AND (blueprint_id = ? OR blueprint_id IS NULL)`)
      .bind(input.mode, input.mode, now, now, incidentId, tenantId, processId).run();
    await eventStatement(env, tenantId, incidentId, actorId, `process.${input.mode}`, null, null, input.reason.trim(),
      { processId, previousMode: process.operating_mode, mode: input.mode }).run();
  }
  return { updated: true, mode: input.mode, incidentId, previousMode: process.operating_mode };
}

function eventStatement(env: Env, tenantId: string, incidentId: string, actorId: string, eventType: string,
  fromStatus: string | null, toStatus: string | null, detail: string, evidence: unknown) {
  return env.DB.prepare(`INSERT INTO incident_events
    (id, tenant_id, incident_id, actor_id, event_type, from_status, to_status, detail, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, incidentId, actorId, eventType, fromStatus, toStatus,
      detail.slice(0, 2000), JSON.stringify(evidence ?? {}));
}
