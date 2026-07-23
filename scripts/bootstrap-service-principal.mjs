#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { environmentConfig, resourceManifest } from "./cloudflare-provisioning-lib.mjs";
import { availablePrecedence, publicPlan, registrationSql, resolveAccessApplication, serviceAuthPolicy,
  validateBootstrapInput } from "./service-principal-bootstrap-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = resolve(root, "apps/platform-worker");
const config = JSON.parse(readFileSync(resolve(workerDir, "wrangler.jsonc"), "utf8"));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const environment = option("--env") ?? "dev";
environmentConfig(config, environment);
const manifest = resourceManifest(config, environment);
const name = option("--name") ?? `Workrr live verification ${environment}`;
const duration = option("--duration") ?? "2160h";
const tenantId = option("--tenant");
const credentialPath = option("--credential-file");
const apply = args.includes("--apply");
const smoke = args.includes("--smoke");
validateBootstrapInput({
  environment, tenantId, name, duration, accountId: manifest.accountId,
  domain: manifest.appDomain, audience: manifest.accessAudience,
  databaseName: manifest.databaseName,
});
if (apply && (!credentialPath || !isAbsolute(credentialPath))) {
  fail("--credential-file must be an absolute path when applying");
}
if (credentialPath && resolve(credentialPath).startsWith(`${root}/`)) {
  fail("--credential-file must be outside the repository");
}
if (smoke && !apply) fail("--smoke requires --apply");
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!apiToken) fail("Set a least-privilege CLOUDFLARE_API_TOKEN in the local shell");
const base = `https://api.cloudflare.com/client/v4/accounts/${manifest.accountId}/access`;
const request = async (path, init) => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    fail(`Cloudflare API request failed: ${detail}`);
  }
  return payload.result;
};
const applications = await request("/apps?per_page=100");
const app = resolveAccessApplication(applications, manifest.appDomain, manifest.accessAudience);
const [tokens, policies] = await Promise.all([
  request("/service_tokens"),
  request(`/apps/${app.id}/policies`),
]);
const matchingTokens = tokens.filter((token) => token.name === name);
if (matchingTokens.length > 1) fail(`Multiple service tokens named "${name}" exist; resolve them before continuing`);
const existingToken = matchingTokens[0] ?? null;
const policyName = `Workrr verification · ${name}`;
const existingPolicy = policies.find((policy) => policy.name === policyName) ?? null;
console.log(JSON.stringify(publicPlan({
  environment, app, tokenAction: existingToken ? "exists" : "create",
  policyAction: existingPolicy ? "update" : "create", databaseName: manifest.databaseName,
  tenantId, credentialPath,
}), null, 2));
if (!apply) {
  console.log(`Dry run only. Apply with --apply --confirm "BOOTSTRAP ${environment.toUpperCase()} SERVICE PRINCIPAL" and an absolute --credential-file.`);
  process.exit(0);
}
const expected = `BOOTSTRAP ${environment.toUpperCase()} SERVICE PRINCIPAL`;
if (option("--confirm") !== expected) fail(`Exact confirmation required: --confirm "${expected}"`);
if (existingToken) {
  fail(`Service token "${name}" already exists. This command will not reveal or silently rotate its secret.`);
}
await assertMissing(credentialPath);
const token = await request("/service_tokens", {
  method: "POST", body: JSON.stringify({ name, duration }),
});
if (!token.id || !token.client_id?.endsWith(".access") || !token.client_secret) {
  fail("Cloudflare created a token but did not return the expected one-time credentials");
}
await mkdir(dirname(credentialPath), { recursive: true, mode: 0o700 });
await writeFile(credentialPath, `${JSON.stringify({
  schemaVersion: 1,
  environment,
  baseUrl: `https://${manifest.appDomain}`,
  clientId: token.client_id,
  clientSecret: token.client_secret,
  serviceTokenId: token.id,
  expiresAt: token.expires_at ?? null,
}, null, 2)}\n`, { mode: 0o600, flag: "wx" });
const desiredPolicy = serviceAuthPolicy(name, token.id,
  existingPolicy?.precedence ?? availablePrecedence(policies));
if (existingPolicy) {
  await request(`/apps/${app.id}/policies/${existingPolicy.id}`, {
    method: "PUT", body: JSON.stringify(desiredPolicy),
  });
} else {
  await request(`/apps/${app.id}/policies`, {
    method: "POST", body: JSON.stringify(desiredPolicy),
  });
}
execFileSync("npx", ["wrangler", "d1", "execute", manifest.databaseName,
  ...(environment === "production" ? [] : ["--env", environment]),
  "--remote", "--command", registrationSql({
    tenantId, clientId: token.client_id, displayName: name,
  })], {
  cwd: workerDir,
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: manifest.accountId },
  stdio: ["ignore", "pipe", "pipe"],
});
console.log(`Service principal registered. Credentials were written only to ${credentialPath} with mode 0600.`);
if (smoke) {
  execFileSync("node", [resolve(root, "scripts/smoke-live.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      WORKRR_BASE_URL: `https://${manifest.appDomain}`,
      CF_ACCESS_CLIENT_ID: token.client_id,
      CF_ACCESS_CLIENT_SECRET: token.client_secret,
    },
    stdio: "inherit",
  });
}

async function assertMissing(path) {
  try {
    await access(path, constants.F_OK);
    fail(`Credential file already exists and will not be overwritten: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
