import test from "node:test";
import assert from "node:assert/strict";
import { OneClient } from "../public/sdk/one.js";
import { bootWorker } from "./harness.mjs";

const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));

test(
  "WXP: handle -> bound -> capability -> escrowed job -> settle, with refunds, policy approvals and a balanced ledger",
  { timeout: 90000 },
  async (t) => {
    const { base, adminToken } = await bootWorker(t, "one-commons-xchg-test");

    // Signed call as a given client; returns {status, body}.
    const sx = async (client, path, body, method) => {
      const r = await client.request(
        path,
        method || (body ? "POST" : "GET"),
        body ? enc(body) : undefined,
        body ? { "Content-Type": "application/json" } : {},
      );
      return { status: r.status, body: await r.json() };
    };
    // Admin (bearer) call.
    const ax = async (path, body, method) => {
      const r = await fetch(base + path, {
        method: method || (body ? "POST" : "GET"),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    };
    const ledger = async (owner) => (await ax(`/api/v1/exchange/accounts/${owner}/ledger`)).body;
    const balNum = async (owner, type) => Number((await ledger(owner)).balances[type] ?? "0");

    const provider = await new OneClient(base).claimHandle("wxp-provider", { save: async () => {} });
    const requester = await new OneClient(base).claimHandle("wxp-requester", { save: async () => {} });

    // Each agent stands up an operator and is auto-bound to it.
    const providerOp = await sx(provider.client, "/api/v1/exchange/operators", { displayName: "Provider Co" });
    const requesterOp = await sx(requester.client, "/api/v1/exchange/operators", { displayName: "Requester Co" });
    assert.equal(providerOp.status, 201, JSON.stringify(providerOp.body));
    assert.equal(requesterOp.status, 201);
    const pOp = providerOp.body.operator.id;
    const rOp = requesterOp.body.operator.id;
    const rBinding = requesterOp.body.binding.id;
    assert.ok(rBinding, "requester auto-bound");

    // Only bound agents can transact; an unbound call is rejected.
    const noBind = await new OneClient(base).claimHandle("wxp-nobody", { save: async () => {} });
    const unbound = await sx(noBind.client, "/api/v1/exchange/capabilities", { name: "x", summary: "y", verification: { mode: "requester_review" }, pricing: { amount: "1.00" } });
    assert.equal(unbound.status, 403);

    // v0.1 faucet: grant WXC to the requester operator.
    const grant = await ax("/api/v1/exchange/credits/grant", { operator: rOp, amount: "100.00" });
    assert.equal(grant.status, 201, JSON.stringify(grant.body));
    assert.equal(await balNum(rOp, "available"), 100);

    // Provider publishes a priced capability.
    const cap = await sx(provider.client, "/api/v1/exchange/capabilities", {
      name: "csv-dedupe",
      summary: "Deduplicate account rows",
      verification: { mode: "requester_review" },
      pricing: { model: "flat", amount: "5.00", currency: "WXC" },
      tags: ["data-cleaning", "csv"],
    });
    assert.equal(cap.status, 201, JSON.stringify(cap.body));
    const capId = cap.body.capability.id;

    // Discovery by tag is public.
    const found = await (await fetch(base + "/api/v1/exchange/capabilities?tag=csv")).json();
    assert.equal(found.capabilities.length, 1);
    assert.equal(found.capabilities[0].id, capId);

    // Requester opens a direct job: escrow funded, verifier frozen.
    const open = await sx(requester.client, "/api/v1/exchange/jobs", { capability: capId, acceptanceCriteria: "row count minus duplicates" });
    assert.equal(open.status, 201, JSON.stringify(open.body));
    const jobId = open.body.job.id;
    assert.equal(open.body.job.state, "accepted");
    assert.equal(await balNum(rOp, "available"), 95, "escrow debited from requester");
    assert.equal(await balNum(jobId, "escrow"), 5, "escrow holds the price");

    // Provider delivers a receipt.
    const delivered = await sx(provider.client, `/api/v1/exchange/jobs/${jobId}/deliver`, { claim: "deduped", artifact: { hash: "sha256:abc", location: "mem://out.csv" } });
    assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
    assert.equal(delivered.body.job.state, "delivered");

    // Requester accepts the delivery -> settle: provider paid price - 7% fee.
    const settled = await sx(requester.client, `/api/v1/exchange/jobs/${jobId}/verify`, { accept: true });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.job.state, "settled");
    assert.equal(settled.body.settlement.fee, "0.350000");
    assert.equal(settled.body.settlement.net, "4.650000");
    assert.equal(await balNum(pOp, "available"), 4.65, "provider earnings net of fee");
    assert.equal(await balNum("platform", "fee"), 0.35, "network fee collected");
    assert.equal(await balNum(jobId, "escrow"), 0, "escrow drained");

    // A settled reputation outcome is recorded; ledger entries are server-signed.
    const jobView = await sx(requester.client, `/api/v1/exchange/jobs/${jobId}`);
    assert.equal(jobView.body.job.state, "settled");
    const rLedger = await ledger(rOp);
    assert.ok(rLedger.entries.every((e) => typeof e.sig === "string" && e.sig.length > 0), "every entry signed");

    // --- Ledger conservation: every credit has a matching debit, net zero. ----
    let net = 0;
    for (const owner of [rOp, pOp, "platform", jobId]) {
      const b = (await ledger(owner)).balances;
      for (const v of Object.values(b)) net += Number(v);
    }
    assert.ok(Math.abs(net) < 1e-6, `ledger must net to zero, got ${net}`);

    // --- Refund path: a rejected delivery returns escrow to the requester. ----
    const job2 = await sx(requester.client, "/api/v1/exchange/jobs", { capability: capId, acceptanceCriteria: "must match" });
    assert.equal(job2.body.job.state, "accepted");
    assert.equal(await balNum(rOp, "available"), 90);
    await sx(provider.client, `/api/v1/exchange/jobs/${job2.body.job.id}/deliver`, { claim: "attempt" });
    const refunded = await sx(requester.client, `/api/v1/exchange/jobs/${job2.body.job.id}/verify`, { accept: false, reason: "did not match" });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.job.state, "refunded");
    assert.equal(await balNum(rOp, "available"), 95, "escrow refunded");

    // Double-verify is rejected (no double spend).
    const replay = await sx(requester.client, `/api/v1/exchange/jobs/${job2.body.job.id}/verify`, { accept: true });
    assert.equal(replay.status, 409);

    // --- Policy approval: over the human-approval threshold, escrow waits. -----
    const pol = await sx(requester.client, `/api/v1/exchange/bindings/${rBinding}/policy`, { approval: { requireHumanAbove: "1.00", approvers: [] } }, "PUT");
    assert.equal(pol.status, 200, JSON.stringify(pol.body));
    const job3 = await sx(requester.client, "/api/v1/exchange/jobs", { capability: capId, acceptanceCriteria: "over threshold" });
    assert.equal(job3.status, 202, JSON.stringify(job3.body));
    assert.equal(job3.body.job.state, "quoted");
    assert.equal(await balNum(rOp, "available"), 95, "no escrow before approval");
    const approvals = await sx(requester.client, "/api/v1/exchange/approvals");
    assert.equal(approvals.body.approvals.length, 1);
    const approve = await sx(requester.client, `/api/v1/exchange/approvals/${approvals.body.approvals[0].id}`, { decision: "approved" });
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    assert.equal(approve.body.job.state, "accepted");
    assert.equal(await balNum(rOp, "available"), 90, "escrow funded after approval");
  },
);

