# Workrr One solution packs

Solution packs keep customer-specific implementation material outside framework core. Each versioned directory contains:

- `manifest.json`: audience, connection requirements, ownership, and handoff checks;
- `process.json`: a directly importable `schemaVersion: 1` Workrr process package;
- no credentials, provider destinations, customer identifiers, or active schedules.

Import `process.json` from **Processes → Import package**. Workrr creates a paused draft process, disconnected/proposal-only portable tools, an immutable draft release, and the pack's release-gate acceptance cases. Importing never publishes a release, enables a schedule, grants a provider scope, or performs an external action.

Before customer use:

1. replace generic ownership and example cases with approved customer evidence;
2. connect only the manifest's minimum read scopes;
3. run the release gate and review prompt/context budget;
4. configure baseline and owner-approved value target;
5. begin in shadow, suggest, or approval mode;
6. publish only after customer handoff and recovery checks pass.

The repository validator checks every tracked solution-pack manifest and process artifact. Copy a directory to start a new pack; do not add customer secrets or payload samples.
