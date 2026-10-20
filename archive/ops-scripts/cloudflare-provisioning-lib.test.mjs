import assert from "node:assert/strict";
import test from "node:test";
import { bindD1Database, inventoryHas, provisioningPlan, resolveD1Database,
  resourceManifest } from "./cloudflare-provisioning-lib.mjs";

const config = {
  account_id: "account-1",
  d1_databases: [{ binding: "DB", database_name: "workrr-platform" }],
  r2_buckets: [{ binding: "KNOWLEDGE_BUCKET", bucket_name: "workrr-knowledge" }],
  vectorize: [{ binding: "KNOWLEDGE_INDEX", index_name: "workrr-knowledge" }],
  queues: {
    producers: [{ binding: "PROCESS_QUEUE", queue: "workrr-process-jobs" }],
    consumers: [{ queue: "workrr-process-jobs", dead_letter_queue: "workrr-process-jobs-dlq" }]
  },
  env: {
    dev: {
      d1_databases: [{ binding: "DB", database_name: "workrr-platform-dev" }],
      r2_buckets: [{ binding: "KNOWLEDGE_BUCKET", bucket_name: "workrr-knowledge-dev" }],
      vectorize: [{ binding: "KNOWLEDGE_INDEX", index_name: "workrr-knowledge-dev" }],
      queues: {
        producers: [{ binding: "PROCESS_QUEUE", queue: "workrr-process-jobs-dev" }],
        consumers: [{ queue: "workrr-process-jobs-dev", dead_letter_queue: "workrr-process-jobs-dev-dlq" }]
      }
    }
  }
};
const fixtureConfig = () => structuredClone(config);

test("derives isolated production and development resource manifests", () => {
  assert.equal(resourceManifest(config, "production").resources[0].name, "workrr-platform");
  assert.deepEqual(resourceManifest(config, "dev").resources.map(({ name }) => name), [
    "workrr-platform-dev", "workrr-knowledge-dev", "workrr-knowledge-dev",
    "workrr-process-jobs-dev", "workrr-process-jobs-dev-dlq"
  ]);
});

test("matches exact resource names rather than prefixes", () => {
  assert.equal(inventoryHas("│ workrr-process-jobs-dev-dlq │", "workrr-process-jobs-dev"), false);
  assert.equal(inventoryHas("│ workrr-process-jobs-dev │", "workrr-process-jobs-dev"), true);
});

test("creates only missing resources", () => {
  const manifest = resourceManifest(config, "dev");
  const plan = provisioningPlan(manifest, {
    D1: '[{"name":"workrr-platform-dev"}]',
    R2: "workrr-knowledge-dev",
    Vectorize: '[{"name":"workrr-knowledge-dev"}]',
    Queue: "workrr-process-jobs-dev-dlq"
  });
  assert.deepEqual(plan.map(({ status }) => status), ["exists", "exists", "exists", "create", "exists"]);
});

test("resolves an exact D1 inventory name and binds only the intended environment", () => {
  const database = resolveD1Database(JSON.stringify([
    { uuid: "11111111-1111-4111-8111-111111111111", name: "workrr-platform" },
    { uuid: "22222222-2222-4222-8222-222222222222", name: "workrr-platform-dev" }
  ]), "workrr-platform-dev");
  assert.equal(database.id, "22222222-2222-4222-8222-222222222222");
  const config = fixtureConfig();
  const result = bindD1Database(config, "dev", database);
  assert.equal(result.changed, true);
  assert.equal(result.config.env.dev.d1_databases[0].database_id, database.id);
  assert.equal(result.config.d1_databases[0].database_id, undefined);
  assert.equal(config.env.dev.d1_databases[0].database_id, undefined);
});

test("refuses ambiguous inventory and replacement of an existing D1 binding", () => {
  assert.throws(() => resolveD1Database("[]", "workrr-platform-dev"), /exactly one/);
  assert.throws(() => resolveD1Database(JSON.stringify([
    { uuid: "11111111-1111-4111-8111-111111111111", name: "same" },
    { uuid: "22222222-2222-4222-8222-222222222222", name: "same" }
  ]), "same"), /found 2/);
  const config = fixtureConfig();
  config.env.dev.d1_databases[0].database_id = "11111111-1111-4111-8111-111111111111";
  assert.throws(() => bindD1Database(config, "dev", {
    name: "workrr-platform-dev", id: "22222222-2222-4222-8222-222222222222"
  }), /Refusing to replace/);
});