test(
  "WXP verification: test_suite settles/refunds immediately; review timeout auto-accepts",
  { timeout: 90000 },
  async (t) => {
    const { base, adminToken } = await bootWorker(t, "one-commons-verify-test");
    const sx = async (client, path, body, method) => {
      const r = await client.request(path, method || (body ? "POST" : "GET"), body ? enc(body) : undefined, body ? { "Content-Type": "application/json" } : {});
      return { status: r.status, body: await r.json() };
    };
    const ax = async (path, body, method) => {
      const r = await fetch(base + path, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json() };
    };
    const balNum = async (owner, type) => Number(((await ax(`/api/v1/exchange/accounts/${owner}/ledger`)).body.balances || {})[type] ?? "0");

    const provider = await new OneClient(base).claimHandle("verify-provider", { save: async () => {} });
    const requester = await new OneClient(base).claimHandle("verify-requester", { save: async () => {} });
    const pOp = (await sx(provider.client, "/api/v1/exchange/operators", { displayName: "P" })).body.operator.id;
    const rOp = (await sx(requester.client, "/api/v1/exchange/operators", { displayName: "R" })).body.operator.id;
    await ax("/api/v1/exchange/credits/grant", { operator: rOp, amount: "100.00" });

    // test_suite capability: assert the delivered output has rows === 3.
    const cap = await sx(provider.client, "/api/v1/exchange/capabilities", {
      name: "dedupe-tested",
      summary: "Deterministically verified dedupe",
      verification: { mode: "test_suite", assertions: [{ path: "rows", op: "equals", value: 3 }] },
      pricing: { amount: "2.00" },
      tags: ["csv"],
    });
    const capId = cap.body.capability.id;

    // Passing delivery settles immediately at delivery.
    const jobA = await sx(requester.client, "/api/v1/exchange/jobs", { capability: capId, acceptanceCriteria: "rows==3" });
    assert.equal(jobA.body.job.state, "accepted");
    const passDeliver = await sx(provider.client, `/api/v1/exchange/jobs/${jobA.body.job.id}/deliver`, { output: { rows: 3 }, claim: "deduped" });
    assert.equal(passDeliver.body.job.state, "settled", JSON.stringify(passDeliver.body));
    assert.equal(await balNum(pOp, "available"), 1.86, "2.00 - 0.14 fee");

    // Failing delivery refunds immediately.
    const jobB = await sx(requester.client, "/api/v1/exchange/jobs", { capability: capId, acceptanceCriteria: "rows==3" });
    const failDeliver = await sx(provider.client, `/api/v1/exchange/jobs/${jobB.body.job.id}/deliver`, { output: { rows: 2 }, claim: "wrong" });
    assert.equal(failDeliver.body.job.state, "refunded", JSON.stringify(failDeliver.body));

    // requester_review with a 1s window: no verdict -> cron auto-accepts.
    const cap2 = await sx(provider.client, "/api/v1/exchange/capabilities", {
      name: "review-short",
      summary: "Short review window",
      verification: { mode: "requester_review", reviewWindowSec: 1 },
      pricing: { amount: "1.00" },
      tags: ["misc"],
    });
    const jobC = await sx(requester.client, "/api/v1/exchange/jobs", { capability: cap2.body.capability.id, acceptanceCriteria: "n/a" });
    await sx(provider.client, `/api/v1/exchange/jobs/${jobC.body.job.id}/deliver`, { claim: "done" });
    const cView1 = await sx(requester.client, `/api/v1/exchange/jobs/${jobC.body.job.id}`);
    assert.equal(cView1.body.job.state, "delivered");
    await new Promise((r) => setTimeout(r, 1300));
    const sched = await fetch(base + "/__scheduled");
    assert.equal(sched.status, 200, "scheduled trigger available");
    const cView2 = await sx(requester.client, `/api/v1/exchange/jobs/${jobC.body.job.id}`);
    assert.equal(cView2.body.job.state, "settled", "review timeout auto-accepted");
  },
);

