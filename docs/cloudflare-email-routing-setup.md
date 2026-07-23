# Cloudflare Email Routing setup

Workrr keeps product configuration in D1, but D1 configuration alone does not prove that Cloudflare
will deliver an address to the Worker. An inbound email route therefore remains disabled until an
operator verifies the matching Cloudflare Email Routing rule.

## Evidence boundary

Activation requires all of the following:

- one enabled Cloudflare rule with a literal `to` matcher for the exact configured address;
- a `worker` action targeting the Worker name for the selected Workrr environment;
- the Cloudflare rule ID recorded against the current route revision;
- an active process and at least one authorized sender domain.

Editing a disabled route clears its routing evidence and increments its revision. Activation fails
closed until the updated address is verified again. Workrr stores the rule ID, verification time,
operator identity, and evidence reference. It does not store the Cloudflare API token.

## FDE command

Create a short-lived Cloudflare API token with Zone Read and Email Routing Rules Write. Use the
environment's Cloudflare Access service principal to authenticate to Workrr:

```sh
export CLOUDFLARE_API_TOKEN=...
export CF_ACCESS_CLIENT_ID=...
export CF_ACCESS_CLIENT_SECRET=...
npm run email:route -- --env dev --tenant TENANT_ID --route ROUTE_ID
```

The command is a read-only dry run by default. Review its resolved environment, address, Worker,
and action. Apply only with the exact environment confirmation:

```sh
npm run email:route -- --env dev --tenant TENANT_ID --route ROUTE_ID \
  --apply --confirm "CONFIGURE DEV EMAIL ROUTE"
```

The command refuses duplicate matching rules and refuses an existing rule that is disabled or
targets another Worker. It creates only a missing exact-match rule, then records evidence through
the tenant-scoped Workrr API. The API token should be revoked or allowed to expire after setup.
