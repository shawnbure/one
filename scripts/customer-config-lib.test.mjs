import assert from "node:assert/strict";
import test from "node:test";
import { generateCustomerWrangler, validateCustomerConfigInput } from "./customer-config-lib.mjs";

const input = {
  slug: "acme",
  accountId: "a".repeat(32),
  productionDomain: "one.acme.example",
  developmentDomain: "one-dev.acme.example",
  accessTeamDomain: "https://acme.cloudflareaccess.com",
  productionAudience: "b".repeat(64),
  developmentAudience: "c".repeat(64)
};

test("generates isolated, secret-free customer environments", () => {
  const config = generateCustomerWrangler(input);
  assert.equal(config.name, "workrr-acme");
  assert.equal(config.env.dev.name, "workrr-acme-dev");
  assert.equal(config.d1_databases[0].database_name, "workrr-acme-platform");
  assert.equal(config.env.dev.d1_databases[0].database_name, "workrr-acme-platform-dev");
  assert.equal(config.d1_databases[0].database_id, undefined);
  assert.equal(config.vars.ACCESS_AUD, input.productionAudience);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.env.dev.workers_dev, false);
  assert.equal(config.env.dev.preview_urls, false);
  assert.equal(JSON.stringify(config).includes("SECRET"), false);
});

test("rejects shared domains and Access audiences", () => {
  assert.throws(() => validateCustomerConfigInput({
    ...input, developmentDomain: input.productionDomain
  }), /domains must differ/);
  assert.throws(() => validateCustomerConfigInput({
    ...input, developmentAudience: input.productionAudience
  }), /audiences must differ/);
});

test("rejects unsafe slugs, account identifiers, and Access origins", () => {
  assert.throws(() => validateCustomerConfigInput({ ...input, slug: "../acme" }), /customer slug/);
  assert.throws(() => validateCustomerConfigInput({ ...input, accountId: "not-an-account" }), /account ID/);
  assert.throws(() => validateCustomerConfigInput({
    ...input, accessTeamDomain: "https://legacy.example.com"
  }), /Access team domain/);
});