test(
  "WXP disputes: moderator full_refund slashes stake; split ruling pays both; reputation reflects outcomes",
  { timeout: 90000 },
  async (t) => {
    const { base, adminToken } = await bootWorker(t, "one-commons-dispute-test");
    const sx = async (client, path, body, method) => {
      const r = await client.request(path, method || (body ? "POST" : "GET"), body ? enc(body) : undefined, body ? { "Content-Type": "application/json" } : {});
      return { status: r.status, body: await r.json() };
    };
    const ax = async (path, body, method) => {
      const r = await fetch(base + path, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json() };
    };
    const balNum = async (owner, type) => Number(((await ax(`/api/v1/exchange/accounts/${owner}/ledger`)).body.balances || {})[type] ?? "0");

    const provider = await new OneClient(base).claimHandle("dsp-provider", { save: async () => {} });
    const requester = await new OneClient(base).claimHandle("dsp-requester", { save: async () => {} });
    const pOp = (await sx(provider.client, "/api/v1/exchange/operators", { displayName: "P" })).body.operator.id;
    const rOp = (await sx(requester.client, "/api/v1/exchange/operators", { displayName: "R" })).body.operator.id;
    await ax("/api/v1/exchange/credits/grant", { operator: rOp, amount: "100.00" });
    await ax("/api/v1/exchange/credits/grant", { operator: pOp, amount: "20.00" });

    // Provider publishes a staked capability (locks 10 WXC collateral).
    const cap = await sx(provider.client, "/api/v1/exchange/capabilities", {
      name: "contract-review",
      summary: "Review a contract clause",
      verification: { mode: "requester_review", reviewWindowSec: 86400 },
      pricing: { amount: "10.00" },
      stake: { amount: "10.00" },
      tags: ["legal"],
    });
    assert.equal(cap.status, 201, JSON.stringify(cap.body));
    assert.equal(await balNum(pOp, "stake"), 10, "capability stake locked");
    assert.equal(await balNum(pOp, "available"), 10);
    const capId = cap.body.capability.id;

    // Job 1: disputed -> moderator full_refund -> escrow returned + stake slashed.
    const j1 = await sx(requester.client, "/api/v1/exchange/jobs", { capability: capId, acceptanceCriteria: "clause correct" });
    assert.equal(await balNum(rOp, "available"), 90);
    await sx(provider.client, `/api/v1/exchange/jobs/${j1.body.job.id}/deliver`, { claim: "reviewed" });
    const dispute1 = await sx(requester.client, `/api/v1/exchange/jobs/${j1.body.job.id}/dispute`, { reason: "missed a clause" });
    assert.equal(dispute1.status, 201, JSON.stringify(dispute1.body));
    assert.equal(dispute1.body.dispute.tier, 3);
    assert.equal(dispute1.body.job.state, "disputed");
    const ruling1 = await ax(`/api/v1/exchange/disputes/${dispute1.body.dispute.id}/resolve`, { decision: "full_refund" });
    assert.equal(ruling1.status, 200, JSON.stringify(ruling1.body));
    assert.equal(ruling1.body.stakeSlashed, "10.000000");
    assert.equal(await balNum(rOp, "available"), 110, "refund (10) + slashed stake compensation (10)");
    assert.equal(await balNum(pOp, "stake"), 0, "stake slashed to zero");

    // Job 2: disputed -> moderator split 60/40.
    const j2 = await sx(requester.client, "/api/v1/exchange/jobs", { capability: capId, acceptanceCriteria: "clause correct" });
    assert.equal(await balNum(rOp, "available"), 100);
    await sx(provider.client, `/api/v1/exchange/jobs/${j2.body.job.id}/deliver`, { claim: "reviewed again" });
    const dispute2 = await sx(provider.client, `/api/v1/exchange/jobs/${j2.body.job.id}/dispute`, { reason: "requester is stalling" });
    assert.equal(dispute2.body.job.state, "disputed");
    const ruling2 = await ax(`/api/v1/exchange/disputes/${dispute2.body.dispute.id}/resolve`, { decision: "split", providerBps: 6000 });
    assert.equal(ruling2.status, 200, JSON.stringify(ruling2.body));
    assert.equal(ruling2.body.split.providerNet, "5.580000", "6 WXC share minus 0.42 fee");
    assert.equal(ruling2.body.split.requesterRefund, "4.000000");
    assert.equal(await balNum(pOp, "available"), 15.58, "10 + 5.58 split earnings");
    assert.equal(await balNum(rOp, "available"), 104, "100 + 4 split refund");

    // Reputation reflects both terminal outcomes (public, recomputable).
    const rep = await (await fetch(base + `/api/v1/exchange/reputation/${pOp}`)).json();
    assert.equal(rep.model, "wxp-reputation-v0.1");
    assert.equal(rep.inputs.countedJobs, 2);
    assert.ok(typeof rep.score === "number" && ["A", "B", "C", "D", "E"].includes(rep.band));
  },
);

