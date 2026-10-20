import path from "node:path";

export function validateDeploymentRequest(input) {
  const environment = String(input.environment ?? "");
  if (!["dev", "production"].includes(environment)) throw new Error("--env must be dev or production");
  const expectedConfirmation = `DEPLOY ${environment.toUpperCase()}`;
  if (input.apply && input.confirmation !== expectedConfirmation) {
    throw new Error(`Exact confirmation required: --confirm "${expectedConfirmation}"`);
  }
  if (input.apply) {
    if (!path.isAbsolute(input.receiptPath ?? "")) throw new Error("--receipt must be an absolute path when applying");
    const relative = path.relative(input.repositoryRoot, input.receiptPath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new Error("Deployment receipts must be written outside the repository");
    }
  }
  const requiredBranch = environment === "production" ? "main" : "dev";
  if (input.apply && input.branch !== requiredBranch) {
    throw new Error(`${environment} deployment requires the ${requiredBranch} branch`);
  }
  return { environment, expectedConfirmation, requiredBranch };
}

export function deploymentPlan(environment) {
  const suffix = environment === "dev" ? ["--env", "dev"] : [];
  return [
    { id: "resources", label: "Cloudflare resources and D1 binding",
      command: ["node", "scripts/provision-cloudflare.mjs", "--env", environment, "--apply",
        "--confirm", `PROVISION ${environment.toUpperCase()}`] },
    { id: "repository", label: "Repository verification", command: ["npm", "run", "verify"] },
    { id: "migrations", label: "Remote additive D1 migrations",
      command: ["npx", "wrangler", "d1", "migrations", "apply", "DB", "--remote", ...suffix] },
    { id: "deploy", label: "Cloudflare Worker deployment",
      command: ["npx", "wrangler", "deploy", ...suffix] },
    { id: "smoke", label: "Access-protected live smoke", command: ["node", "scripts/smoke-live.mjs"] }
  ];
}

export function publicDeploymentReceipt(input) {
  return {
    schemaVersion: 1,
    environment: input.environment,
    accountId: input.accountId,
    domain: input.domain,
    branch: input.branch,
    commit: input.commit,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
    status: input.status,
    stages: input.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      status: stage.status,
      durationMs: stage.durationMs ?? null,
      completedAt: stage.completedAt ?? null
    })),
    liveVerification: input.liveVerification,
    secretsIncluded: false
  };
}
