// Narrow cutover helper: only the legacy one.workrr.ai Access application.
// Set ONE_ACCESS_API_TOKEN locally, or pass --token-file /absolute/path (not a token value).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const index = process.argv.indexOf("--token-file");
const token =
  index >= 0
    ? readFileSync(process.argv[index + 1], "utf8").trim()
    : process.env.ONE_ACCESS_API_TOKEN;
if (!token)
  throw Error(
    "Set ONE_ACCESS_API_TOKEN or supply --token-file. Required permission: Access: Apps and Policies Write for wkr.",
  );
const origin = "https://api.cloudflare.com/client/v4";
const account = "567f3196420ce625839042b03f9fd706";
const zone = "adf055b5846962d6587d8f1647db7de5";
const hostname = "one.workrr.ai";
const audience =
  "37177f7d83f8b4f4905fccf2f0f04785a17ee9e46809ef2bd2cbb09e15c44ee0";
async function api(path, method = "GET") {
  const r = await fetch(origin + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (!r.ok || !d.success)
    throw Error(
      `Cloudflare ${method} ${path}: ${r.status} ${d.errors?.map((e) => e.message).join("; ")}`,
    );
  return d.result;
}
const matches = [];
for (const scope of [`/accounts/${account}`, `/zones/${zone}`]) {
  try {
    const apps = await api(scope + "/access/apps?per_page=1000");
    for (const app of apps)
      if (app.domain === hostname && app.aud === audience)
        matches.push({ scope, app });
  } catch (error) {
    console.error(error.message);
  }
}
const distinct = [...new Map(matches.map((m) => [m.app.id, m])).values()];
if (distinct.length !== 1)
  throw Error(
    `Expected one exact legacy hostname/audience match; found ${distinct.length}. No change made.`,
  );
const { scope, app } = distinct[0];
console.log(
  JSON.stringify(
    {
      action: "Remove legacy Access login for the new public ONE commons",
      hostname,
      applicationId: app.id,
      name: app.name,
      scope,
      apply: process.argv.includes("--apply"),
    },
    null,
    2,
  ),
);
if (process.argv.includes("--apply")) {
  const [application, policies] = await Promise.all([
    api(`${scope}/access/apps/${app.id}`),
    api(`${scope}/access/apps/${app.id}/policies`),
  ]);
  mkdirSync(".artifacts", { recursive: true });
  writeFileSync(
    ".artifacts/legacy-one-access-backup.json",
    JSON.stringify({ scope, application, policies }, null, 2),
    { mode: 0o600 },
  );
  await api(`${scope}/access/apps/${app.id}`, "DELETE");
  console.log(
    "Removed only the legacy one.workrr.ai Access application; configuration backup saved locally.",
  );
} else
  console.log(
    "Dry run only. Add --apply to remove the matched legacy Access application.",
  );
