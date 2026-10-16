import { fail, id, now, type Tables, type Channel } from "./types";

/** D1 batches are atomic. Mutations that depend on current state use SQL predicates. */
export class Store {
  constructor(readonly db: D1Database) {}
  insert<K extends keyof Tables>(kind: K, item: Tables[K]) {
    return this.db
      .prepare("INSERT INTO records(kind,id,body) VALUES(?,?,?)")
      .bind(kind, item.id, JSON.stringify(item));
  }
  async get<K extends keyof Tables>(
    kind: K,
    recordId: string,
  ): Promise<Tables[K]> {
    const row = await this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .bind(kind, recordId)
      .first<{ body: string }>();
    return row ? JSON.parse(row.body) : fail(404, "Not found");
  }
  async list<K extends keyof Tables>(
    kind: K,
    limit = 100,
    offset = 0,
  ): Promise<Tables[K][]> {
    const r = await this.db
      .prepare(
        "SELECT body FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ? OFFSET ?",
      )
      .bind(kind, limit, offset)
      .all<{ body: string }>();
    return r.results.map((r) => JSON.parse(r.body));
  }
  event(actor: string, action: string, target: string) {
    return this.insert("event", {
      id: id(),
      actor,
      action,
      target,
      createdAt: now(),
    });
  }
  outbox(channel: Channel, reset = false) {
    return this.db
      .prepare("INSERT INTO outbox(id,channel,reset) VALUES(?,?,?)")
      .bind(id(), channel, reset ? 1 : 0);
  }
  async commit(
    statements: D1PreparedStatement[],
    channel: Channel = "commons",
    reset = false,
  ) {
    await this.db.batch([...statements, this.outbox(channel, reset)]);
  }
  async visibleThreads(channel?: Channel, limit = 100, offset = 0) {
    const rows = await this.db
      .prepare(
        "SELECT body FROM records WHERE kind='thread' AND json_extract(body,'$.status')!='hidden' AND (? IS NULL OR json_extract(body,'$.channel')=?) ORDER BY rowid DESC LIMIT ? OFFSET ?",
      )
      .bind(channel || null, channel || null, limit, offset)
      .all<{ body: string }>();
    return rows.results.map((r) => JSON.parse(r.body) as Tables["thread"]);
  }
  async messages(thread: string, limit = 100, offset = 0) {
    const rows = await this.db
      .prepare(
        "SELECT body FROM records WHERE kind='message' AND json_extract(body,'$.thread')=? ORDER BY rowid ASC LIMIT ? OFFSET ?",
      )
      .bind(thread, limit, offset)
      .all<{ body: string }>();
    return rows.results.map((r) => JSON.parse(r.body) as Tables["message"]);
  }
  async proposal(recordId: string) {
    const p = await this.get("proposal", recordId);
    const r = await this.db
      .prepare(
        "SELECT choice,COUNT(*) AS count FROM votes WHERE proposal=? GROUP BY choice",
      )
      .bind(recordId)
      .all<{ choice: string; count: number }>();
    const yes = r.results.find((r) => r.choice === "yes")?.count || 0,
      no = r.results.find((r) => r.choice === "no")?.count || 0;
    return {
      ...p,
      yes,
      no,
      eligible: yes + no >= 3 && yes * 3 >= (yes + no) * 2,
    };
  }
}
