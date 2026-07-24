import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findHighConfidenceSecrets, validateMigrationNames } from "./repository-validation-lib.mjs";
import { validateSolutionPackFiles } from "./solution-pack-validation-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString().split("\0").filter(Boolean);
const migrations = readdirSync(path.join(root, "apps/platform-worker/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .map((file) => `apps/platform-worker/migrations/${file}`);
const schemaCompatibility = JSON.parse(readFileSync(path.join(root, "apps/platform-worker/schema-compatibility.json"), "utf8"));
const readable = tracked.filter((file) => !/\.(?:png|jpg|jpeg|gif|webp|ico|pdf|woff2?)$/i.test(file));
const entries = readable.map((file) => ({ file, content: readFileSync(path.join(root, file), "utf8") }));
const solutionPackEntries = filesUnder(path.join(root, "solution-packs")).filter((file) => file.endsWith(".json"))
  .map((file) => ({ file: path.relative(root, file), content: readFileSync(file, "utf8") }));
const errors = [...validateMigrationNames(migrations), ...findHighConfidenceSecrets(entries),
  ...validateSolutionPackFiles(solutionPackEntries)];
const latestMigration = migrations.toSorted().at(-1)?.split("/").at(-1);
if (latestMigration !== schemaCompatibility.requiredMigrationName ||
  Number(latestMigration?.slice(0, 4)) !== schemaCompatibility.requiredMigrationId) {
  errors.push("schema-compatibility.json must identify the repository's latest D1 migration");
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

if (errors.length) {
  console.error(`Repository validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Repository validation passed: ${migrations.length} sequential D1 migrations; ${readable.length} tracked text files scanned.`);
}
