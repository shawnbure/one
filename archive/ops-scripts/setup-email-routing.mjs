#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resourceManifest } from "./cloudflare-provisioning-lib.mjs";
import { planEmailRoute, verificationBody } from "./email-routing-lib.mjs";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "dev" },
    tenant: { type: "string" },
    route: { type: "string" },
    apply: { type: "boolean", default: false },
    confirm: { type: "string" }
  }
});
if (!values.tenant || !values.route) throw new Error("--tenant and --route are required");
if (!["dev", "production"].includes(values.env)) throw new Error("--env must be dev or production");

const token = process.env.CLOUDFLARE_API_TOKEN;
const accessId = process.env.CF_ACCESS_CLIENT_ID;
const accessSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required (Zone Read + Email Routing Rules Write)");
if (!accessId || !accessSecret) throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required");

const config = JSON.parse(readFileSync(new URL("../apps/platform-worker/wrangler.jsonc", import.meta.url), "utf8"));
const manifest = resourceManifest(config, values.env);
const appOrigin = `https://${manifest.appDomain}`;
const accessHeaders = {
  "CF-Access-Client-Id": accessId,
  "CF-Access-Client-Secret": accessSecret
};
const session = await api(`${appOrigin}/api/session`, { headers: accessHeaders });
if (String(session.tenantId) !== values.tenant) {
  throw new Error(`Access principal belongs to tenant ${session.tenantId}, not ${values.tenant}`);
}
const workrr = await api(`${appOrigin}/api/email-routes`, { headers: accessHeaders });
const routes = Array.isArray(workrr.data) ? workrr.data : [];
const route = routes.find((item) => item.id === values.route);
if (!route) throw new Error(`Route ${values.route} was not found for the authenticated Workrr tenant`);
if (route.status !== "disabled") throw new Error("Disable the Workrr email route before configuring delivery");

const domain = String(route.address).split("@")[1];
const zoneList = await cloudflare(`/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(manifest.accountId)}`, token);
if (zoneList.result.length !== 1) throw new Error(`Expected exactly one Cloudflare zone for ${domain}`);
const zoneId = zoneList.result[0].id;
const ruleList = await cloudflare(`/zones/${zoneId}/email/routing/rules?per_page=100`, token);
const plan = planEmailRoute(ruleList.result, route.address, manifest.workerName);

console.log(JSON.stringify({
  environment: values.env, tenant: values.tenant, routeId: route.id, address: route.address,
  workerName: manifest.workerName, action: plan.action,
  existingRuleId: plan.rule?.id || null
}, null, 2));
if (!values.apply) {
  console.log(`Dry run only. Re-run with --apply --confirm "CONFIGURE ${values.env.toUpperCase()} EMAIL ROUTE".`);
  process.exit(0);
}
const expected = `CONFIGURE ${values.env.toUpperCase()} EMAIL ROUTE`;
if (values.confirm !== expected) throw new Error(`--confirm must exactly equal "${expected}"`);

const verifiedRule = plan.rule || (await cloudflare(`/zones/${zoneId}/email/routing/rules`, token, {
  method: "POST", body: JSON.stringify(plan.body)
})).result;
const evidence = verificationBody(route, verifiedRule);
await api(`${appOrigin}/api/email-routes/${encodeURIComponent(route.id)}/routing-verification`, {
  method: "POST", headers: { ...accessHeaders, "Content-Type": "application/json" },
  body: JSON.stringify(evidence)
});
console.log(`Verified Cloudflare rule ${verifiedRule.id}. Workrr activation is now unlocked.`);

async function cloudflare(path, apiToken, init = {}) {
  return api(`https://api.cloudflare.com/client/v4${path}`, {
    ...init, headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", ...(init.headers || {}) }
  });
}

async function api(url, init = {}) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok || payload.success === false || payload.error) {
    const detail = payload.error || payload.errors?.map((item) => item.message).join("; ") || response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}
