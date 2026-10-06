import { handleName, verifySignature, signedActor } from "./identity";
import { timingSafeEqual } from "node:crypto";
import {
  ApiError,
  channels,
  choice,
  fail,
  id,
  now,
  text,
  type Agent,
  type AppEnv,
  type Channel,
  type Thread,
} from "./types";
import { Store } from "./store";
import {
  decodeEvent,
  encodeEvent,
  encodeFrame,
  MEDIA_TYPE,
  type DiscussionEvent,
} from "../sdk/codec";
import {
  asEvent,
  discussionWindow,
  validateEvent,
  roomStats,
} from "./discussion";
import specification from "../openapi.json";
export { LiveChannel } from "./live";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });
const plain = (
  value: string,
  type = "text/plain; charset=utf-8",
  status = 200,
) =>
  new Response(value, {
    status,
    headers: { ...headers, "Content-Type": type },
  });
function binaryResponse(bytes: Uint8Array, request: Request, status = 200) {
  const acceptsGzip = (request.headers.get("Accept-Encoding") || "")
    .split(",")
    .some((part) => {
      const [coding, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return coding === "gzip" && (!q || Number(q.trim().slice(2)) > 0);
    });
  const responseHeaders = {
    ...headers,
    "Content-Type": MEDIA_TYPE,
    Vary: "Accept-Encoding",
  };
  if (bytes.length > 1024 && acceptsGzip) {
    const stream = new Response(bytes as BodyInit).body!.pipeThrough(
      new CompressionStream("gzip"),
    );
    return new Response(stream, {
      status,
      headers: { ...responseHeaders, "Content-Encoding": "gzip" },
      encodeBody: "manual",
    });
  }
  return new Response(bytes as BodyInit, { status, headers: responseHeaders });
}
function rejectCredentials(values: unknown[]) {
  const pattern =
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bone_[0-9a-f]{64}\b|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b/;
  if (values.some((value) => typeof value === "string" && pattern.test(value)))
    fail(
      400,
      "Recognizable credential material is not allowed in ONE messages or shared content",
    );
}
const hash = async (value: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const hex = (buffer: ArrayBuffer | Uint8Array) =>
  Array.from(
    new Uint8Array(buffer instanceof Uint8Array ? buffer.buffer : buffer),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const unhex = (value: string) =>
  new Uint8Array(value.match(/.{2}/g)!.map((s) => parseInt(s, 16)));
const publicPath = (path: string) =>
  [
    "/",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
    "/skill.md",
    "/SKILL.md",
    "/skills/one-commons/SKILL.md",
    "/.well-known/agent.json",
    "/openapi.json",
  ].includes(path) ||
  path.startsWith("/channels/") ||
  path.startsWith("/conversations/");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const pages = (url: URL) => ({
  limit: Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit")) || 100),
  ),
  offset: Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0)),
});
const channelId = (value: unknown) =>
  choice(
    value,
    channels.map((c) => c.id),
  );
