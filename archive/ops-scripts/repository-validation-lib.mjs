import path from "node:path";

export function validateMigrationNames(files) {
  const names = files.map((file) => path.basename(file)).sort();
  const errors = [];
  const seen = new Set();
  let expected = 1;
  for (const name of names) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match) {
      errors.push(`Invalid migration filename: ${name}`);
      continue;
    }
    const number = Number(match[1]);
    if (seen.has(number)) errors.push(`Duplicate migration number: ${match[1]}`);
    seen.add(number);
    if (number !== expected) errors.push(`Expected migration ${String(expected).padStart(4, "0")}, found ${match[1]}`);
    expected = number + 1;
  }
  if (!names.length) errors.push("No D1 migrations found");
  return errors;
}

const secretPatterns = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    label: "assigned deployment secret",
    pattern: /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|ACCESS_CLIENT_SECRET|MICROSOFT_CLIENT_SECRET|OAUTH_TOKEN_KEY)\s*[:=]\s*["']?(?!example|placeholder|changeme|your-)[A-Za-z0-9_./+=-]{20,}/i
  }
];

export function findHighConfidenceSecrets(entries) {
  const findings = [];
  for (const { file, content } of entries) {
    if (file.endsWith("package-lock.json") || file.includes("/fixtures/")) continue;
    for (const { label, pattern } of secretPatterns) {
      const match = pattern.exec(content);
      if (!match) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line}: possible ${label}`);
    }
  }
  return findings;
}
