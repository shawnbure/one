import assert from "node:assert/strict";
import test from "node:test";
import { deploymentPlan, publicDeploymentReceipt, validateDeploymentRequest } from "./customer-deployment-lib.mjs";

const root = "/workspace/workrr-one";

test("requires environment-specific confirmation, branch, and external receipt", () => {
  assert.equal(validateDeploymentRequest({
    environment: "dev", apply: true, confirmation: "DEPLOY DEV",
    receiptPath: "/tmp/workrr-dev.json", repositoryRoot: root, branch: "dev"
  }).requiredBranch, "dev");
  assert.throws(() => validateDeploymentRequest({
    environment: "production", apply: true, confirmation: "DEPLOY DEV",
    receiptPath: "/tmp/workrr.json", repositoryRoot: root, branch: "main"
  }), /DEPLOY PRODUCTION/);
  assert.throws(() => validateDeploymentRequest({
    environment: "production", apply: true, confirmation: "DEPLOY PRODUCTION",
    receiptPath: "/tmp/workrr.json", repositoryRoot: root, branch: "dev"
  }), /main branch/);
  assert.throws(() => validateDeploymentRequest({
    environment: "dev", apply: true, confirmation: "DEPLOY DEV",
    receiptPath: `${root}/receipt.json`, repositoryRoot: root, branch: "dev"
  }), /outside the repository/);
});

test("builds environment-correct migration and deploy stages", () => {
  const development = deploymentPlan("dev");
  assert.deepEqual(development.find((stage) => stage.id === "migrations").command.slice(-2), ["--env", "dev"]);
  assert.deepEqual(development.find((stage) => stage.id === "deploy").command.slice(-2), ["--env", "dev"]);
  const production = deploymentPlan("production");
  assert.equal(production.find((stage) => stage.id === "deploy").command.includes("--env"), false);
});

test("deployment receipts expose stage evidence without commands or secrets", () => {
  const receipt = publicDeploymentReceipt({
    environment: "dev", accountId: "account", domain: "one-dev.example.com", branch: "dev",
    commit: "abc", startedAt: "start", completedAt: "end", status: "completed",
    liveVerification: "verified",
    stages: [{ id: "smoke", label: "Live smoke", status: "completed", durationMs: 20, completedAt: "end",
      command: ["secret"], output: "secret" }]
  });
  assert.equal(receipt.secretsIncluded, false);
  assert.deepEqual(receipt.stages[0], {
    id: "smoke", label: "Live smoke", status: "completed", durationMs: 20, completedAt: "end"
  });
  assert.equal(JSON.stringify(receipt).includes('"command"'), false);
  assert.equal(JSON.stringify(receipt).includes('"output"'), false);
  assert.equal(JSON.stringify(receipt).includes('["secret"]'), false);
});
