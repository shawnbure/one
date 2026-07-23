import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { provisioningPlan, resourceManifest } from "./cloudflare-provisioning-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "apps/platform-worker");
const configPath = path.join(workerDir, "wrangler.jsonc");
const args = new Map(process.argv.slice(2).map((arg, index, all) =>
  arg.startsWith("--") ? [arg, all[index + 1]?.startsWith("--") ? true : all[index + 1] ?? true] : null).filter(Boolean));
const environment = String(args.get("--env") ?? "dev");
if (!["dev", "production"].includes(environment)) throw new Error("--env must be dev or production");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const manifest = resourceManifest(config, environment);
if (!manifest.accountId) throw new Error("Set account_id in wrangler.jsonc before provisioning");
const commandEnvironment = { ...process.env, CLOUDFLARE_ACCOUNT_ID: manifest.accountId };
function wrangler(parts) {
  return execFileSync("npx", ["wrangler", ...parts], {
    cwd: workerDir, env: commandEnvironment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
}
const inventories = {
  D1: wrangler(["d1", "list", "--json"]),
  R2: wrangler(["r2", "bucket", "list"]),
  Vectorize: wrangler(["vectorize", "list", "--json"]),
  Queue: wrangler(["queues", "list"])
};
const plan = provisioningPlan(manifest, inventories);
console.log(`Cloudflare resource plan · ${environment} · account ${manifest.accountId}`);
for (const item of plan) console.log(`${item.status === "exists" ? "READY " : "CREATE"}  ${item.kind.padEnd(9)} ${item.name}`);
const missing = plan.filter((item) => item.status === "create");
if (!args.has("--apply")) {
  console.log(missing.length
    ? `Plan only. Apply with --apply --confirm "PROVISION ${environment.toUpperCase()}".`
    : "All declared resources already exist; no changes required.");
  process.exit(0);
}
const expected = `PROVISION ${environment.toUpperCase()}`;
if (args.get("--confirm") !== expected) throw new Error(`Exact confirmation required: --confirm "${expected}"`);
for (const item of missing) {
  console.log(`Creating ${item.kind} ${item.name}…`);
  if (item.kind === "D1") wrangler(["d1", "create", item.name]);
  if (item.kind === "R2") wrangler(["r2", "bucket", "create", item.name]);
  if (item.kind === "Vectorize") wrangler(["vectorize", "create", item.name, "--dimensions", "768", "--metric", "cosine"]);
  if (item.kind === "Queue") wrangler(["queues", "create", item.name]);
}
console.log(`Provisioning complete. Next: deploy, apply D1 migrations, configure secrets, and run the live smoke check.`);
