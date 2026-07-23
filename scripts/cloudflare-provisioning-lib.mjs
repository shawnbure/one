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
    databaseId: String(database?.database_id ?? ""),
    appDomain: String(selected.vars?.APP_DOMAIN ?? ""),
    accessAudience: String(selected.vars?.ACCESS_AUD ?? ""),
    resources: resources.map((resource) => ({ kind: resource.kind, name: String(resource.name) }))
  };
}

export function resolveD1Database(inventory, name) {
  let parsed;
  try {
    parsed = typeof inventory === "string" ? JSON.parse(inventory) : inventory;
  } catch {
    throw new Error("Cloudflare D1 inventory was not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Cloudflare D1 inventory must be an array");
  const matches = parsed.filter((item) => item?.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one D1 database named ${name}; found ${matches.length}`);
  const id = String(matches[0]?.uuid ?? matches[0]?.id ?? "");
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) {
    throw new Error(`D1 database ${name} returned an invalid ID`);
  }
  return { name, id };
}

export function bindD1Database(config, environment, database) {
  const target = environment === "production" ? config : config.env?.[environment];
  if (!target) throw new Error(`Unknown Wrangler environment: ${environment}`);
  const bindings = target.d1_databases ?? [];
  const matches = bindings.filter((item) => item.binding === "DB");
  if (matches.length !== 1) throw new Error(`Expected exactly one DB binding for ${environment}; found ${matches.length}`);
  const binding = matches[0];
  if (binding.database_name !== database.name) {
    throw new Error(`DB binding name ${binding.database_name ?? "(missing)"} does not match ${database.name}`);
  }
  if (binding.database_id && binding.database_id !== database.id) {
    throw new Error(`Refusing to replace the existing ${environment} D1 database ID`);
  }
  if (binding.database_id === database.id) return { config, changed: false };
  const next = structuredClone(config);
  const nextTarget = environment === "production" ? next : next.env[environment];
  nextTarget.d1_databases.find((item) => item.binding === "DB").database_id = database.id;
  return { config: next, changed: true };
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
