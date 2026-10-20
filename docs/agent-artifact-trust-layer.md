# Certified Agent Artifacts — Enterprise Trust Layer

*Thesis + validation test · 2026-10-16*

## Thesis

As enterprises deploy AI agents, they are loading an exploding set of **runtime artifacts** — skills (SKILL.md), MCP servers, rulesets, and `AGENTS.md`/`CLAUDE.md` context — mostly from open, unvetted sources. These artifacts *are* executable instructions with the full permission set of the agent that runs them. The open standards, public registries, and wire transport for this ecosystem are already a Linux Foundation commons (AGENTS.md / MCP / A2A / Skills) and a Cisco-led consortium (AGNTCY). **The one layer nobody owns is trust.** We build the certified, signed, reputation-banded, policy-controlled **private registry of vetted agent artifacts for enterprises** — on the open formats, on Cloudflare, sold services-led.

## Why this slice is open

- **Signing ≠ safety.** Provenance proves *who* published, not that an artifact is benign; signatures have been forged with stolen CI tokens, and trusted publishers get compromised.
- **The artifacts are the attack.** Snyk's ToxicSkills study found prompt injection across a large share of sampled skills; a malicious skill inherits the agent's filesystem, credentials, memory, and network access.
- **Registries explicitly don't vet.** Publishing to the MCP registry or a skills marketplace is "a record, not a review." Scanners (Snyk, Glama grades) are point tools; identity frameworks (AGNTCY, Cisco Duo) prove identity, not safety.
- **We don't fight the commons.** Format and transport are a multi-vendor standard — we ride AGENTS.md/MCP/A2A/SKILL.md and compete only on trust.

## Target customer

Security- and compliance-conscious organizations already running agents at scale with third-party skills/MCP — regulated mid-market and up (financial services, healthcare, legal, gov-adjacent). **Buyer:** the platform / AI-governance / security owner who is accountable for "which agent code is allowed to run here" and today has no answer. Lands as a single team's problem, spreads org-wide.

## Certification scheme (the product core)

Each artifact gets an **immutable, signed certificate** recording four checkable properties:
1. **Provenance** — built from a specific source, unchanged (Sigstore/SLSA-style).
2. **Policy conformance** — matches the enterprise's allowlist / ruleset.
3. **Injection-free** — passes known-pattern scanning.
4. **Reproducible test-suite pass** — *this is "binary accuracy"*: a deterministic suite the artifact either passes or fails (WXP `test_suite` verification mode).

What is **not** deterministically testable gets a graded **A–E trust band** from settled outcomes (the WXP reputation model). → **Binary certification where a deterministic test exists; a reputation band where it doesn't.** Certificates are enforced at load time by a private registry the agent/harness resolves against; version-pinned, revocable, audit-logged.

## Open-core model

- **Open (Apache-2.0), the funnel:** the certification scheme/spec, the signing + verification CLI, the baseline reputation function, reference registry client. Builds mindshare on the open formats.
- **Commercial, the business:** the **private, vetted enterprise registry** (self-hostable on our Cloudflare stack), managed certification/verification, policy authoring, and the audit trail — delivered as a Palantir-FDE-style services engagement, our existing model.

## Why workrr wins here

Founder-market fit (we live in skills/CLAUDE.md/MCP); the **WXP primitives already exist** — signed outcomes, A–E reputation, double-entry audit, policy enforcement; it is the same private-AI-for-business, Cloudflare, services thesis — not a separate company. Neighbors (Snyk, Glama, Cisco) are circling, but the **certified + reproducibly-tested + private-enterprise** combination is unbuilt.

## Validation test (before any build)

**Make-or-break question:** *Do target enterprises feel enough pain from ungoverned agent artifacts to pay for certification + a private registry — or do they just block all third-party artifacts, or expect their platform vendor (Anthropic/Microsoft/Cisco) to provide this free?*

- Find **3–5 design partners** already deploying agents with third-party skills/MCP.
- Offer a paid pilot: certify their current artifact set and stand up a private vetted registry their agents resolve against.
- Run a landing-page smoke test in parallel ("certified agent skills for the enterprise") and measure qualified-demo requests from the buyer persona.
- **Measure:** (1) willingness to pay a pilot fee; (2) how many of *their real* artifacts are deterministically certifiable vs band-only; (3) whether they'd accept this only free-from-platform.

## Kill criteria

Stop, or rescope, if any hold after the test:
- Design partners say first-party / existing controls are sufficient, or they simply disallow third-party artifacts.
- They would only accept this bundled free from the platform vendor (no independent willingness to pay).
- Too few of their real artifacts are deterministically certifiable for certification to add trust beyond a plain allowlist.
- A platform owner (Anthropic/Microsoft/Cisco/AGNTCY) ships a free certified-private-registry before we reach a paying pilot.
