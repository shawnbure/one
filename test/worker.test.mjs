import { gzipSync } from "node:zlib";
import {
  createIdentity,
  exportIdentity,
  signedHeaders,
  OneClient,
  Kinds,
  encodeEvent,
  decodeEvent,
  decodeFrame,
  MEDIA_TYPE,
  toA2AMessage,
} from "../public/sdk/one.js";
import { claimHandle as claimNodeHandle } from "../public/sdk/one-node.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";

async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
function connect(url, binary = false) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    if (binary) socket.binaryType = "arraybuffer";
    const events = [];
    const pending = [];
    socket.addEventListener("message", (e) => {
      const value =
        e.data === "pong"
          ? "pong"
          : binary
            ? decodeFrame(new Uint8Array(e.data))
            : JSON.parse(e.data);
      events.push(value);
      for (const p of [...pending])
        if (p.predicate(value)) {
          clearTimeout(p.timer);
          pending.splice(pending.indexOf(p), 1);
          p.resolve(value);
        }
    });
    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener(
      "open",
      () =>
        resolve({
          socket,
          events,
          next(predicate) {
            const existing = events.find(predicate);
            if (existing) return Promise.resolve(existing);
            return new Promise((resolve, reject) => {
              const item = {
                predicate,
                resolve,
                timer: setTimeout(
                  () => reject(Error("WebSocket event timeout")),
                  5000,
                ),
              };
              pending.push(item);
            });
          },
        }),
      { once: true },
    );
  });
}

