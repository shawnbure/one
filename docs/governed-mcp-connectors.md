# Governed MCP connector catalog

Workrr One uses MCP as a tenant-scoped adapter for customer capabilities that already exist outside the platform. MCP does not replace Workrr's typed native-tool abstraction, release policy, approval model, DLP, audit evidence, or rate limits.

## Cloudflare topology

Each connector is represented by one named `McpConnectorAgent` Durable Object using the identity `<tenant>/<connector>`. The actor owns the Cloudflare Agents SDK MCP session, server state, and OAuth tokens in its private SQLite storage. D1 stores only searchable control-plane metadata: server URL, lifecycle status, a short-lived hash of OAuth state, discovered capability schemas, governance, process bindings, and evidence timestamps. Tokens are never copied to D1, KV, a conversation actor, or the browser.

This is intentionally separate from process agents. A tenant may have many durable conversation/entity actors and ephemeral process executions using the same governed capability, while the single connector actor maintains the provider session. Workflows continue to own long-running orchestration; Queues continue to own burst absorption and retries.

## Registration and discovery

- Admins, builders, and owners may register a public HTTPS MCP endpoint.
- Embedded credentials, fragments, query strings, obvious private/metadata targets, and non-HTTPS endpoints are rejected. The Agents SDK performs its own SSRF validation when connecting.
- Admins and owners initiate connection and OAuth. OAuth state is stored only as a SHA-256 hash and expires after 20 minutes.
- Admins, owners, and operators may refresh capability discovery.
- Discovery is capped at 50 tools and schemas are normalized to Workrr's bounded JSON Schema contract.
- Every newly discovered capability starts disabled, medium risk, confidential, and unbound.
- A refresh marks capabilities removed by the provider unavailable and disables them before restoring the currently advertised set. A stale provider tool can therefore never remain executable.

## Runtime policy

Only an admin or owner can enable and govern a discovered tool. Governance requires an owner, access mode, risk, classification, rate limit, exact optimistic revision, and optional same-tenant process bindings.

A published process release receives an immutable snapshot of enabled bindings. A connected MCP tool executes directly only when all of these remain true:

- the release autonomy is guarded or autonomous, not approve-only;
- the connector is ready;
- the tool is an enabled low-risk read;
- the tool is bound to that process release;
- input schema, DLP, and invocation rate controls pass.

Writes and medium/high-risk calls remain proposal-only. Tool inputs are capped at 32 KB, calls time out after 15 seconds, results are capped at 64 KB, and output DLP runs before model consumption or evidence persistence. Every attempt uses the normal idempotent `tool_invocations` ledger.

Disconnect removes the SDK-managed session from the connector actor, clears pending OAuth state, changes the connector to disabled, and disables all of its tools. Workrr retains bounded discovery and governance metadata for audit and controlled reconnection.

Hourly maintenance inspects at most 50 ready or attention connectors whose last check is at least 30 minutes old. A ready actor records `last_checked_at` and `last_success_at`. A missing or failed SDK session changes the connector to attention, disables its enabled capabilities, and creates a critical owned response task no more than once per 24 hours. Error evidence is bounded and strips URLs and opaque token-like values. The immutable release remains unchanged, but the central blueprint loader overlays live MCP readiness from the same tenant connector and exact discovered tool before every execution admission, so a stale release cannot bypass connector health.

## Portability

OAuth sessions and customer connector identities are deployment-local. A process package therefore exports an MCP capability as a proposal-only HTTP placeholder with support instructions to reconnect and govern the service in the destination. Importing a package can never silently make a remote service executable.
