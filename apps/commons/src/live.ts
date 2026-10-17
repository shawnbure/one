import { DurableObject } from "cloudflare:workers";
import { encodeFrame } from "../sdk/codec";
import { discussionWindow } from "./discussion";
import type { Channel } from "./types";

/** One hibernating room per channel; only public messages enter binary streams. */
export class LiveChannel extends DurableObject<Env> {
  // Serialize deliveries, not requests. Durable D1 outbox retains every failed delivery.
  private delivery: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS revision(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL); INSERT OR IGNORE INTO revision VALUES(1,0)",
      );
    });
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket upgrade required", { status: 426 });
    if (this.ctx.getWebSockets().length >= 1000)
      return new Response("Channel connection limit reached; retry later", {
        status: 503,
      });
    const url = new URL(request.url);
    const binary = url.searchParams.get("format") === "protobuf";
    const channel = (url.searchParams.get("channel") as Channel) || "commons";
    const initial = binary
      ? await discussionWindow(this.env.DB, channel)
      : undefined;
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ binary, cursor: initial?.cursor || 0 });
    if (initial)
      pair[1].send(
        encodeFrame({ ...initial, signal: 1, revision: this.revision() }),
      );
    else
      pair[1].send(
        JSON.stringify({
          type: "ready",
          revision: this.revision(),
          resync: "/api/v1/snapshot",
        }),
      );
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  private revision() {
    return this.ctx.storage.sql
      .exec<{ value: number }>("SELECT value FROM revision WHERE id=1")
      .one().value;
  }
  notify(channel: Channel, reset = false) {
    const next = this.delivery
      .catch(() => {})
      .then(() => this.deliver(channel, reset));
    this.delivery = next;
    return next;
  }
  private async deliver(channel: Channel, reset: boolean) {
    const revision = this.ctx.storage.sql
      .exec<{ value: number }>(
        "UPDATE revision SET value=value+1 WHERE id=1 RETURNING value",
      )
      .one().value;
    const payload = JSON.stringify({ type: "changed", revision });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const attachment = socket.deserializeAttachment() as {
          binary?: boolean;
          cursor?: number;
        } | null;
        if (!attachment?.binary) socket.send(payload);
      } catch {
        socket.close(1011, "Reconnect to resynchronize");
      }
    }
    const binary = this.ctx
      .getWebSockets()
      .filter((s) => s.deserializeAttachment()?.binary);
    const cursors = new Set(
      binary.map((s) =>
        reset ? undefined : s.deserializeAttachment().cursor || 0,
      ),
    );
    for (const cursor of cursors) {
      const frame = await discussionWindow(this.env.DB, channel, cursor);
      frame.revision = revision;
      const bytes = encodeFrame(frame);
      for (const socket of binary) {
        const current = socket.deserializeAttachment();
        if (!reset && current.cursor !== cursor) continue;
        try {
          socket.send(bytes);
          socket.serializeAttachment({
            ...current,
            cursor: Math.max(current.cursor, frame.cursor),
          });
        } catch {
          socket.close(1011, "Reconnect to resynchronize");
        }
      }
      // A burst larger than the live window is replaced by an authoritative recent window.
      if (frame.hasMore) {
        const latest = await discussionWindow(this.env.DB, channel);
        for (const socket of binary) {
          try {
            socket.send(encodeFrame({ ...latest, revision }));
            socket.serializeAttachment({ binary: true, cursor: latest.cursor });
          } catch {
            socket.close(1011, "Reconnect");
          }
        }
        break;
      }
    }
    return revision;
  }
  webSocketMessage(socket: WebSocket, _message: string | ArrayBuffer) {
    socket.close(
      1008,
      "Read-only stream; publish through the authenticated HTTP API",
    );
  }
  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Reconnect to resynchronize");
  }
}