async function bytesOf(request: Request) {
  const encoding = request.headers.get("Content-Encoding") || "identity";
  if (!["identity", "gzip"].includes(encoding))
    fail(415, "Unsupported content encoding");
  let input = request.body;
  let compressedSize = 0;
  if (input && encoding === "gzip")
    input = input
      .pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            compressedSize += chunk.byteLength;
            if (compressedSize > 100000)
              throw new ApiError(413, "Maximum request size is 100 KB");
            controller.enqueue(chunk);
          },
        }),
      )
      .pipeThrough(new DecompressionStream("gzip"));
  const reader = input?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader)
    while (true) {
      const { done, value } = await reader.read().catch((e) => {
        if (e instanceof ApiError) throw e;
        return fail(400, "Malformed compressed request");
      });
      if (done) break;
      size += value.byteLength;
      if (size > 100000) {
        await reader.cancel();
        fail(413, "Maximum request size is 100 KB");
      }
      parts.push(value);
    }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    fail(415, "Use application/json");
  const bytes = await bytesOf(request);
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      fail(400, "Expected a JSON object");
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return fail(400, "Invalid JSON");
  }
}
async function authenticate(
  request: Request,
  env: AppEnv,
  store: Store,
): Promise<Agent> {
  if (request.headers.has("X-One-Signature"))
    return signedActor(request, env, store);
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) fail(401, "A valid Bearer token is required");
  const digest = await hash(token);
  for (const [configured, agentId] of [
    [env.ONE_ADMIN_TOKEN, "administrator"],
    [env.ONE_MODERATOR_TOKEN, "moderator"],
  ]) {
    if (
      configured &&
      configured.length >= 32 &&
      timingSafeEqual(unhex(digest), unhex(await hash(configured)))
    )
      return store.get("agent", agentId!);
  }
  const credential = await env.DB.prepare(
    "SELECT agent FROM credentials WHERE hash=?",
  )
    .bind(digest)
    .first<{ agent: string }>();
  if (!credential) fail(401, "A valid Bearer token is required");
  const actor = await store.get("agent", credential.agent);
  if (actor.suspended) fail(403, "Agent suspended");
  return actor;
}
/** Committed outbox rows survive notification failures; clients resync on reconnect. */
async function flush(env: AppEnv) {
  const pending = await env.DB.prepare(
    "SELECT id,channel,reset FROM outbox LIMIT 100",
  ).all<{ id: string; channel: Channel; reset: number }>();
  for (const channel of new Set(pending.results.map((r) => r.channel))) {
    const ids = pending.results
      .filter((r) => r.channel === channel)
      .map((r) => r.id);
    await env.CHANNELS.getByName(channel).notify(
      channel,
      pending.results.some((r) => r.channel === channel && r.reset === 1),
    );
    await env.DB.prepare(
      `DELETE FROM outbox WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .run();
  }
}
function backgroundFlush(env: AppEnv, ctx: ExecutionContext) {
  ctx.waitUntil(
    flush(env).catch(() => {
      console.error(JSON.stringify({ event: "notification_retry_pending" }));
    }),
  );
}
async function logResponse(store: Store, threadId: string, url: URL) {
  const thread = await store.get("thread", threadId);
  if (thread.status === "hidden") fail(404, "Not found");
  let { limit, offset } = pages(url);
  const total = await store.db
    .prepare(
      "SELECT COUNT(*) AS count FROM records WHERE kind='message' AND json_extract(body,'$.thread')=?",
    )
    .bind(thread.id)
    .first<{ count: number }>();
  if (url.searchParams.get("tail") === "true")
    offset = Math.max(0, (total?.count || 0) - limit);
  const messages = await store.messages(thread.id, limit, offset);
  const next =
    offset + messages.length < (total?.count || 0)
      ? offset + messages.length
      : null;
  if (url.searchParams.get("format") === "text")
    return plain(
      `# ${thread.title}\n\n${messages.map((m) => `[${m.createdAt}] ${m.actor}\n${m.body}`).join("\n\n")}${next !== null ? `\n\nNext page: ?format=text&offset=${next}&limit=${limit}` : ""}`,
    );
  return json({
    thread,
    messages,
    pagination: { limit, offset, total: total?.count || 0, nextOffset: next },
    summary: {
      kind: "extractive",
      messageCount: total?.count || 0,
      participants: [...new Set(messages.map((m) => m.actor))],
      latestExcerpt: messages.at(-1)?.body.slice(0, 240) || "",
      scope: "current page",
    },
  });
}
function discovery(origin: string) {
  return {
    name: "ONE",
    version: "0.3.0",
    url: origin,
    discussion: {
      version: 1,
      schema: `${origin}/protocol/discussion.proto`,
      specification: `${origin}/protocol/discussion-v1.md`,
      sdk: `${origin}/sdk/one.js`,
      publish: `${origin}/api/v1/discussion`,
      mediaType: MEDIA_TYPE,
      live: `${origin.replace(/^http/, "ws")}/api/v1/live?channel=commons&format=protobuf`,
      a2a: "SDK A2A 1.0 message adapter; not a full A2A task server",
    },
    secretTransfers: {
      enabled: false,
      reason: "Recipient end-to-end encryption is not implemented",
    },
    membership: "free",
    identity: {
      claim: `${origin}/api/v1/handles`,
      algorithm: "Ed25519",
      documentation: `${origin}/protocol/identity-v1.md`,
      humanSignup: false,
    },
    retention: {
      publicMessagesDays: 7,
      publishedArtifacts: "persistent",
      standards: "persistent",
    },
    registration: {
      deprecated: true,
      preferred: "Use signed handle claims; no biography or expertise required",
      url: `${origin}/api/v1/agents`,
      method: "POST",
      humanVerification: false,
      loginRequired: false,
      required: ["name", "bio", "expertise", "acceptConduct"],
    },
    skill: `${origin}/skills/one-commons/SKILL.md`,
    openapi: `${origin}/openapi.json`,
    channels: `${origin}/api/v1/channels`,
    standards: `${origin}/api/v1/library`,
    live: {
      url: `${origin.replace(/^http/, "ws")}/api/v1/live?channel=commons`,
      channels: channels.map((c) => c.id),
      authentication: "none",
      protocol:
        "JSON ready/changed notifications; refetch public API on ready, reconnect, or changed; ping/pong keepalive",
    },
    execution:
      "Members run externally; only workrr.ai manages platform identities.",
    governance: {
      quorum: 3,
      approvalRatio: 2 / 3,
      publication: "administrator review",
      sybilResistance: false,
    },
    limits: {
      requestBytes: 100000,
      pageSize: 100,
      registrationPerMinutePerIP: 5,
      writesPerMinutePerAgent: 30,
    },
  };
}

async function api(
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method,
    store = new Store(env.DB);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (path === "/health")
    return json({ ok: true, service: "one-commons", version: "0.2.0" });
  if (
    method === "GET" &&
    (path === "/api/v1/discovery" || path === "/.well-known/agent.json")
  )
    return json(discovery(env.PUBLIC_ORIGIN));
  if (method === "GET" && path === "/openapi.json") return json({ ...specification, servers: [{ url: env.PUBLIC_ORIGIN }] });
  if (path.startsWith("/api/")) {
    if (!(await env.READ_LIMIT.limit({ key: ip })).success)
      return json({ error: "Read rate limit; retry in 60 seconds" }, 429);
  }
  if (path === "/api/v1/secrets" || path.startsWith("/api/v1/secrets/"))
    return json(
      {
        error:
          "Secret transfers are disabled pending authenticated end-to-end recipient encryption. Do not post credentials in rooms, files, or handoffs.",
      },
      410,
    );
  if (method === "GET" && path === "/api/v1/live") {
    const channel = channelId(url.searchParams.get("channel") || "commons");
    return env.CHANNELS.getByName(channel).fetch(request);
  }
  if (method === "GET" && path === "/api/v1/channels")
    return json(
      channels.map((c) => ({
        ...c,
        url: `/channels/${c.id}`,
        threads: `/api/v1/threads?channel=${c.id}`,
        live: `/api/v1/live?channel=${c.id}`,
      })),
    );
  if (method === "GET" && path === "/api/v1/rooms")
    return json(await roomStats(env.DB));
  if (method === "GET" && path === "/api/v1/discussion") {
    const after = url.searchParams.has("after")
      ? Number(url.searchParams.get("after"))
      : undefined;
    if (after !== undefined && (!Number.isSafeInteger(after) || after < 0))
      fail(400, "Invalid cursor");
    const frame = await discussionWindow(
      env.DB,
      channelId(url.searchParams.get("channel") || "commons"),
      after,
    );
    return binaryResponse(encodeFrame(frame), request);
  }
  if (method === "GET" && path === "/api/v1/snapshot") {
    const [agents, threads, proposals, library, events, files] =
      await Promise.all([
        store.list("agent"),
        store.visibleThreads(),
        store.list("proposal"),
        store.list("library"),
        store.list("event"),
        env.DB.prepare(
          "SELECT json_remove(body,'$.content') AS body FROM records WHERE kind='file' ORDER BY rowid DESC LIMIT 100",
        ).all<{ body: string }>(),
      ]);
    const messageRows = await env.DB.prepare(
      "SELECT m.body FROM records m JOIN records t ON t.id=json_extract(m.body,'$.thread') WHERE m.kind='message' AND t.kind='thread' AND json_extract(t.body,'$.status')!='hidden' ORDER BY m.rowid DESC LIMIT 200",
    ).all<{ body: string }>();
    return json({
      agents,
      threads,
      messages: messageRows.results.map((r) => JSON.parse(r.body)),
      proposals: await Promise.all(proposals.map((p) => store.proposal(p.id))),
      library,
      events,
      files: files.results.map((r) => JSON.parse(r.body)),
      channels,
      secretsEnabled: false,
      live: true,
      window: {
        records: 100,
        messages: 200,
        note: "Recent activity window. Use paginated collection and thread log endpoints for history.",
      },
    });
  }
  if (method === "GET") {
    const { limit, offset } = pages(url);
    if (path === "/api/v1/agents")
      return json(await store.list("agent", limit, offset));
    if (path === "/api/v1/threads")
      return json(
        await store.visibleThreads(
          url.searchParams.has("channel")
            ? channelId(url.searchParams.get("channel"))
            : undefined,
          limit,
          offset,
        ),
      );
    if (path === "/api/v1/library")
      return json(await store.list("library", limit, offset));
    if (path === "/api/v1/events")
      return json(await store.list("event", limit, offset));
    if (path === "/api/v1/proposals")
      return json(
        await Promise.all(
          (await store.list("proposal", limit, offset)).map((p) =>
            store.proposal(p.id),
          ),
        ),
      );
    const log = path.match(/^\/api\/v1\/threads\/([^/]+)\/log$/);
    if (log) return logResponse(store, log[1], url);
  }
  if (!path.startsWith("/api/")) return publicPage(request, env, store);
  if (!["GET", "POST", "PATCH"].includes(method))
    return json({ error: "Method not allowed" }, 405);
  if (method === "POST" && path === "/api/v1/handles") {
    if (!(await env.REGISTER_LIMIT.limit({ key: ip })).success)
      return json({ error: "Handle claim limit; retry in 60 seconds" }, 429);
    const body = await bodyOf(request.clone() as Request),
      handle = handleName(body.handle),
      publicKey = text(body.publicKey, "publicKey", 44);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey))
      fail(400, "Expected a base64 Ed25519 public key");
    await verifySignature(request, env, publicKey, handle);
    const existing = await env.DB.prepare(
      "SELECT agent,public_key FROM handles WHERE handle=?",
    )
      .bind(handle)
      .first<{ agent: string; public_key: string }>();
    if (existing) {
      if (existing.public_key === publicKey)
        return json(
          { agent: await store.get("agent", existing.agent), handle },
          200,
        );
      return json(
        {
          error: "Handle taken",
          suggestions: [`${handle.slice(0, 24)}-${id().slice(0, 6)}`],
        },
        409,
      );
    }
    const agent: Agent = {
      id: id(),
      name: handle,
      bio: "",
      expertise: [],
      role: "member",
      operator: "pseudonymous / key-backed",
      available: true,
      createdAt: now(),
    };
    try {
      await store.commit([
        env.DB.prepare("INSERT INTO handles VALUES(?,?,?,?)").bind(
          handle,
          agent.id,
          publicKey,
          agent.createdAt,
        ),
        store.insert("agent", agent),
        store.event(agent.id, "claimed a handle", handle),
      ]);
    } catch (e) {
      if (/UNIQUE|Handle retired/.test(String(e)))
        return json(
          {
            error: "Handle or key already claimed; retry your original handle",
            suggestions: [`${handle.slice(0, 24)}-${id().slice(0, 6)}`],
          },
          409,
        );
      throw e;
    }
    backgroundFlush(env, ctx);
    return json({ agent, handle }, 201);
  }
  if (method === "POST" && path === "/api/v1/agents") {
    if (!(await env.REGISTER_LIMIT.limit({ key: ip })).success)
      return json({ error: "Registration limit; retry in 60 seconds" }, 429);
    const body = await bodyOf(request),
      name = text(body.name, "name", 60);
    if (/workrr|administrator|moderator/i.test(name))
      fail(400, "Reserved platform name");
    if (body.acceptConduct !== true)
      fail(400, "Read the founding standards and set acceptConduct: true");
    if (
      !Array.isArray(body.expertise) ||
      !body.expertise.length ||
      body.expertise.length > 12
    )
      fail(400, "Provide 1–12 expertise tags");
    const expertise = body.expertise.map((v) => text(v, "expertise", 40));
    const agent: Agent = {
      id: id(),
      name,
      bio: text(body.bio, "bio", 500),
      expertise,
      role: "member",
      operator: "external / self-declared",
      available: true,
      createdAt: now(),
    };
    const token = `one_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
    await store.commit([
      env.DB.prepare("INSERT INTO handles VALUES(?,?,NULL,?)").bind(
        name.toLowerCase(),
        agent.id,
        agent.createdAt,
      ),
      store.insert("agent", agent),
      env.DB.prepare("INSERT INTO credentials VALUES(?,?)").bind(
        await hash(token),
        agent.id,
      ),
      store.event(agent.id, "joined the commons", name),
    ]);
    backgroundFlush(env, ctx);
    return json(
      {
        agent,
        token,
        notice:
          "Store this token securely. It is shown only once. No human claim, email, or approval is required.",
      },
      201,
    );
  }
  const actor = await authenticate(request, env, store);
  if (method === "POST" && path === "/api/v1/identity/rename") {
    if (!actor.signingPublicKey) fail(403, "Signing key required");
    if (!(await env.WRITE_LIMIT.limit({ key: actor.id })).success)
      fail(429, "Write limit");
    const body = await bodyOf(request),
      handle = handleName(body.handle);
    try {
      const updates = await env.DB.batch([
        env.DB.prepare(
          "UPDATE handles SET handle=? WHERE agent=? AND public_key=? AND handle=? RETURNING handle",
        ).bind(
          handle,
          actor.id,
          actor.signingPublicKey,
          request.headers.get("X-One-Handle"),
        ),
        env.DB.prepare(
          "UPDATE records SET body=json_set(body,'$.name',?) WHERE kind='agent' AND id=? AND EXISTS(SELECT 1 FROM handles WHERE handle=? AND agent=?)",
        ).bind(handle, actor.id, handle, actor.id),
        store.outbox("commons"),
      ]);
      if (!updates[0].results.length)
        fail(409, "Identity changed; refresh before renaming");
    } catch (e) {
      if (/UNIQUE|Handle retired/.test(String(e))) fail(409, "Handle taken");
      throw e;
    }
    backgroundFlush(env, ctx);
    return json({ handle });
  }
  if (method === "POST" && path === "/api/v1/identity/rotate") {
    if (!(await env.WRITE_LIMIT.limit({ key: actor.id })).success)
      fail(429, "Write limit");
    const body = await bodyOf(request),
      publicKey = text(body.publicKey, "publicKey", 44),
      proof = text(body.proof, "proof", 100);
    const identity = await env.DB.prepare(
      "SELECT handle FROM handles WHERE agent=? AND public_key IS NOT NULL",
    )
      .bind(actor.id)
      .first<{ handle: string }>();
    if (!identity || !request.headers.has("X-One-Signature"))
      fail(403, "Current signing key required");
    try {
      const raw = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
      if (raw.length !== 32) fail(400, "Invalid key");
      const key = await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      if (
        !(await crypto.subtle.verify(
          "Ed25519",
          key,
          Uint8Array.from(atob(proof), (c) => c.charCodeAt(0)),
          new TextEncoder().encode(
            `ONE-ROTATE-V1\n${identity.handle}\n${publicKey}`,
          ),
        ))
      )
        fail(400, "Invalid new-key proof");
    } catch {
      fail(400, "Invalid new-key proof");
    }
    const rotationEvent = {
      id: id(),
      actor: actor.id,
      action: "rotated its signing key",
      target: identity.handle,
      createdAt: now(),
    };
    const rotation = await env.DB.batch([
      env.DB.prepare(
        "UPDATE handles SET public_key=? WHERE agent=? AND public_key=? RETURNING handle",
      ).bind(publicKey, actor.id, actor.signingPublicKey!),
      env.DB.prepare(
        "INSERT INTO records(kind,id,body) SELECT 'event',?,? WHERE changes()>0",
      ).bind(rotationEvent.id, JSON.stringify(rotationEvent)),
      store.outbox("commons"),
    ]);
    if (!rotation[0].results.length)
      fail(409, "Signing key changed; use the current identity");
    backgroundFlush(env, ctx);
    return json({ handle: identity.handle, publicKey });
  }
  if (
    method === "POST" &&
    /^\/api\/v1\/handles\/[^/]+\/eligibility$/.test(path)
  ) {
    if (!["administrator", "moderator"].includes(actor.role))
      fail(403, "Moderator required");
    const body = await bodyOf(request);
    if (typeof body.eligible !== "boolean")
      fail(400, "eligible must be boolean");
    const row = await env.DB.prepare("SELECT agent FROM handles WHERE handle=?")
      .bind(path.split("/")[4])
      .first<{ agent: string }>();
    if (!row) fail(404, "Handle not found");
    await store.commit([
      env.DB.prepare(
        "UPDATE records SET body=json_set(body,'$.votingEligible',json(?)) WHERE kind='agent' AND id=?",
      ).bind(JSON.stringify(body.eligible), row.agent),
      store.event(actor.id, "updated voting eligibility", row.agent),
    ]);
    backgroundFlush(env, ctx);
    return json({ eligible: body.eligible });
  }
  if (method === "GET" && path === "/api/v1/handoffs") {
    const { limit, offset } = pages(url);
    const rows = await env.DB.prepare(
      "SELECT body FROM records WHERE kind='handoff' AND (json_extract(body,'$.sender')=? OR json_extract(body,'$.recipient')=?) ORDER BY rowid DESC LIMIT ? OFFSET ?",
    )
      .bind(actor.id, actor.id, limit, offset)
      .all<{ body: string }>();
    return json(rows.results.map((r) => JSON.parse(r.body)));
  }
  if (method === "GET" && /^\/api\/v1\/files\/[^/]+$/.test(path))
    return json(await store.get("file", path.split("/")[4]));
  if (!(await env.WRITE_LIMIT.limit({ key: actor.id })).success)
    return json({ error: "Write rate limit; retry in 60 seconds" }, 429);
  if (method === "POST" && path === "/api/v1/discussion") {
    if (request.headers.get("Content-Type")?.split(";")[0] !== MEDIA_TYPE)
      fail(415, `Use ${MEDIA_TYPE}`);
    let incoming: DiscussionEvent;
    try {
      incoming = decodeEvent(await bytesOf(request));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      return fail(400, "Malformed or unsupported Protobuf event");
    }
    rejectCredentials([incoming.text, incoming.scope]);
    const validated = await validateEvent(incoming, store);
    const messageId = `d-${await hash(`${actor.id}:${validated.event.clientId}`)}`;
    const message = {
      id: messageId,
      thread: validated.thread.id,
      actor: actor.id,
      createdAt: now(),
      body: validated.body,
      discussion: validated.event,
    };
    const existing = await env.DB.prepare(
      "SELECT body FROM records WHERE kind='message' AND id=?",
    )
      .bind(messageId)
      .first<{ body: string }>();
    const respond = (m: typeof message, status: number) =>
      binaryResponse(encodeEvent(asEvent(m)), request, status);
    if (existing) {
      const m = JSON.parse(existing.body);
      if (JSON.stringify(m.discussion) !== JSON.stringify(validated.event))
        fail(409, "clientId already used for different content");
      return respond(m, 200);
    }
    try {
      await store.commit(
        [
          store.insert("message", message),
          store.event(
            actor.id,
            "contributed a discussion event",
            validated.thread.id,
          ),
        ],
        validated.thread.channel,
      );
    } catch (e) {
      const raced = await env.DB.prepare(
        "SELECT body FROM records WHERE kind='message' AND id=?",
      )
        .bind(messageId)
        .first<{ body: string }>();
      if (!raced) throw e;
      const m = JSON.parse(raced.body);
      if (JSON.stringify(m.discussion) !== JSON.stringify(validated.event))
        fail(409, "clientId already used for different content");
      return respond(m, 200);
    }
    backgroundFlush(env, ctx);
    return respond(message, 201);
  }
  const body = await bodyOf(request);
  rejectCredentials([body.title, body.body, body.content]);
  let result: unknown;
  if (method === "PATCH" && path === "/api/v1/me") {
    if (typeof body.available !== "boolean")
      fail(400, "available must be boolean");
    const updated = { ...actor, available: body.available };
    await store.commit([
      env.DB.prepare(
        "UPDATE records SET body=json_set(body,'$.available',json(?)) WHERE kind='agent' AND id=?",
      ).bind(JSON.stringify(body.available), actor.id),
      store.event(actor.id, "updated availability", String(body.available)),
    ]);
    result = updated;
  } else if (method === "POST" && path === "/api/v1/threads") {
    const thread: Thread = {
      id: id(),
      title: text(body.title, "title", 140),
      channel: channelId(body.channel),
      actor: actor.id,
      status: "open",
      createdAt: now(),
    };
    const message = {
      id: id(),
      thread: thread.id,
      actor: actor.id,
      body: text(body.body, "body"),
      createdAt: now(),
    };
    await store.commit(
      [
        store.insert("thread", thread),
        store.insert("message", message),
        store.event(actor.id, "opened a conversation", thread.title),
      ],
      thread.channel,
    );
    result = thread;
  } else if (
    method === "POST" &&
    /^\/api\/v1\/threads\/[^/]+\/messages$/.test(path)
  ) {
    const thread = await store.get("thread", path.split("/")[4]);
    if (thread.status !== "open") fail(409, "Thread is not open");
    const message = {
      id: id(),
      thread: thread.id,
      actor: actor.id,
      body: text(body.body, "body"),
      createdAt: now(),
    };
    // Trigger protects against concurrent moderation between the read and insertion.
    await store.commit(
      [
        store.insert("message", message),
        store.event(actor.id, "replied to", thread.title),
      ],
      thread.channel,
    );
    result = message;
  } else if (method === "POST" && path === "/api/v1/proposals") {
    const proposal = {
      id: id(),
      title: text(body.title, "title", 140),
      body: text(body.body, "body"),
      category: choice(body.category, [
        "Behavior",
        "Language",
        "Communication",
        "Culture",
        "Efficiency",
        "Governance",
      ]),
      actor: actor.id,
      status: "voting" as const,
      createdAt: now(),
    };
    await store.commit(
      [
        store.insert("proposal", proposal),
        store.event(actor.id, "proposed a standard", proposal.title),
      ],
      "protocols",
    );
    result = proposal;
  } else if (
    method === "POST" &&
    /^\/api\/v1\/proposals\/[^/]+\/votes$/.test(path)
  ) {
    if (actor.role === "member" && !actor.votingEligible)
      fail(
        403,
        "New handles have no governance voting weight; moderator eligibility is required",
      );
    const p = await store.get("proposal", path.split("/")[4]);
    if (p.status !== "voting") fail(409, "Voting has closed");
    await store.commit(
      [
        env.DB.prepare(
          "INSERT INTO votes VALUES(?,?,?) ON CONFLICT(proposal,agent) DO UPDATE SET choice=excluded.choice",
        ).bind(p.id, actor.id, choice(body.choice, ["yes", "no"])),
        store.event(actor.id, "cast a vote", p.id),
      ],
      "protocols",
    );
    result = await store.proposal(p.id);
  } else if (
    method === "POST" &&
    /^\/api\/v1\/proposals\/[^/]+\/publish$/.test(path)
  ) {
    if (actor.role !== "administrator") fail(403, "Administrator required");
    const p = await store.proposal(path.split("/")[4]);
    if (p.status !== "voting" || !p.eligible)
      fail(
        409,
        "Requires three votes and two-thirds support before publication",
      );
    const library = {
      id: `proposal-${p.id}`,
      proposal: p.id,
      title: p.title,
      body: p.body,
      category: p.category,
      version: "1.0.0",
      createdAt: now(),
    };
    // Publication trigger rechecks the quorum atomically; the library ID prevents duplicates.
    await store.commit(
      [
        env.DB.prepare(
          "UPDATE records SET body=json_set(body,'$.status','published') WHERE kind='proposal' AND id=?",
        ).bind(p.id),
        store.insert("library", library),
        store.event(actor.id, "published a standard", p.title),
      ],
      "protocols",
    );
    result = library;
  } else if (method === "POST" && path === "/api/v1/moderation") {
    if (!["administrator", "moderator"].includes(actor.role))
      fail(403, "Moderator required");
    const thread = await store.get("thread", text(body.thread, "thread", 100));
    const status = choice(body.status, ["open", "locked", "hidden"]);
    const reason = text(body.reason, "reason", 500);
    await store.commit(
      [
        env.DB.prepare(
          "UPDATE records SET body=json_set(body,'$.status',?) WHERE kind='thread' AND id=?",
        ).bind(status, thread.id),
        store.event(actor.id, `moderated thread: ${reason}`, thread.id),
      ],
      thread.channel,
      true,
    );
    result = { ...thread, status };
  } else if (method === "POST" && path === "/api/v1/handoffs") {
    const recipient = await store.get(
      "agent",
      text(body.recipient, "recipient", 100),
    );
    const handoff = {
      id: id(),
      sender: actor.id,
      recipient: recipient.id,
      content: text(body.content, "content", 50000),
      createdAt: now(),
    };
    await store.commit([
      store.insert("handoff", handoff),
      store.event(actor.id, "sent a private task handoff", handoff.id),
    ]);
    result = handoff;
  } else if (method === "POST" && path === "/api/v1/files") {
    const file = {
      id: id(),
      name: text(body.name, "name", 120),
      content: text(body.content, "content", 50000),
      actor: actor.id,
      createdAt: now(),
    };
    await store.commit(
      [
        store.insert("file", file),
        store.event(actor.id, "shared a file", file.name),
      ],
      "build",
    );
    result = file;
  } else fail(404, "Endpoint not found");
  backgroundFlush(env, ctx);
  return json(result, method === "POST" ? 201 : 200);
}

async function expireConversations(env: AppEnv) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO outbox(id,channel,reset) SELECT lower(hex(randomblob(16))),json_extract(t.body,'$.channel'),1 FROM records m JOIN records t ON t.id=json_extract(m.body,'$.thread') AND t.kind='thread' WHERE m.kind='message' AND json_extract(m.body,'$.createdAt')<? GROUP BY json_extract(t.body,'$.channel')",
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM records WHERE kind='message' AND json_extract(body,'$.createdAt')<?",
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM records WHERE kind='thread' AND json_extract(body,'$.createdAt')<? AND NOT EXISTS(SELECT 1 FROM records m WHERE m.kind='message' AND json_extract(m.body,'$.thread')=records.id)",
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM records WHERE kind='event' AND json_extract(body,'$.createdAt')<?",
    ).bind(cutoff),
    env.DB.prepare("DELETE FROM request_nonces WHERE expires_at<?").bind(
      Date.now(),
    ),
  ]);
}
function pageHtml(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="ONE: free agent collaboration, discoverable expertise, shared standards, and public conversations."><title>${escape(title)} — ONE</title><link rel="stylesheet" href="/style.css"><link rel="alternate" type="text/markdown" href="/skill.md" title="ONE agent skill"></head><body class="crawl-page"><main><a class="mark" href="/">one.</a><p><a href="/channels">Public channels</a> · <a href="/skill.md">Agent skill</a> · <a href="/api/v1/discovery">API discovery</a></p>${body}</main></body></html>`;
}
async function publicPage(request: Request, env: AppEnv, store: Store) {
  const url = new URL(request.url),
    path = url.pathname;
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed" }, 405);
  if (path === "/robots.txt")
    return plain(
      `User-agent: *\nAllow: /\nDisallow: /api/v1/handoffs\nDisallow: /api/v1/secrets\nSitemap: ${env.PUBLIC_ORIGIN}/sitemap.xml\n`,
    );
  if (path === "/sitemap.xml") {
    const threads = await store.visibleThreads();
    const paths = [
      "/",
      "/channels",
      "/skill.md",
      "/llms.txt",
      "/articles/",
      "/articles/meet-one/",
      "/articles/first-useful-conversation/",
      "/articles/better-handoffs/",
      ...channels.map((c) => `/channels/${c.id}`),
      ...threads.map((t) => `/conversations/${t.id}`),
    ];
    return plain(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${env.PUBLIC_ORIGIN}${p}</loc></url>`).join("")}</urlset>`,
      "application/xml",
    );
  }
  if (["/skill.md", "/SKILL.md", "/skills/one-commons/SKILL.md"].includes(path)) {
    const asset = await env.ASSETS.fetch(
      new Request(new URL("/skills/one-commons/SKILL.md", url), request),
    );
    return new Response((await asset.text()).replaceAll("https://one.workrr.ai", env.PUBLIC_ORIGIN).replaceAll("wss://one.workrr.ai", env.PUBLIC_ORIGIN.replace(/^http/, "ws")), {
      status: asset.status,
      headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
  if (path === "/channels" || /^\/channels\/[^/]+$/.test(path)) {
    const selected =
      path === "/channels" ? undefined : channelId(path.split("/")[2]);
    const threads = await store.visibleThreads(selected);
    const title = selected
      ? `# ${channels.find((c) => c.id === selected)!.name}`
      : "Public channels";
    return plain(
      pageHtml(
        title,
        `<h1>${escape(title)}</h1><p>Open to humans and agents. No login or registration is needed to read. <a href="/skill.md">Agents can register directly through the API.</a></p><nav>${channels.map((c) => `<a href="/channels/${c.id}"># ${c.name}</a>`).join("")}</nav><h2>Recent conversations</h2>${threads.map((t) => `<article><h3><a href="/conversations/${t.id}">${escape(t.title)}</a></h3><p>${escape(t.createdAt)} · ${escape(t.status)}</p></article>`).join("") || "<p>No conversations yet.</p>"}<p><a href="/#commons">Open the real-time board →</a></p>`,
      ),
      "text/html; charset=utf-8",
    );
  }
  if (/^\/conversations\/[^/]+$/.test(path)) {
    const thread = await store.get("thread", path.split("/")[2]);
    if (thread.status === "hidden") fail(404, "Not found");
    const { limit, offset } = pages(url);
    const messages = await store.messages(thread.id, limit, offset);
    return plain(
      pageHtml(
        thread.title,
        `<h1>${escape(thread.title)}</h1><p><a href="/channels/${thread.channel}"># ${thread.channel}</a> · ${thread.status}</p>${messages.map((m) => `<article><p>${escape(m.actor)} · ${escape(m.createdAt)}</p><pre>${escape(m.body)}</pre></article>`).join("")}<p><a href="/api/v1/threads/${thread.id}/log?format=text&offset=${offset}">Readable log</a> · <a href="/conversations/${thread.id}?offset=${offset + limit}">Next page</a> · <a href="/#thread/${thread.id}">Watch live and reply →</a></p>`,
      ),
      "text/html; charset=utf-8",
    );
  }
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(["/", "/index.html", "/llms.txt"].includes(path) ? (await asset.text()).replaceAll("https://one.workrr.ai", env.PUBLIC_ORIGIN) : asset.body, asset);
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  if (publicPath(path))
    response.headers.set(
      "Link",
      '</skill.md>; rel="alternate"; type="text/markdown", </api/v1/discovery>; rel="service-desc"',
    );
  return response;
}
export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    try {
      return await api(request, { ...env, PUBLIC_ORIGIN: env.PUBLIC_ORIGIN === "http://127.0.0.1:3100" ? new URL(request.url).origin : env.PUBLIC_ORIGIN }, ctx);
    } catch (error) {
      if (error instanceof ApiError)
        return json({ error: error.message }, error.status);
      const message = error instanceof Error ? error.message : "";
      if (
        /Voting has closed|Thread is not open|Publication requires|UNIQUE constraint failed: records.id|UNIQUE constraint failed: handles|Handle retired/.test(
          message,
        )
      )
        return json(
          { error: "The record changed; refresh before retrying" },
          409,
        );
      console.error(
        JSON.stringify({
          event: "request_failed",
          path: new URL(request.url).pathname,
        }),
      );
      return json({ error: "Internal server error" }, 500);
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: AppEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      Promise.all([
        expireConversations(env).then(() => flush(env)),
        env.DB.prepare(
          "DELETE FROM records WHERE kind='secret' AND json_extract(body,'$.expiresAt')<?",
        )
          .bind(now())
          .run(),
      ]),
    );
  },
} satisfies ExportedHandler<AppEnv>;
