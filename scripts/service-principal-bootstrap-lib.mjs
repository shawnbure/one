export function validateBootstrapInput(input) {
  if (!["dev", "production"].includes(input.environment)) throw new Error("--env must be dev or production");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(input.tenantId ?? "")) {
    throw new Error("--tenant must be a valid Workrr tenant ID");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{2,99}$/.test(input.name ?? "")) {
    throw new Error("--name must be 3–100 safe display characters");
  }
  const duration = /^([1-9][0-9]{1,3})h$/.exec(input.duration ?? "");
  if (!duration || Number(duration[1]) < 24 || Number(duration[1]) > 8760) {
    throw new Error("--duration must be 24h–8760h and cannot be forever");
  }
  if (!input.accountId?.match(/^[a-f0-9]{32}$/)) throw new Error("Cloudflare account ID is invalid");
  if (!input.domain?.match(/^[a-z0-9.-]+$/)) throw new Error("Workrr application domain is invalid");
  if (!input.audience?.match(/^[a-f0-9]{64}$/)) throw new Error("Workrr Access audience is invalid");
  if (!input.databaseName?.match(/^[a-z0-9][a-z0-9-]{2,62}$/)) throw new Error("Workrr D1 database name is invalid");
  return { ...input, durationHours: Number(duration[1]) };
}

export function resolveAccessApplication(applications, domain, audience) {
  const matches = applications.filter((app) => app.domain === domain || app.aud === audience);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Access application for ${domain}; found ${matches.length}`);
  }
  const app = matches[0];
  if (app.domain !== domain || app.aud !== audience) {
    throw new Error("Access application domain and audience do not both match the environment");
  }
  return app;
}

export function serviceAuthPolicy(name, tokenId, precedence = 10) {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(tokenId ?? "")) throw new Error("Cloudflare service token ID is invalid");
  return {
    name: `Workrr verification · ${name}`,
    decision: "non_identity",
    precedence,
    include: [{ service_token: { token_id: tokenId } }],
    exclude: [],
    require: [],
  };
}

export function availablePrecedence(policies, preferred = 10) {
  const used = new Set(policies.map((policy) => Number(policy.precedence))
    .filter((value) => Number.isInteger(value) && value >= 1));
  if (!used.has(preferred)) return preferred;
  for (let value = 1; value <= 1000; value += 1) {
    if (!used.has(value)) return value;
  }
  throw new Error("Access application has no available policy precedence");
}

export function registrationSql({ tenantId, clientId, displayName, expiresAt }) {
  if (!/^[A-Za-z0-9._-]{8,200}\.access$/.test(clientId ?? "")) {
    throw new Error("Cloudflare service-token Client ID is invalid");
  }
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("Cloudflare service-token expiry is required");
  }
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const principalId = `service-${clientId.replace(/\.access$/, "").slice(0, 32)}`;
  return `INSERT INTO access_service_principals
    (id, tenant_id, access_common_name, display_name, role, created_by,
     credential_expires_at, rotation_owner, last_rotated_at, updated_at)
    VALUES (${quote(principalId)}, ${quote(tenantId)}, ${quote(clientId)}, ${quote(displayName)},
      'operator', 'bootstrap:access', ${quote(expiresAt)},
      (SELECT id FROM tenant_members WHERE tenant_id=${quote(tenantId)} AND status='active'
       AND role IN ('admin','owner','operator') ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       created_at LIMIT 1), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(access_common_name) DO UPDATE SET
      display_name=excluded.display_name, role='operator', status='active',
      credential_expires_at=excluded.credential_expires_at,
      rotation_owner=COALESCE(excluded.rotation_owner, access_service_principals.rotation_owner),
      last_rotated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP,
      revision=access_service_principals.revision+1;`;
}

export function publicPlan({ environment, app, tokenAction, policyAction, databaseName, tenantId, credentialPath }) {
  return {
    mode: "dry-run",
    environment,
    application: { id: app.id, name: app.name, domain: app.domain, audience: app.aud },
    serviceToken: { action: tokenAction, secretPrinted: false, nonExpiring: false },
    accessPolicy: { action: policyAction, decision: "service_auth", selector: "specific_service_token" },
    workrrPrincipal: { action: "upsert", databaseName, tenantId, role: "operator" },
    credentialFile: { path: credentialPath ?? "(required for apply)", mode: "0600", committed: false },
  };
}
