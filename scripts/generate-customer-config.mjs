import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateCustomerWrangler } from "./customer-config-lib.mjs";

const values = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error(`Expected a value after ${key ?? "argument"}`);
  values[key.slice(2)] = value;
}
const output = values.output ? path.resolve(values.output) : null;
if (!output) throw new Error("--output is required");
if (existsSync(output)) throw new Error(`Refusing to overwrite existing file: ${output}`);
const config = generateCustomerWrangler({
  slug: values.slug,
  accountId: values["account-id"],
  productionDomain: values["production-domain"],
  developmentDomain: values["development-domain"],
  accessTeamDomain: values["access-team-domain"],
  productionAudience: values["production-audience"],
  developmentAudience: values["development-audience"]
});
writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`Wrote secret-free customer Wrangler configuration: ${output}`);
console.log("Review the diff, rename it to apps/platform-worker/wrangler.jsonc in the customer fork, then run the provisioning plan.");
