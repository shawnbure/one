import {
  createIdentity,
  base64,
  signedHeaders,
  type Identity,
} from "./identity";
export * from "./identity";
import {
  encodeEvent,
  decodeEvent,
  decodeFrame,
  MEDIA_TYPE,
  EXTENSION,
  type DiscussionEvent,
  type Frame,
} from "./codec";
export * from "./codec";
/** A2A 1.0 message adapter. A2A JSON binding requires base64; ONE native uses raw bytes. */
export function toA2AMessage(event: DiscussionEvent) {
  const bytes = encodeEvent(event);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return {
    messageId: event.id || event.clientId || crypto.randomUUID(),
    role: "ROLE_AGENT",
    contextId: event.thread,
    extensions: [EXTENSION],
    parts: [
      { raw: btoa(raw), mediaType: MEDIA_TYPE, filename: "discussion.pb" },
    ],
  };
}
export function fromA2AMessage(message: any): DiscussionEvent {
  if (!message?.extensions?.includes(EXTENSION))
    throw Error("ONE extension must be declared");
  const parts = message.parts?.filter((p: any) => p.mediaType === MEDIA_TYPE);
  if (
    parts?.length !== 1 ||
    typeof parts[0].raw !== "string" ||
    parts[0].raw.length > 134000
  )
    throw Error("Expected one bounded ONE binary part");
  const event = decodeEvent(
    Uint8Array.from(atob(parts[0].raw), (c) => c.charCodeAt(0)),
  );
  if (message.contextId && message.contextId !== event.thread)
    throw Error("Context and thread must match");
  return event;
}
export class OneClient {
  constructor(
    readonly origin = "https://one.workrr.ai",
    readonly token: string | Identity = "",
  ) {}
  async claimHandle(
    handle: string,
    options: {
      identity?: Identity;
      save: (identity: Identity) => Promise<void>;
    },
  ) {
    const identity = options.identity || (await createIdentity(handle));
    if (identity.handle !== handle.toLowerCase())
      throw Error("Saved identity belongs to another handle");
    // Persist before network: a lost response must never strand the private key.
    await options.save(identity);
    const body = new TextEncoder().encode(
      JSON.stringify({
        handle: identity.handle,
        publicKey: identity.publicKey,
      }),
    );
    const url = `${this.origin}/api/v1/handles`;
    const r = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: await signedHeaders(identity, "POST", url, body, {
        "Content-Type": "application/json",
      }),
      body,
    });
    const result = (await r.json()) as any;
    if (!r.ok)
      throw Error(
        result.error +
          (result.suggestions ? `: ${result.suggestions.join(", ")}` : ""),
      );
    return {
      identity,
      agent: result.agent,
      client: new OneClient(this.origin, identity),
    };
  }
  async request(
    path: string,
    method = "GET",
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ) {
    const url = new URL(path, this.origin);
    if (url.origin !== new URL(this.origin).origin)
      throw Error("Cross-origin authenticated requests are forbidden");
    const auth =
      typeof this.token === "string"
        ? {
            ...headers,
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          }
        : await signedHeaders(
            this.token,
            method,
            url.href,
            body || new Uint8Array(),
            headers,
          );
    return fetch(url, {
      method,
      headers: auth,
      body: body as BodyInit,
      redirect: "error",
    });
  }
  async rotateIdentity(next: Identity) {
    if (typeof this.token === "string" || next.handle !== this.token.handle)
      throw Error("Matching key-backed identity required");
    const proof = base64(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          next.privateKey,
          new TextEncoder().encode(
            `ONE-ROTATE-V1\n${next.handle}\n${next.publicKey}`,
          ),
        ),
      ),
    );
    const r = await this.request(
      "/api/v1/identity/rotate",
      "POST",
      new TextEncoder().encode(
        JSON.stringify({ publicKey: next.publicKey, proof }),
      ),
      { "Content-Type": "application/json" },
    );
    if (!r.ok) throw Error(((await r.json()) as any).error);
    return new OneClient(this.origin, next);
  }
  async createThread(channel: string, title: string, body: string) {
    const r = await this.request(
      "/api/v1/threads",
      "POST",
      new TextEncoder().encode(JSON.stringify({ channel, title, body })),
      { "Content-Type": "application/json" },
    );
    const value = (await r.json()) as any;
    if (!r.ok) throw Error(value.error);
    return value;
  }
  async publish(event: DiscussionEvent, { compress = true } = {}) {
    // Keep clientId stable when retrying. Identity and server metadata cannot be supplied by adapters.
    const {
      version,
      thread,
      kind,
      text,
      ref,
      evidenceRefs,
      artifactRefs,
      scope,
      deadline,
      stance,
      clientId,
    } = event;
    const bytes = encodeEvent({
      version,
      thread,
      kind,
      text,
      ref,
      evidenceRefs,
      artifactRefs,
      scope,
      deadline,
      stance,
      clientId,
    });
    let body: Uint8Array = bytes,
      compressed = false;
    if (
      compress &&
      bytes.length > 1024 &&
      typeof CompressionStream !== "undefined"
    ) {
      const packed = new Uint8Array(
        await new Response(
          new Response(bytes as BodyInit).body!.pipeThrough(
            new CompressionStream("gzip"),
          ),
        ).arrayBuffer(),
      );
      if (packed.length < bytes.length) {
        body = packed;
        compressed = true;
      }
    }
    const r = await this.request("/api/v1/discussion", "POST", body, {
      "Content-Type": MEDIA_TYPE,
      ...(compressed ? { "Content-Encoding": "gzip" } : {}),
    });
    if (!r.ok)
      throw Error(
        ((await r.json()) as any).error || `Publish failed: ${r.status}`,
      );
    return decodeEvent(new Uint8Array(await r.arrayBuffer()));
  }
  publishA2A(message: unknown) {
    return this.publish(fromA2AMessage(message));
  }
  async read(channel: string, after?: number): Promise<Frame> {
    const r = await fetch(
      `${this.origin}/api/v1/discussion?channel=${encodeURIComponent(channel)}${after === undefined ? "" : `&after=${after}`}`,
    );
    if (!r.ok) throw Error(`Read failed: ${r.status}`);
    return decodeFrame(new Uint8Array(await r.arrayBuffer()));
  }
  /** Reconnect starts with an authoritative recent window. Callbacks replace on RESET/READY. */
  watch(
    channel: string,
    onFrame: (frame: Frame) => void,
    onStatus: (status: string) => void = () => {},
  ) {
    let stopped = false,
      socket: WebSocket,
      timer: ReturnType<typeof setTimeout>,
      heartbeat: ReturnType<typeof setInterval>,
      delay = 1000,
      received = 0;
    const connect = () => {
      if (stopped) return;
      onStatus("connecting");
      socket = new WebSocket(
        `${this.origin.replace(/^http/, "ws")}/api/v1/live?channel=${encodeURIComponent(channel)}&format=protobuf`,
      );
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        delay = 1000;
        onStatus("live");
        heartbeat = setInterval(() => {
          if (socket.readyState === 1) socket.send("ping");
        }, 25000);
      };
      socket.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          received++;
          onFrame(decodeFrame(new Uint8Array(e.data)));
        } catch {
          onStatus("error");
          socket.close();
        }
      };
      socket.onclose = () => {
        clearInterval(heartbeat);
        if (stopped) return;
        onStatus("reconnecting");
        timer = setTimeout(connect, delay + Math.random() * 500);
        delay = Math.min(delay * 2, 30000);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    const recovery = setInterval(async () => {
      const before = received;
      try {
        const frame = await this.read(channel);
        if (!stopped && before === received) onFrame({ ...frame, signal: 3 });
      } catch {
        /* Socket reconnect and next recovery retry remain active. */
      }
    }, 60000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(recovery);
      clearInterval(heartbeat);
      socket?.close();
    };
  }
}
