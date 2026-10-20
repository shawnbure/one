#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentPlan, publicDeploymentReceipt, validateDeploymentRequest } from "./customer-deployment-lib.mjs";
import { resourceManifest } from "./cloudflare-provisioning-lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDirectory = path.join(repositoryRoot, "apps/platform-worker");
const wranglerPath = path.join(workerDirectory, "wrangler.jsonc");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const environment = option("--env") ?? "dev";
const apply = args.includes("--apply");
const receiptPath = option("--receipt");
const config = JSON.parse(readFileSync(wranglerPath, "utf8"));
const manifest = resourceManifest(config, environment);
const branch = command("git", ["rev-parse", "--abbrev-ref", "HEAD"], repositoryRoot).trim();
const commit = command("git", ["rev-parse", "HEAD"], repositoryRoot).trim();
const request = validateDeploymentRequest({
  environment, apply, confirmation: option("--confirm"), receiptPath, repositoryRoot, branch
});
const stages = deploymentPlan(environment).map((stage) => stage.id === "migrations"
  ? { ...stage, command: stage.command.map((part) => part === "DB" ? manifest.databaseName : part) }
  : stage);

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  environment,
  accountId: manifest.accountId,
  domain: manifest.appDomain,
  branch,
  commit,
  stages: stages.map(({ id, label, command: parts }) => ({ id, label, command: shellDisplay(parts) })),
  receipt: receiptPath ?? null,
  boundaries: [
    "Exact Cloudflare account and environment are read from Wrangler.",
    "D1 binding changes stop the run for Git review before migrations or deployment.",
    "Live smoke requires an expiring Access service principal in the local shell.",
    "Receipts contain stage metadata only and are written outside the repository."
  ]
}, null, 2));
if (!apply) {
  console.log(`Dry run only. Apply with --apply --confirm "${request.expectedConfirmation}" --receipt /absolute/path.json.`);
  process.exit(0);
}
if (existsSync(receiptPath)) throw new Error(`Refusing to overwrite existing receipt: ${receiptPath}`);
if (command("git", ["status", "--porcelain"], repositoryRoot).trim()) {
  throw new Error("Deployment requires a clean reviewed worktree");
}
const smokeCredentials = ["WORKRR_BASE_URL", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]
  .every((name) => Boolean(process.env[name]));
if (!smokeCredentials) {
  throw new Error("Apply requires WORKRR_BASE_URL, CF_ACCESS_CLIENT_ID, and CF_ACCESS_CLIENT_SECRET for final live verification");
}
if (new URL(process.env.WORKRR_BASE_URL).hostname !== manifest.appDomain) {
  throw new Error(`WORKRR_BASE_URL must target ${manifest.appDomain}`);
}

const startedAt = new Date().toISOString();
const results = [];
let status = "failed";
try {
  for (const stage of stages) {
    const stageStarted = Date.now();
    console.log(`\n${stage.label}…`);
    if (stage.id === "resources") {
      run("node", stage.command.slice(1), repositoryRoot, manifest.accountId);
      if (command("git", ["status", "--porcelain"], repositoryRoot).trim()) {
        throw new Error("Provisioning changed Wrangler configuration. Review and commit the exact D1 binding before resuming deployment.");
      }
      if (!resourceManifest(JSON.parse(readFileSync(wranglerPath, "utf8")), environment).databaseId) {
        throw new Error(`The ${environment} DB binding still has no database_id after provisioning`);
      }
    } else if (stage.id === "migrations" || stage.id === "deploy") {
      run(stage.command[0], stage.command.slice(1), workerDirectory, manifest.accountId);
    } else {
      run(stage.command[0], stage.command.slice(1), repositoryRoot, manifest.accountId);
    }
    results.push({ id: stage.id, label: stage.label, status: "completed",
      durationMs: Date.now() - stageStarted, completedAt: new Date().toISOString() });
  }
  status = "completed";
} catch (error) {
  const stage = stages[results.length];
  if (stage) results.push({ id: stage.id, label: stage.label, status: "failed",
    durationMs: null, completedAt: new Date().toISOString() });
  throw error;
} finally {
  const receipt = publicDeploymentReceipt({
    environment,
    accountId: manifest.accountId,
    domain: manifest.appDomain,
    branch,
    commit,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    stages: results,
    liveVerification: status === "completed" ? "verified" : "not_verified"
  });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  console.log(`\nDeployment receipt written to ${receiptPath}`);
}

function command(file, commandArgs, cwd) {
  return execFileSync(file, commandArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function run(file, commandArgs, cwd, accountId) {
  execFileSync(file, commandArgs, {
    cwd,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
    stdio: "inherit"
  });
}

function shellDisplay(parts) {
  return parts.map((part) => /^[a-zA-Z0-9_./:-]+$/.test(part) ? part : JSON.stringify(part)).join(" ");
}