test(
  "Cloudflare runtime: anonymous discovery, durable collaboration and channel fan-out",
  { timeout: 90000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "one-worker-"));
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    config.name = "one-commons-test";
    config.main = resolve("src/worker.ts");
    config.assets.directory = resolve("public");
    config.d1_databases[0].migrations_dir = resolve("migrations");
    delete config.routes;
    const configPath = join(dir, "wrangler.json");
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(
      join(dir, ".dev.vars"),
      `ONE_ADMIN_TOKEN=${"a".repeat(32)}\nONE_MODERATOR_TOKEN=${"m".repeat(32)}\nONE_SECRET_KEY=${"11".repeat(32)}\n`,
      { mode: 0o600 },
    );
    const cli = resolve("node_modules/wrangler/bin/wrangler.js");
    const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    execFileSync(
      process.execPath,
      [
        cli,
        "d1",
        "migrations",
        "apply",
        "one-commons",
        "--local",
        "--config",
        configPath,
        "--persist-to",
        join(dir, "state"),
      ],
      { env, stdio: "pipe" },
    );
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        cli,
        "dev",
        "--test-scheduled",
        "--config",
        configPath,
        "--port",
        String(port),
        "--persist-to",
        join(dir, "state"),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    t.after(async () => {
      child.kill("SIGTERM");
      await new Promise((r) => {
        if (child.exitCode !== null) return r();
        child.once("exit", r);
        setTimeout(() => {
          child.kill("SIGKILL");
          r();
        }, 3000).unref();
      });
      rmSync(dir, { force: true, recursive: true });
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Worker startup timeout: " + output)),
        25000,
      );
      const read = (chunk) => {
        output += chunk;
        if (output.includes("Ready on")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error(`Worker exited ${code}: ${output}`));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const request = async (path, body, token, method) => {
      const r = await fetch(base + path, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    };
    const discovery = await request("/api/v1/discovery");
    assert.equal(discovery.body.registration.humanVerification, false);
    assert.equal(discovery.body.registration.loginRequired, false);
    const skill = await (await fetch(base + "/skill.md")).text();
    assert.ok(skill.includes(base + "/api/v1/discovery"));
    assert.ok(skill.includes(`origin: '${base}'`));
    assert.ok(!skill.includes("https://one.workrr.ai"));
    assert.equal((await request("/openapi.json")).body.servers[0].url, base);
    assert.ok((await (await fetch(base + "/llms.txt")).text()).includes(base));
    for (const p of [
      "/",
      "/channels",
      "/channels/help",
      "/skill.md",
      "/SKILL.md",
      "/skills/one-commons/SKILL.md",
      "/llms.txt",
      "/robots.txt",
      "/sitemap.xml",
      "/.well-known/agent.json",
      "/openapi.json",
    ])
      assert.equal((await fetch(base + p)).status, 200, p);
    assert.equal((await request("/api/v1/channels")).body.length, 4);
    const commons = await connect(
      base.replace("http:", "ws:") + "/api/v1/live?channel=commons",
    );
    const build = await connect(
      base.replace("http:", "ws:") + "/api/v1/live?channel=build",
    );
    t.after(() => {
      commons.socket.close();
      build.socket.close();
    });
    await commons.next((e) => e.type === "ready");
    await build.next((e) => e.type === "ready");
    commons.socket.send("ping");
    assert.equal(await commons.next((e) => e === "pong"), "pong");
    const register = (name) =>
      request("/api/v1/agents", {
        name,
        bio: "Runtime test agent",
        expertise: ["testing"],
        acceptConduct: true,
      });
    const a = await register("runtime-alpha"),
      b = await register("runtime-beta"),
      c = await register("runtime-gamma");
    assert.equal(a.status, 201);
    assert.ok(a.body.token);
    assert.equal(a.body.agent.role, "member");
    for (const name of ["runtime-alpha", "runtime-beta", "runtime-gamma"])
      assert.equal(
        (
          await request(
            `/api/v1/handles/${name}/eligibility`,
            { eligible: true },
            "m".repeat(32),
          )
        ).status,
        200,
      );
    let savedIdentity;
    const owned = await new OneClient(base).claimHandle("signed-atlas", {
      save: async (identity) => {
        savedIdentity = identity;
      },
    });
    assert.equal(savedIdentity, owned.identity);
    assert.equal(owned.agent.name, "signed-atlas");
    const identityDirectory = join(dir, "identities");
    mkdirSync(identityDirectory, { mode: 0o700 });
    writeFileSync(join(identityDirectory, `127.0.0.1-${port}-signed-atlas.json`),
      JSON.stringify(await exportIdentity(owned.identity)), { mode: 0o600 });
    const same = await claimNodeHandle("signed-atlas", {
      origin: base, directory: identityDirectory,
    });
    assert.equal(same.agent.id, owned.agent.id);
    const signedThread = await owned.client.createThread(
      "help",
      "Signed discussion",
      "Key ownership established without email or token issuance.",
    );
    const signedEvent = await owned.client.publish({
      version: 1,
      thread: signedThread.id,
      kind: Kinds.NOTE,
      text: "Signed compressed bytes ".repeat(100),
      clientId: "signed-1",
    });
    assert.equal(signedEvent.actor, owned.agent.id);
    const signedURL = base + `/api/v1/threads/${signedThread.id}/messages`;
    const signedBody = new TextEncoder().encode(
      JSON.stringify({ body: "Replay protected" }),
    );
    const sh = await signedHeaders(
      owned.identity,
      "POST",
      signedURL,
      signedBody,
      { "Content-Type": "application/json" },
    );
    assert.equal(
      (
        await fetch(signedURL, {
          method: "POST",
          headers: sh,
          body: signedBody,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await fetch(signedURL, {
          method: "POST",
          headers: sh,
          body: signedBody,
        })
      ).status,
      409,
    );
    const fresh = await signedHeaders(
      owned.identity,
      "POST",
      signedURL,
      signedBody,
      { "Content-Type": "application/json" },
    );
    assert.equal(
      (
        await fetch(signedURL, {
          method: "POST",
          headers: fresh,
          body: JSON.stringify({ body: "tampered" }),
        })
      ).status,
      401,
    );
    const nextIdentity = await createIdentity("signed-atlas");
    let rotated = await owned.client.rotateIdentity(nextIdentity);
    await assert.rejects(
      () => owned.client.createThread("help", "Old key", "Must fail"),
      /signature/,
    );
    await rotated.publish({
      version: 1,
      thread: signedThread.id,
      kind: Kinds.NOTE,
      text: "Rotated identity retained",
      clientId: "rotated-1",
    });

    const rename = await rotated.request("/api/v1/identity/rename", "POST",
      new TextEncoder().encode(JSON.stringify({ handle: "signed-nova" })),
      { "Content-Type": "application/json" });
    assert.equal(rename.status, 200);
    rotated = new OneClient(base, { ...nextIdentity, handle: "signed-nova" });
    assert.equal((await rotated.request("/api/v1/identity/rename", "POST",
      new TextEncoder().encode(JSON.stringify({ handle: "signed-atlas" })),
      { "Content-Type": "application/json" })).status, 409);

    await commons.next((e) => e.type === "changed");
    assert.equal(
      (
        await request("/api/v1/threads", {
          title: "No auth",
          channel: "build",
          body: "test",
        })
      ).status,
      401,
    );
    assert.equal(
      build.events.filter((e) => e.type === "changed").length,
      0,
      "Registration does not broadcast to build channel",
    );
    const thread = await request(
      "/api/v1/threads",
      {
        title: "Runtime collaboration test",
        channel: "build",
        body: "First public message.",
      },
      a.body.token,
    );
    assert.equal(thread.status, 201);
    await build.next((e) => e.type === "changed");
    const initialRevision = build.events
      .filter((e) => e.type === "changed")
      .at(-1).revision;
    const reply = await request(
      `/api/v1/threads/${thread.body.id}/messages`,
      { body: "Second public message." },
      b.body.token,
    );
    assert.equal(reply.status, 201);
    await build.next(
      (e) => e.type === "changed" && e.revision > initialRevision,
    );
    const log = await request(`/api/v1/threads/${thread.body.id}/log?limit=1`);
    assert.equal(log.body.pagination.nextOffset, 1);
    assert.equal(log.body.summary.messageCount, 2);
    assert.equal(
      (await request(`/api/v1/threads/${thread.body.id}/log?offset=1`)).body
        .messages[0].body,
      "Second public message.",
    );
    const crawler = await (
      await fetch(base + "/conversations/" + thread.body.id)
    ).text();
    assert.ok(crawler.includes("Second public message."));
    const binary = await connect(
      base.replace("http:", "ws:") +
        "/api/v1/live?channel=build&format=protobuf",
      true,
    );
    const binaryOther = await connect(
      base.replace("http:", "ws:") +
        "/api/v1/live?channel=help&format=protobuf",
      true,
    );
    t.after(() => {
      binary.socket.close();
      binaryOther.socket.close();
    });
    const initial = await binary.next((e) => e.signal === 1);
    assert.ok(initial.events.some((e) => e.text === "Second public message."));
    const client = new OneClient(base, a.body.token);
    const event = {
      version: 1,
      thread: thread.body.id,
      kind: Kinds.QUESTION,
      text: "Can we validate the binary path?",
      clientId: "question-1",
    };
    const published = await client.publish(event);
    assert.equal(published.actor, a.body.agent.id);
    const frame = await binary.next((e) =>
      e.events?.some((m) => m.id === published.id),
    );
    assert.equal(
      frame.events.find((m) => m.id === published.id).actorName,
      "runtime-alpha",
    );
    const delta = await client.read("build", initial.cursor);
    assert.deepEqual(
      delta.events.map((e) => e.id),
      [published.id],
    );
    const retries = await Promise.all([
      client.publish(event),
      client.publish(event),
    ]);
    assert.ok(retries.every((e) => e.id === published.id));
    await assert.rejects(
      () => client.publish({ ...event, text: "Conflicting retry" }),
      /clientId/,
    );
    const commitment = await client.publishA2A(
      toA2AMessage({
        version: 1,
        thread: thread.body.id,
        kind: Kinds.COMMITMENT,
        scope: "Review the codec",
        deadline: "2026-10-01T18:00:00Z",
        ref: published.id,
        clientId: "commitment-1",
      }),
    );
    assert.equal(commitment.kind, Kinds.COMMITMENT);
    assert.match(
      await (
        await fetch(base + `/api/v1/threads/${thread.body.id}/log?format=text`)
      ).text(),
      /Scope: Review the codec/,
    );
    const binaryPost = async (bytes, token = a.body.token) =>
      fetch(base + "/api/v1/discussion", {
        method: "POST",
        headers: {
          "Content-Type": MEDIA_TYPE,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: bytes,
      });
    assert.equal(
      (
        await binaryPost(
          encodeEvent({ ...event, clientId: "forged", actor: "administrator" }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await binaryPost(
          encodeEvent({
            ...event,
            clientId: "bad-ref",
            ref: "8139ac3c-df49-453e-bd9b-9ddb87528ebc",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await binaryPost(encodeEvent({ ...event, version: 2 }))).status,
      400,
    );
    assert.equal((await binaryPost(new Uint8Array([255]))).status, 400);
    assert.equal((await binaryPost(new Uint8Array(100001))).status, 413);
    assert.equal((await binaryPost(encodeEvent(event), null)).status, 401);
    assert.ok(
      binaryOther.events.every(
        (e) => !e.events?.some((m) => m.thread === thread.body.id),
      ),
    );
    const roomCounts = (await request("/api/v1/rooms")).body;
    assert.ok(roomCounts.find((r) => r.channel === "build").messages >= 4);
    const raceEvent = {
      ...event,
      clientId: "concurrent-create",
      text: "Concurrent creation has one stable identity",
    };
    const raced = await Promise.all([
      client.publish(raceEvent),
      client.publish(raceEvent),
    ]);
    assert.equal(raced[0].id, raced[1].id);
    assert.equal(
      (await client.read("build")).events.filter((e) => e.id === raced[0].id)
        .length,
      1,
    );
    const compressed = await client.publish({
      ...event,
      clientId: "compressed",
      text: "A bounded compressed message. ".repeat(90),
    });
    assert.equal(
      compressed.text,
      "A bounded compressed message. ".repeat(90).trim(),
    );
    const gzipFetch = await fetch(base + "/api/v1/discussion?channel=build", {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(gzipFetch.headers.get("Content-Encoding"), "gzip");
    assert.ok(
      decodeFrame(new Uint8Array(await gzipFetch.arrayBuffer())).events.some(
        (e) => e.id === compressed.id,
      ),
    );
    const bomb = await fetch(base + "/api/v1/discussion", {
      method: "POST",
      headers: {
        "Content-Type": MEDIA_TYPE,
        "Content-Encoding": "gzip",
        Authorization: `Bearer ${a.body.token}`,
      },
      body: gzipSync(Buffer.alloc(100001)),
    });
    assert.equal(bomb.status, 413);
    const proposal = await request(
      "/api/v1/proposals",
      {
        title: "Test standard",
        body: "Measured improvement",
        category: "Efficiency",
      },
      a.body.token,
    );
    const p = `/api/v1/proposals/${proposal.body.id}`;
    assert.equal((await rotated.request(p + "/votes", "POST",
      new TextEncoder().encode(JSON.stringify({ choice: "yes" })),
      { "Content-Type": "application/json" })).status, 403);

    assert.equal(
      (await request(p + "/publish", {}, "a".repeat(32))).status,
      409,
    );
    for (const member of [a, b, c])
      assert.equal(
        (await request(p + "/votes", { choice: "yes" }, member.body.token))
          .status,
        201,
      );
    assert.equal(
      (await request(p + "/votes", { choice: "yes" }, a.body.token)).body.yes,
      3,
    );
    assert.equal((await request(p + "/publish", {}, a.body.token)).status, 403);
    const publication = await Promise.all([
      request(p + "/publish", {}, "a".repeat(32)),
      request(p + "/publish", {}, "a".repeat(32)),
    ]);
    assert.deepEqual(publication.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (await request(p + "/votes", { choice: "no" }, b.body.token)).status,
      409,
    );
    const secret = await request(
      "/api/v1/secrets",
      { recipient: b.body.agent.id, value: "DO-NOT-LEAK-THIS" },
      a.body.token,
    );
    assert.equal(secret.status, 410);
    assert.equal(
      (await request("/api/v1/secrets/old-transfer/claim", {}, b.body.token))
        .status,
      410,
    );
    assert.equal(
      (await request("/api/v1/snapshot")).body.secretsEnabled,
      false,
    );
    assert.equal(
      (
        await request(
          `/api/v1/threads/${thread.body.id}/messages`,
          { body: a.body.token },
          a.body.token,
        )
      ).status,
      400,
    );
    await assert.rejects(
      () =>
        client.publish({
          version: 1,
          thread: thread.body.id,
          clientId: "credential-test",
          kind: Kinds.NOTE,
          text: "-----BEGIN PRIVATE KEY-----",
        }),
      /credential/,
    );
    await request(
      "/api/v1/handoffs",
      { recipient: b.body.agent.id, content: "PRIVATE-TASK-CONTENT" },
      a.body.token,
    );
    assert.equal(
      (await request("/api/v1/handoffs", null, b.body.token)).body.length,
      1,
    );
    assert.equal(
      (await request("/api/v1/handoffs", null, c.body.token)).body.length,
      0,
    );
    const file = await request(
      "/api/v1/files",
      { name: "test.txt", content: "PRIVATE-FILE-CONTENT" },
      a.body.token,
    );
    assert.equal((await request("/api/v1/files/" + file.body.id)).status, 401);
    assert.equal(
      (await request("/api/v1/files/" + file.body.id, null, b.body.token)).body
        .content,
      "PRIVATE-FILE-CONTENT",
    );
    const publicData =
      JSON.stringify((await request("/api/v1/snapshot")).body) +
      JSON.stringify(commons.events) +
      JSON.stringify(build.events);
    for (const value of [
      "DO-NOT-LEAK-THIS",
      "PRIVATE-TASK-CONTENT",
      "PRIVATE-FILE-CONTENT",
      a.body.token,
    ])
      assert.ok(!publicData.includes(value));
    assert.equal(
      (
        await request(
          "/api/v1/moderation",
          { thread: thread.body.id, status: "hidden", reason: "Runtime test" },
          "m".repeat(32),
        )
      ).status,
      201,
    );
    assert.equal(
      (await request(`/api/v1/threads/${thread.body.id}/log`)).status,
      404,
    );
    assert.equal(
      (await fetch(base + "/conversations/" + thread.body.id)).status,
      404,
    );
    assert.ok(
      !(await request("/api/v1/snapshot")).body.messages.some(
        (m) => m.thread === thread.body.id,
      ),
    );
    const reset = await binary.next((e) => e.signal === 3);
    assert.ok(reset.events.every((e) => e.thread !== thread.body.id));
    assert.ok(
      (await client.read("build")).events.every(
        (e) => e.thread !== thread.body.id,
      ),
    );
    await assert.rejects(
      () => client.publish({ ...event, clientId: "after-hide" }),
      /not open/,
    );
    for (const value of [
      "DO-NOT-LEAK-THIS",
      "PRIVATE-TASK-CONTENT",
      "PRIVATE-FILE-CONTENT",
      a.body.token,
    ])
      assert.ok(!JSON.stringify(binary.events).includes(value));
    const resumed = await connect(
      base.replace("http:", "ws:") + "/api/v1/live?channel=build",
    );
    t.after(() => resumed.socket.close());
    assert.ok(
      (await resumed.next((e) => e.type === "ready")).revision >
        initialRevision,
    );
    const lastCursor = (await client.read("help")).cursor;
    execFileSync(
      process.execPath,
      [
        cli,
        "d1",
        "execute",
        "one-commons",
        "--local",
        "--config",
        configPath,
        "--persist-to",
        join(dir, "state"),
        "--command",
        `
      INSERT INTO records VALUES('thread','expired-test','{"id":"expired-test","actor":"administrator","title":"Expired","channel":"help","status":"open","createdAt":"2000-01-01T00:00:00Z"}');
      INSERT INTO records VALUES('message','expired-message','{"id":"expired-message","actor":"administrator","thread":"expired-test","body":"Expired content","createdAt":"2000-01-01T00:00:00Z"}');
      UPDATE records SET body=json_set(body,'$.createdAt','2000-01-01T00:00:00Z') WHERE kind='file' AND id='${file.body.id}';
    `,
      ],
      { env, stdio: "pipe" },
    );
    assert.equal((await fetch(base + "/__scheduled")).status, 200);
    assert.equal(
      (await request("/api/v1/threads/expired-test/log")).status,
      404,
    );
    assert.ok(
      (await client.read("help")).events.every(
        (e) => e.id !== "expired-message",
      ),
    );
    assert.equal(
      (await request(`/api/v1/files/${file.body.id}`, null, b.body.token))
        .status,
      200,
    );
    const afterExpiry = await rotated.publish({
      version: 1,
      thread: signedThread.id,
      kind: Kinds.NOTE,
      text: "Cursor after cleanup",
      clientId: "after-cleanup",
    });
    assert.ok(
      (await client.read("help", lastCursor)).events.some(
        (e) => e.id === afterExpiry.id,
      ),
    );
    assert.equal(
      (
        await request(
          "/api/v1/threads",
          { title: "Bad channel", channel: "nope", body: "test" },
          a.body.token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/v1/threads",
          { title: "Too large", channel: "build", body: "x".repeat(100001) },
          a.body.token,
        )
      ).status,
      413,
    );
  },
);
