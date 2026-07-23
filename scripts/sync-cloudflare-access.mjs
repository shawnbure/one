import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const manifestPath = option("--manifest");
const apply = args.includes("--apply");
if (!manifestPath) fail("Usage: npm run access:sync -- --manifest <handoff.json> [--apply]");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validate(manifest);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) fail("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the local shell.");

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access`;
const request = async (path, init) => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json", ...init?.headers }
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    fail(`Cloudflare API request failed: ${detail}`);
  }
  return payload.result;
};

const applications = await request("/apps?per_page=100");
const matches = applications.filter((app) =>
  app.domain === manifest.application.domain || app.aud === manifest.application.audience);
if (matches.length !== 1) fail(`Expected exactly one Access application for ${manifest.application.domain}; found ${matches.length}.`);
const application = matches[0];
if (application.domain !== manifest.application.domain || application.aud !== manifest.application.audience) {
  fail("The manifest domain and audience do not both match the resolved Access application.");
}

const desired = {
  name: manifest.policy.name,
  decision: "allow",
  precedence: manifest.policy.precedence,
  include: manifest.policy.include,
  exclude: [],
  require: []
};
const policies = await request(`/apps/${application.id}/policies`);
const existing = policies.find((policy) => policy.name === desired.name);
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  environment: manifest.environment,
  application: { id: application.id, name: application.name, domain: application.domain },
  policy: { action: existing ? "update" : "create", id: existing?.id ?? null, ...desired },
  memberCount: desired.include.length
}, null, 2));
if (!apply) {
  console.log("Dry run only. Re-run with --apply after reviewing this plan.");
  process.exit(0);
}
if (existing) await request(`/apps/${application.id}/policies/${existing.id}`, { method: "PUT", body: JSON.stringify(desired) });
else await request(`/apps/${application.id}/policies`, { method: "POST", body: JSON.stringify(desired) });
console.log(`Applied ${desired.name} to ${application.domain}.`);

function validate(value) {
  if (value?.schemaVersion !== 1 || !["development", "production"].includes(value.environment)) fail("Unsupported Access handoff manifest.");
  if (!/^[a-z0-9.-]+$/.test(value.application?.domain ?? "") || !/^[a-f0-9]{64}$/.test(value.application?.audience ?? "")) {
    fail("Manifest application identity is invalid.");
  }
  if (value.application.teamDomain !== "https://workrr-one.cloudflareaccess.com") fail("Unexpected Access team domain.");
  if (value.policy?.decision !== "allow" || !Array.isArray(value.policy.include) || value.policy.include.length === 0) {
    fail("The handoff must contain at least one explicitly allowed member.");
  }
  for (const rule of value.policy.include) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rule?.email?.email ?? "")) fail("Invalid member email in handoff.");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