test(
  "WXP surfaces: discovery exchange block, SKILL/protocol pages, and the MCP discovery server",
  { timeout: 90000 },
  async (t) => {
    const { base } = await bootWorker(t, "one-commons-surfaces-test");
    const sx = async (client, path, body, method) => {
      const r = await client.request(path, method || (body ? "POST" : "GET"), body ? enc(body) : undefined, body ? { "Content-Type": "application/json" } : {});
      return { status: r.status, body: await r.json() };
    };

    // Discovery advertises the exchange, its unit, take rate and ledger key.
    const disc = await (await fetch(base + "/api/v1/discovery")).json();
    assert.ok(disc.exchange, "discovery has an exchange block");
    assert.equal(disc.exchange.unit.code, "WXC");
    assert.equal(disc.exchange.takeRate.providerBps, 700);
    assert.ok(disc.exchange.ledgerPublicKey.length > 0, "ledger public key published");
    assert.ok(disc.exchange.mcp.endsWith("/mcp"), "mcp endpoint advertised");

    // Static agent-facing docs are served.
    assert.equal((await fetch(base + "/skills/one-exchange/SKILL.md")).status, 200);
    assert.equal((await fetch(base + "/protocol/wxp-v1.md")).status, 200);

    // Publish a capability to search for via MCP.
    const provider = await new OneClient(base).claimHandle("mcp-provider", { save: async () => {} });
    await sx(provider.client, "/api/v1/exchange/operators", { displayName: "MCP Co" });
    await sx(provider.client, "/api/v1/exchange/capabilities", { name: "summarize", summary: "Summarize text", verification: { mode: "requester_review" }, pricing: { amount: "0.50" }, tags: ["nlp"] });

    const mcpCall = (msg) => fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) }).then((r) => r.json());
    const init = await mcpCall({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(init.result.serverInfo.name, "workrr-exchange");
    const list = await mcpCall({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.ok(list.result.tools.some((t) => t.name === "wxp_search_capabilities"));
    assert.equal(list.result.tools.length, 4);
    const search = await mcpCall({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wxp_search_capabilities", arguments: { tag: "nlp" } } });
    const caps = JSON.parse(search.result.content[0].text);
    assert.equal(caps.length, 1);
    assert.equal(caps[0].name, "summarize");
  },
);
