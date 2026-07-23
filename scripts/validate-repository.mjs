import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findHighConfidenceSecrets, validateMigrationNames } from "./repository-validation-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString().split("\0").filter(Boolean);
const migrations = tracked.filter((file) => file.startsWith("apps/platform-worker/migrations/") && file.endsWith(".sql"));
const readable = tracked.filter((file) => !/\.(?:png|jpg|jpeg|gif|webp|ico|pdf|woff2?)$/i.test(file));
const entries = readable.map((file) => ({ file, content: readFileSync(path.join(root, file), "utf8") }));
const errors = [...validateMigrationNames(migrations), ...findHighConfidenceSecrets(entries)];

if (errors.length) {
  console.error(`Repository validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Repository validation passed: ${migrations.length} sequential D1 migrations; ${readable.length} tracked text files scanned.`);
}
