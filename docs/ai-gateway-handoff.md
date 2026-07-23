# Governed Cloudflare AI Gateway handoff

Workrr One treats AI Gateway as an optional tenant-controlled inference boundary, not as a silent fallback and not as a provider-secret store. Native Workers AI remains the default for new and imported processes.

## Governance sequence

1. An owner or administrator identifies a same-account Cloudflare AI Gateway.
2. The owner records a privacy and billing review reference and explicitly decides whether Gateway logging may collect request/response content.
3. The owner enables the Gateway boundary.
4. The owner separately approves a curated third-party model in the organization model policy.
5. A builder may pin that exact model into a new immutable process release.
6. Normal evaluation and owner publication gates remain authoritative.

Every tenant and every external model begins disabled. Gateway configuration contains no provider key, Cloudflare API token, payment detail, or Unified Billing balance. Cloudflare-managed credentials and Unified Billing are used by the Worker AI binding. BYOK is deliberately excluded from this first handoff.

## Runtime boundary

Native `@cf/*` releases continue directly through the Workers AI binding and do not read Gateway policy on each turn. An external release performs one tenant-scoped D1 control read, fails closed unless the Gateway is enabled, and then calls the exact release-pinned model through the configured Gateway.

Dynamic process calls always set `skipCache`; exact prompt and conversation content must not become a cross-run response cache. The existing durable actor still owns bounded conversation context and passes its stable session affinity. Gateway metadata contains only the tenant and execution identifiers. Whether Cloudflare stores request/response logs follows the explicit tenant policy.

Each completed execution stores:

- `inference_provider`;
- `gateway_id`;
- the successful Gateway route step when supplied;
- Gateway cache status;
- a Gateway log reference when supplied.

The UI and redacted evidence export show routing evidence without exposing prompt content, provider credentials, or the log identifier itself.

## Lifecycle and portability

Gateway disablement is rejected while an active process release still uses an external model. Model removal already rejects active releases and known durable actors, preserving sticky release semantics.

An external model selection is deployment-local because Gateway identity, Unified Billing, logging, DLP, and zero-retention settings belong to the destination Cloudflare account. Process package export therefore retains the friendly model profile but omits the external model ID. Import creates a paused draft using the destination's native Workers AI default until an owner deliberately chooses and approves a destination Gateway model.

## Cloudflare controls outside Workrr

The FDE must verify in Cloudflare that the selected Gateway has the intended authentication, Unified Billing credits, spend limits, rate limits, logging retention, DLP, and zero-data-retention settings. Workrr records the review evidence but does not claim those external account settings are configured merely because a Gateway ID exists.
