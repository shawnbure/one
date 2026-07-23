#!/usr/bin/env node

const baseUrl = process.env.WORKRR_BASE_URL?.replace(/\/$/, "");
const clientId = process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (!baseUrl || !clientId || !clientSecret) {
  console.error("WORKRR_BASE_URL, CF_ACCESS_CLIENT_ID, and CF_ACCESS_CLIENT_SECRET are required.");
  process.exit(2);
}
const url = new URL(baseUrl);
if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
  console.error("WORKRR_BASE_URL must use HTTPS outside local development.");
  process.exit(2);
}

const headers = {
  "CF-Access-Client-Id": clientId,
  "CF-Access-Client-Secret": clientSecret,
  "content-type": "application/json",
};
let fixtureId;
const checks = [];
async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status}: ${body.error ?? "request failed"}`);
  return body;
}
async function check(name, path) {
  await request(path);
  checks.push(name);
}

const startedAt = new Date().toISOString();
let session;
let fixtureCleaned = false;
try {
  session = await request("/api/session");
  if (session.user?.role !== "operator") throw new Error("The smoke principal must have the operator role");
  checks.push("session");
  await check("governance", "/api/governance");
  await check("rubric-package", "/api/evaluation-rubrics/package");
  const created = await request("/api/smoke-fixtures", {
    method: "POST", body: JSON.stringify({ label: `live-smoke-${Date.now()}` }),
  });
  fixtureId = created.data.id;
  checks.push("fixture-created");
  await check("fixture-read", `/api/smoke-fixtures/${encodeURIComponent(fixtureId)}`);
  const removed = await request(`/api/smoke-fixtures/${encodeURIComponent(fixtureId)}`, { method: "DELETE" });
  fixtureCleaned = removed.deleted === true;
  fixtureId = undefined;
  if (!fixtureCleaned) throw new Error("Smoke fixture cleanup was not confirmed");
  checks.push("fixture-deleted");
  const verification = await request("/api/deployment-verification");
  if (verification.data?.status !== "verified") {
    throw new Error("Deployment verification evidence was not recognized after the smoke cycle");
  }
  checks.push("deployment-evidence");
  console.log(JSON.stringify({
    ok: true, baseUrl, tenantId: session.tenantId, principal: session.user.email,
    role: session.user.role, checks, fixtureCleaned, startedAt, completedAt: new Date().toISOString(),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, baseUrl, checks, fixtureCleaned, startedAt,
    error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  if (fixtureId) {
    try {
      const removed = await request(`/api/smoke-fixtures/${encodeURIComponent(fixtureId)}`, { method: "DELETE" });
      fixtureCleaned = removed.deleted === true;
    } catch {
      console.error("WARNING: automatic smoke fixture cleanup failed; it will expire within ten minutes.");
    }
  }
}
