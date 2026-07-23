export function environmentConfig(config, environment) {
  if (environment === "production") return config;
  const selected = config.env?.[environment];
  if (!selected) throw new Error(`Unknown Wrangler environment: ${environment}`);
  return { ...config, ...selected };
}

export function resourceManifest(config, environment) {
  const selected = environmentConfig(config, environment);
  const database = selected.d1_databases?.find((item) => item.binding === "DB");
  const bucket = selected.r2_buckets?.find((item) => item.binding === "KNOWLEDGE_BUCKET");
  const index = selected.vectorize?.find((item) => item.binding === "KNOWLEDGE_INDEX");
  const queue = selected.queues?.producers?.find((item) => item.binding === "PROCESS_QUEUE")?.queue;
  const dlq = selected.queues?.consumers?.find((item) => item.queue === queue)?.dead_letter_queue;
  const resources = [
    { kind: "D1", name: database?.database_name },
    { kind: "R2", name: bucket?.bucket_name },
    { kind: "Vectorize", name: index?.index_name },
    { kind: "Queue", name: queue },
    { kind: "Queue", name: dlq }
  ];
  for (const resource of resources) {
    if (!resource.name) throw new Error(`Missing ${resource.kind} resource name for ${environment}`);
  }
  return {
    accountId: String(config.account_id ?? ""),
    environment,
    databaseName: String(database?.database_name ?? ""),
    appDomain: String(selected.vars?.APP_DOMAIN ?? ""),
    accessAudience: String(selected.vars?.ACCESS_AUD ?? ""),
    resources: resources.map((resource) => ({ kind: resource.kind, name: String(resource.name) }))
  };
}

export function inventoryHas(inventory, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9-])`, "im").test(inventory);
}

export function provisioningPlan(manifest, inventories) {
  return manifest.resources.map((resource) => ({
    ...resource,
    status: inventoryHas(inventories[resource.kind] ?? "", resource.name) ? "exists" : "create"
  }));
}
