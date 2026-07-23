# Apps & Plugins — The Designed Surface

**Status:** Draft v0.1 (design catalog)
**Rule of thumb:** **Core** = anything that must exist to publish the API, enforce trust, or build the catalog. **Plugin** = anything that *consumes* the catalog through the API to deliver a specific capability. Everything above the published API is a plugin — including our own first-party apps.
**Sizing note:** this is the full *designed surface* (someday-blueprint). The **prove-first subset** for the client-funded accelerator is marked ⭐. See [company-model-reality-check.md](company-model-reality-check.md).
**Companions:** [platform-boundary-core-vs-plugins.md](platform-boundary-core-vs-plugins.md) · [os-experience-and-apps.md](os-experience-and-apps.md)

---

## 0. CORE (NOT plugins — the platform)

Restated so the boundary is unambiguous. None of these are apps or plugins:

- **BKL engines** — structured plane (assertions/beliefs) + semantic plane (vectors/prompts).
- **Derivation/catalog engine** — ingest → embed → **extract** → **resolve**. (Note: extraction and entity resolution are *Core capabilities*, even though thin apps front them — see §2.)
- **Identity, security, sensitivity enforcement** — the trust boundary.
- **Runtime hosts** — connector host, model/inference host, agent runtime, plugin host.
- **Published Platform API** — the contract everything below consumes.
- *(Product-phase only:* operational substrate — provisioning, OTA, sealing.)

---

## 1. Connectors — *data-in* plugins (feed the catalog)

| Group | Connectors |
|---|---|
| Productivity | ⭐ **Microsoft 365**, ⭐ **Google Workspace** |
| Files / stores | ⭐ **File systems / SharePoint / Drive**, **SQL databases** |
| CRM / ERP | Salesforce, HubSpot, Dynamics, NetSuite, … |
| Communications | Email, calendar, Slack/Teams, **PBX** (transcripts as ingest) |
| Generic | REST/GraphQL API connector, webhook intake |

Each is a plugin behind the connector-host contract; it reads to catalog and (some) write back. We author them once; customers just authorize.

---

## 2. Core Apps — *consumption* plugins (first-party, baked-in)

The essential out-of-box suite. Architecturally plugins, but they define the product's day-one value. Split into the irreducible core and the productivity tier.

### Irreducible core (⭐ accelerator MVP — thinnest, highest-value layer on the catalog)
| App | What it does | BKL contracts |
|---|---|---|
| ⭐ **Search** | Universal, entity-aware search across every system | retrieval, `neighbors()` |
| ⭐ **Ask / Company Knowledge** | Sourced natural-language answers about the business | `ask()`, `get()`, `explain()` |
| ⭐ **Copilot** | Per-user grounded assistant that answers + takes actions | `ask()` + agents, identity-scoped |

### Productivity tier (first-party, later)
| App | What it does | Note |
|---|---|---|
| **Communication Assist** | Grounded email/message drafting + replies | `ask()` context + connector write-back |
| **Document Understanding** | Interactive front-end to the extraction engine | *engine is Core; app is the plugin* |
| **On-demand Data Extraction** | Pull structured data from unstructured on request | *engine is Core; app is the plugin* |
| **Workflow & Automation Builder** | Compose/automate processes | `Process`/`Rule` ontology + agents |
| **Analytics / Dashboards** | Business metrics computed over the catalog | `get()`/`neighbors()` + `computed` assertions |

**Key clarification:** Document Understanding and Data Extraction from the original eight are **not standalone apps** — they're the Core derivation engine surfaced as thin interactive apps. This keeps the Core doing the hard work once, reused everywhere.

---

## 3. Agents / Skills — *action* plugins

Specific automated jobs that run on the catalog (SKILL.md-style convention, per the OpenClaw pattern reference). First-party starter set + third-party marketplace later.

Examples: at-risk-SLA monitor · weekly customer digest · new-lead enrichment · meeting-prep briefs · renewal/expiry watcher · duplicate-record cleanup proposals.

An agent = a prompt/policy + the catalog contracts it may call + a trigger (schedule/event). No host access; least-privilege by default (the enterprise inversion of OpenClaw's model).

---

## 4. Domain Packs — *semantic-plane* plugins

Industry bundles: prompt templates + curated vector content + extraction guidance. **Not** structured schema. Deferred (horizontal-first GTM). Examples when needed: legal, healthcare, home services, professional services.

---

## 5. Surface / Output plugins (where the catalog shows up)

The enterprise analog of OpenClaw's channels — but for how answers/actions *reach people*:
- ⭐ **Web console** (primary surface, ships first)
- **Slack / Microsoft Teams app**
- **Email digests** (scheduled briefs)
- **Browser extension** (answers in-context)
- **API / embeds** (put catalog answers inside the customer's own apps)

---

## 6. Governance / Security plugins

- SSO providers (SAML/OIDC) · RBAC policy packs · sensitivity/DLP rules · audit & compliance exporters · data-retention policies.
- These *consume* the Core security contracts; the enforcement itself is Core (§0).

---

## 7. The decision test (core-app vs. plugin vs. Core)

1. Must it exist to publish the API, enforce trust, or build the catalog? → **Core** (not a plugin).
2. Does it consume the catalog to deliver a capability? → **Plugin**.
   - Ship it baked-in and it defines out-of-box value? → **Core App** (first-party plugin).
   - Optional / vertical / third-party? → **extension plugin**.
3. Is it "an app" that's really just a UI over a Core engine (extraction, resolution)? → the **engine is Core**, the **app is the plugin**.

---

## 8. Prove-first cut (accelerator MVP, ⭐ items only)

Core catalog engine + **M365 / Google / file** connectors + **Search / Ask / Copilot** on a **web console**. Everything else in this doc is designed surface for *after* client pull is proven — not the near-term build.
