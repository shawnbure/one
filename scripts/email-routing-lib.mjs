export function exactEmailRules(rules, address) {
  const normalized = String(address).trim().toLowerCase();
  return rules.filter((rule) => (rule.matchers || []).some((matcher) =>
    matcher.type === "literal" && matcher.field === "to" &&
    String(matcher.value).toLowerCase() === normalized));
}

export function ruleTargetsWorker(rule, workerName) {
  return rule.enabled === true && (rule.actions || []).some((action) =>
    action.type === "worker" && Array.isArray(action.value) && action.value.includes(workerName));
}

export function planEmailRoute(rules, address, workerName) {
  const matches = exactEmailRules(rules, address);
  if (matches.length > 1) {
    throw new Error(`Refusing ambiguous delivery: ${matches.length} rules match ${address}`);
  }
  if (matches.length === 1 && !ruleTargetsWorker(matches[0], workerName)) {
    throw new Error(`The existing rule for ${address} does not deliver to ${workerName}`);
  }
  return {
    action: matches.length ? "verify" : "create",
    rule: matches[0] || null,
    body: {
      name: `Workrr One · ${address}`,
      enabled: true,
      priority: 0,
      matchers: [{ type: "literal", field: "to", value: address }],
      actions: [{ type: "worker", value: [workerName] }]
    }
  };
}

export function verificationBody(route, rule) {
  if (!/^[a-f0-9]{32}$/i.test(String(rule?.id || ""))) {
    throw new Error("Cloudflare did not return a valid routing rule ID");
  }
  return {
    cloudflareRuleId: rule.id,
    evidenceReference: `cloudflare-email-routing-rule:${rule.id}`,
    addressConfirmation: route.address,
    expectedRevision: Number(route.routing_revision)
  };
}
