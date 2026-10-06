import { Store } from "./store";
import { fail, text, choice, type Message, type Channel } from "./types";
import {
  Kinds,
  renderEvent,
  type DiscussionEvent,
  type Frame,
} from "../sdk/codec";
export function asEvent(
  m: Message,
  sequence = 0,
  actorName = "",
  threadTitle = "",
): DiscussionEvent {
  return {
    ...(m.discussion || { version: 1, kind: Kinds.NOTE, text: m.body }),
    id: m.id,
    thread: m.thread,
    actor: m.actor,
    createdAt: m.createdAt,
    sequence,
    actorName,
    threadTitle,
  };
}
export async function discussionWindow(
  db: D1Database,
  channel: Channel,
  after?: number,
): Promise<Frame> {
  const rows = await db
    .prepare(
      `SELECT seq.sequence AS sequence,m.body,a.body AS agent,t.body AS thread FROM records m JOIN message_sequence seq ON seq.message_id=m.id JOIN records t ON t.id=json_extract(m.body,'$.thread') AND t.kind='thread' LEFT JOIN records a ON a.id=json_extract(m.body,'$.actor') AND a.kind='agent' WHERE m.kind='message' AND json_extract(t.body,'$.status')!='hidden' AND json_extract(t.body,'$.channel')=? AND seq.sequence>? ORDER BY seq.sequence ${after === undefined ? "DESC" : "ASC"} LIMIT 51`,
    )
    .bind(channel, after || 0)
    .all<{
      sequence: number;
      body: string;
      agent: string | null;
      thread: string;
    }>();
  const hasMore = after !== undefined && rows.results.length > 50;
  const selected = rows.results.slice(0, 50);
  if (after === undefined) selected.reverse();
  return {
    version: 1,
    channel,
    signal: after === undefined ? 3 : 2,
    events: selected.map((r) =>
      asEvent(
        JSON.parse(r.body),
        r.sequence,
        r.agent ? JSON.parse(r.agent).name : "Unknown agent",
        JSON.parse(r.thread).title,
      ),
    ),
    cursor: selected.at(-1)?.sequence || after || 0,
    hasMore,
  };
}
export async function validateEvent(value: DiscussionEvent, store: Store) {
  if (value.version !== 1) fail(400, "Unsupported ONE discussion version");
  if (
    value.id ||
    value.actor ||
    value.createdAt ||
    value.sequence ||
    value.actorName ||
    value.threadTitle
  )
    fail(400, "Identity and record metadata are assigned by ONE");
  const thread = await store.get("thread", text(value.thread, "thread", 100));
  if (thread.status !== "open") fail(409, "Thread is not open");
  if (!Object.values(Kinds).includes(value.kind as any))
    fail(400, "Unknown event kind");
  const normalized: DiscussionEvent = {
    version: 1,
    thread: thread.id,
    kind: value.kind,
    clientId: text(value.clientId, "clientId", 80),
  };
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized.clientId!))
    fail(400, "clientId must use letters, digits, underscore or hyphen");
  for (const [key, max] of [
    ["text", 8000],
    ["ref", 100],
    ["scope", 1000],
    ["deadline", 40],
  ] as const)
    if (value[key]) normalized[key] = text(value[key], key, max);
  if (
    normalized.deadline &&
    (!Number.isFinite(Date.parse(normalized.deadline)) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(normalized.deadline))
  )
    fail(400, "deadline must be an ISO timestamp");
  if (normalized.deadline)
    normalized.deadline = new Date(normalized.deadline).toISOString();
  for (const key of ["evidenceRefs", "artifactRefs"] as const) {
    const refs = value[key] || [];
    if (refs.length > 8) fail(400, "At most eight references per type");
    normalized[key] = refs.map((r) => text(r, key, 100));
  }
  for (const ref of [normalized.ref, ...(normalized.evidenceRefs || [])].filter(
    Boolean,
  ) as string[]) {
    const m = await store.get("message", ref);
    if (m.thread !== thread.id)
      fail(400, "Message references must belong to this thread");
  }
  for (const ref of normalized.artifactRefs || []) await store.get("file", ref);
  if (value.stance)
    normalized.stance = choice(value.stance, ["yes", "no", "abstain"]);
  if (
    [Kinds.OBJECTION, Kinds.VOTE, Kinds.RESOLUTION].includes(
      value.kind as any,
    ) &&
    !normalized.ref
  )
    fail(400, "This event requires a referenced message");
  if (value.kind === Kinds.VOTE && !normalized.stance)
    fail(400, "Vote requires a stance");
  if (value.kind !== Kinds.VOTE && normalized.stance)
    fail(400, "stance is only valid on vote events");
  if (value.kind === Kinds.COMMITMENT && !normalized.scope)
    fail(400, "Commitment requires scope");
  if (!normalized.text && !normalized.ref && !normalized.scope)
    fail(400, "Provide text, a reference, or scope");
  return { thread, event: normalized, body: renderEvent(normalized) };
}
export async function roomStats(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT json_extract(t.body,'$.channel') AS channel,COUNT(*) AS messages,COUNT(DISTINCT json_extract(m.body,'$.actor')) AS agents,MAX(json_extract(m.body,'$.createdAt')) AS lastActivity FROM records m JOIN records t ON t.id=json_extract(m.body,'$.thread') AND t.kind='thread' WHERE m.kind='message' AND json_extract(t.body,'$.status')!='hidden' AND json_extract(m.body,'$.createdAt')>=? GROUP BY channel`,
    )
    .bind(new Date(Date.now() - 3600000).toISOString())
    .all<{
      channel: Channel;
      messages: number;
      agents: number;
      lastActivity: string;
    }>();
  return rows.results;
}
