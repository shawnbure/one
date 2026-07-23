# Inbound email process channel

Workrr One can accept a transactional email through Cloudflare Email Routing and hand it to a governed AI Process. This is an intake channel, not a general mailbox and not an autonomous reply engine.

## Runtime path

1. Cloudflare Email Routing invokes the Worker's `email()` handler for an exact configured address.
2. Workrr resolves that address to one active, tenant-owned process route.
3. The SMTP envelope sender—not the spoofable `From` header—is checked against the route's domain allowlist.
4. The Worker enforces a 1 MB intake ceiling, parses MIME with `postal-mime`, and uses only the bounded subject and plain-text body.
5. Tenant input DLP and the published process input contract run before an execution is admitted.
6. One idempotent receipt is claimed from the route and message ID hash.
7. The request enters the deployment Queue. The email handler does not run model inference or external tools inline.
8. The normal runtime applies process operating mode, budget, release, model, autonomy, approval, tool, and evidence controls.

Raw MIME, sender addresses, subjects, message IDs, HTML, and attachments are not retained in D1. Receipts contain hashes, status, attachment count, execution linkage, and timing only. Attachments are deliberately omitted from the aggressive MVP; a later attachment path must use pre-storage DLP and governed R2 intake.

## Sticky identity

- `conversation` derives the actor key from the first `References` message, then `In-Reply-To`, then the current message ID. Replies in one RFC thread therefore return to the same durable actor.
- `consumer` derives the actor key from a SHA-256 digest of the SMTP envelope sender.
- `shared_shard` uses a bounded digest prefix to select an email shard.
- `temporary_durable` uses the message idempotency identity.
- `instant` and `workflow` remain non-sticky.
- `entity` is rejected because an email address or subject is not a trustworthy business-entity resolver.

No client submits a Durable Object name, and no sender address is embedded in an actor identity.

## Customer setup

1. In Workrr, open **Connections → Inbound email**.
2. Create the exact routed address, target process, and one or more authorized sender domains. The route starts disabled.
3. In the customer's Cloudflare account, enable Email Routing for the domain and create an exact routing rule that sends the address to the `workrr-platform` Worker (or `workrr-platform-dev` for development).
4. Publish and activate the target process.
5. Activate the Workrr email route.
6. Send one controlled message from an allowlisted domain and verify its metadata-only receipt, Queue record, execution timeline, DLP evidence, and approval behavior.

Cloudflare routing-rule creation remains an explicit customer-account step because it changes domain-wide mail delivery. A normal Worker deployment updates the handler but does not silently modify MX records or Email Routing rules. See the current [Cloudflare Email Workers API](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/) for the account setup boundary.

## Recovery and lifecycle

- Duplicate messages do not create another execution.
- Queue enqueue failure is visible on the receipt and Queue operations surface.
- Process retirement immediately disables every associated email route.
- Tenant retention deletes old email receipt metadata using the API-log retention period while preserving audit events.
- The privacy and architecture report inventories configured inbound email addresses, sender-domain policy, execution profile, status, and last receipt time.

Workrr does not auto-reply from the email handler. Any future reply is a consequential, approval-capable typed action with an explicit send binding or provider adapter, idempotency, and provider evidence.
