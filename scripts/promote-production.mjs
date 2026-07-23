import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  buildPromotionPlan,
  migrationNames,
  missingRequiredSecrets,
  parseArguments,
  parseSecretNames,
  validatePromotion
} from "./promotion-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worker = resolve(root, "apps/platform-worker");
const args = parseArguments(process.argv.slice(2));
if (!process.env.CLOUDFLARE_ACCOUNT_ID) fail("Set CLOUDFLARE_ACCOUNT_ID to the Workrr Cloudflare account.");
if (args.apply && !process.env.CLOUDFLARE_API_TOKEN) {
  fail("Applied promotion requires CLOUDFLARE_API_TOKEN so the exact Cloudflare build can be verified.");
}

run("git", ["fetch", "origin", "--prune"], root);
const originDev = capture("git", ["rev-parse", "origin/dev"], root);
const originMain = capture("git", ["rev-parse", "origin/main"], root);
const targetSha = args.sha ? capture("git", ["rev-parse", `${args.sha}^{commit}`], root) : originDev;
const clean = capture("git", ["status", "--porcelain"], root) === "";
const mainIsAncestor = spawnSync("git", ["merge-base", "--is-ancestor", originMain, targetSha], {
  cwd: root, stdio: "ignore"
}).status === 0;
const pushAllowed = spawnSync("git", ["push", "--dry-run", "origin", `${targetSha}:refs/heads/main`], {
  cwd: root, stdio: "ignore"
}).status === 0;
const commits = capture("git", ["log", "--format=%h %s", `${originMain}..${targetSha}`], root)
  .split("\n").filter(Boolean);
const migrationOutput = capture("npx", ["wrangler", "d1", "migrations", "list", "DB", "--env=", "--remote"], worker);
const secretOutput = capture("npx", ["wrangler", "secret", "list", "--env=", "--format=json"], worker);
const presentSecrets = parseSecretNames(secretOutput);
const missingSecrets = missingRequiredSecrets(presentSecrets);
const errors = validatePromotion({ ...args, sha: targetSha, originDev, originMain, clean, mainIsAncestor, pushAllowed });
if (missingSecrets.length) {
  errors.push(`Required production secrets are missing: ${missingSecrets.join(", ")}.`);
}
if (!commits.length && originMain !== originDev) errors.push("The selected commit does not contain promotable changes.");

const plan = buildPromotionPlan({
  apply: args.apply,
  targetSha,
  originMain,
  commits,
  pendingMigrations: migrationNames(migrationOutput),
  presentSecrets,
  missingSecrets
});
console.log(JSON.stringify({ ...plan, ready: errors.length === 0, errors }, null, 2));
if (errors.length) fail("Promotion readiness checks failed.");
if (!args.apply) {
  console.log(`Dry run complete. Apply only after review:\n  npm run promote:production -- --apply --sha ${targetSha} --confirm production`);
  process.exit(0);
}

run("npm", ["run", "typecheck"], root);
run("npm", ["test"], root);
run("npm", ["run", "build"], root);
run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--env=", "--remote"], worker);
run("git", ["push", "origin", `${targetSha}:refs/heads/main`], root);
const build = await waitForExactBuild(targetSha);
const deployments = JSON.parse(capture("npx", ["wrangler", "deployments", "list", "--env=", "--json"], worker));
const deployment = deployments.at(-1);
const versionId = deployment?.versions?.[0]?.version_id ?? null;
const response = await fetch("https://one.workrr.ai/", { redirect: "manual" });
const location = response.headers.get("location") ?? "";
if (response.status !== 302 || !location.startsWith("https://workrr-one.cloudflareaccess.com/")) {
  fail(`Production Access verification failed: HTTP ${response.status}, location ${location || "(missing)"}.`);
}
console.log(JSON.stringify({
  promoted: true,
  commit: targetSha,
  buildUuid: build.build_uuid,
  workerVersionId: versionId,
  access: "https://workrr-one.cloudflareaccess.com"
}, null, 2));

async function waitForExactBuild(commitHash) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const headers = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
  const request = async (path) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      const detail = payload.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
      fail(`Cloudflare build API failed: ${detail}`);
    }
    return payload.result;
  };
  const scripts = await request(`/accounts/${accountId}/workers/scripts`);
  const production = scripts.find((script) => script.id === "workrr-platform");
  if (!production?.tag) fail("Could not resolve the production Worker build identity.");
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const builds = await request(`/accounts/${accountId}/builds/workers/${production.tag}/builds?page=1&per_page=10`);
    const build = builds.find((item) => item.build_trigger_metadata?.commit_hash === commitHash);
    if (build?.status === "stopped") {
      if (build.build_outcome !== "success") fail(`Cloudflare build ${build.build_uuid} ended as ${build.build_outcome}.`);
      return build;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10_000));
  }
  fail("Timed out waiting for Cloudflare to deploy the exact production commit.");
}

function capture(command, commandArgs, cwd) {
  try {
    return execFileSync(command, commandArgs, {
      cwd,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    fail(`${command} ${commandArgs.join(" ")} failed: ${detail}`);
  }
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, env: process.env, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
