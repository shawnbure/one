export const REQUIRED_PRODUCTION_SECRETS = [
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "OAUTH_TOKEN_ENCRYPTION_KEY",
  "RUBRIC_SIGNING_JWK"
];

export function parseArguments(argv) {
  const args = [...argv];
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    apply: args.includes("--apply"),
    sha: option("--sha"),
    confirm: option("--confirm")
  };
}

export function validatePromotion({ apply, sha, confirm, originDev, originMain, clean, mainIsAncestor, pushAllowed }) {
  const errors = [];
  if (!clean) errors.push("The Git worktree must be clean before promotion.");
  if (!mainIsAncestor) errors.push("Production main must be an ancestor of the selected dev commit; reconcile divergent history first.");
  if (apply && !/^[a-f0-9]{40}$/.test(sha ?? "")) errors.push("--apply requires an explicit full 40-character --sha.");
  if (apply && sha !== originDev) errors.push("The apply SHA must exactly match the current origin/dev commit.");
  if (apply && confirm !== "production") errors.push('--apply requires --confirm production.');
  if (!pushAllowed) errors.push("The production main ref cannot be fast-forwarded with the current Git permissions.");
  if (originMain === originDev) errors.push("Production already matches dev; there is nothing to promote.");
  return errors;
}

export function parseSecretNames(value) {
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { return []; }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : [];
  return rows.map((row) => row?.name).filter((name) => typeof name === "string");
}

export function missingRequiredSecrets(secretNames) {
  const available = new Set(secretNames);
  return REQUIRED_PRODUCTION_SECRETS.filter((name) => !available.has(name));
}

export function buildPromotionPlan(input) {
  return {
    mode: input.apply ? "apply" : "dry-run",
    source: { branch: "dev", commit: input.targetSha },
    target: { branch: "main", previousCommit: input.originMain, domain: "one.workrr.ai" },
    commits: input.commits,
    database: {
      binding: "DB",
      environment: "production",
      pendingMigrations: input.pendingMigrations
    },
    requiredSecrets: {
      present: input.presentSecrets,
      missing: input.missingSecrets
    },
    gates: ["clean_worktree", "fast_forward_history", "exact_origin_dev_sha", "typecheck", "tests", "production_build"],
    execution: [
      "apply pending production D1 migrations",
      "fast-forward main to the reviewed dev SHA",
      "wait for Cloudflare Workers Builds to deploy that exact SHA",
      "verify the production Worker version and Workrr Access redirect"
    ]
  };
}

export function migrationNames(output) {
  return [...output.matchAll(/\b(\d{4}_[a-z0-9_]+\.sql)\b/gi)].map((match) => match[1])
    .filter((name, index, values) => values.indexOf(name) === index);
}
