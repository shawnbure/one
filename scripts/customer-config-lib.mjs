function required(value, label, pattern) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !pattern.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

export function validateCustomerConfigInput(input) {
  const slug = required(input.slug, "customer slug", /^[a-z][a-z0-9-]{2,30}$/);
  const accountId = required(input.accountId, "Cloudflare account ID", /^[a-f0-9]{32}$/);
  const productionDomain = required(input.productionDomain, "production domain",
    /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
  const developmentDomain = required(input.developmentDomain, "development domain",
    /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
  if (productionDomain === developmentDomain) throw new Error("Development and production domains must differ");
  const accessTeamDomain = required(input.accessTeamDomain, "Access team domain",
    /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/);
  const productionAudience = required(input.productionAudience, "production Access audience", /^[a-f0-9]{64}$/);
  const developmentAudience = required(input.developmentAudience, "development Access audience", /^[a-f0-9]{64}$/);
  if (productionAudience === developmentAudience) throw new Error("Development and production Access audiences must differ");
  return { slug, accountId, productionDomain, developmentDomain, accessTeamDomain,
    productionAudience, developmentAudience };
}

export function generateCustomerWrangler(input) {
  const value = validateCustomerConfigInput(input);
  const base = `workrr-${value.slug}`;
  const environment = (suffix, domain, audience, label) => ({
    name: `${base}${suffix}`,
    workers_dev: true,
    preview_urls: true,
    routes: [{ pattern: domain, custom_domain: true }],
    assets: { directory: "../admin/dist", not_found_handling: "single-page-application",
      run_worker_first: ["/api/*", "/oauth/*", "/health"] },
    ai: { binding: "AI" },
    r2_buckets: [{ binding: "KNOWLEDGE_BUCKET", bucket_name: `${base}-knowledge${suffix}` }],
    vectorize: [{ binding: "KNOWLEDGE_INDEX", index_name: `${base}-knowledge${suffix}` }],
    d1_databases: [{ binding: "DB", database_name: `${base}-platform${suffix}`, migrations_dir: "migrations" }],
    durable_objects: { bindings: [{ name: "PROCESS_AGENT", class_name: "ProcessAgent" }] },
    queues: {
      producers: [{ binding: "PROCESS_QUEUE", queue: `${base}-process-jobs${suffix}` }],
      consumers: [{ queue: `${base}-process-jobs${suffix}`, max_batch_size: 10, max_batch_timeout: 5,
        max_retries: 5, dead_letter_queue: `${base}-process-jobs${suffix}-dlq` }]
    },
    workflows: [
      { name: `${base}-process-workflow${suffix}`, binding: "PROCESS_WORKFLOW", class_name: "ProcessWorkflow" },
      { name: `${base}-evaluation-workflow${suffix}`, binding: "EVALUATION_WORKFLOW", class_name: "EvaluationWorkflow" },
      { name: `${base}-actor-release-rollout${suffix}`, binding: "ACTOR_RELEASE_ROLLOUT", class_name: "ActorReleaseRolloutWorkflow" },
      { name: `${base}-process-disposal${suffix}`, binding: "PROCESS_DISPOSAL_WORKFLOW", class_name: "ProcessDisposalWorkflow" },
      { name: `${base}-retention${suffix}`, binding: "RETENTION_WORKFLOW", class_name: "TenantRetentionWorkflow" }
    ],
    triggers: { crons: ["0 * * * *"] },
    vars: { ENVIRONMENT: label, APP_DOMAIN: domain, ACCESS_TEAM_DOMAIN: value.accessTeamDomain,
      ACCESS_AUD: audience, RUBRIC_PUBLISHER_NAME: `Workrr ${value.slug}` }
  });
  const production = environment("", value.productionDomain, value.productionAudience, "production");
  const development = environment("-dev", value.developmentDomain, value.developmentAudience, "development");
  return {
    $schema: "./node_modules/wrangler/config-schema.json",
    ...production,
    account_id: value.accountId,
    main: "src/index.ts",
    compatibility_date: "2026-07-22",
    compatibility_flags: ["nodejs_compat"],
    observability: { enabled: true, logs: { enabled: true, invocation_logs: true } },
    migrations: [{ tag: "v1", new_sqlite_classes: ["ProcessAgent"] }],
    env: { dev: development }
  };
}
