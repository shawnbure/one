import assert from "node:assert/strict";
import test from "node:test";
import { inventoryHas, provisioningPlan, resourceManifest } from "./cloudflare-provisioning-lib.mjs";

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
