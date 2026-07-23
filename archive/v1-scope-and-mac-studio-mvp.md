# v1 Scope + Mac Studio MVP Demo

**Status:** Draft v0.1
**Purpose:** Draw a defensible boundary through the vision so it becomes buildable, and define a concrete Mac Studio demo that proves the thesis fast.
**Companions:** [os-experience-and-apps.md](os-experience-and-apps.md) · [business-sku-reference-architecture.md](business-sku-reference-architecture.md) · [platform-boundary-core-vs-plugins.md](platform-boundary-core-vs-plugins.md)

---

## Part A — OpenClaw: adopt vs. build

**OpenClaw** (MIT, github.com/openclaw/openclaw) is a popular open-source *personal* AI assistant: local/self-hosted, model-agnostic (Ollama/Claude/GPT), skills-plugin system (ClawHub), connectors, agent execution, runs on Mac/appliance hardware.

**Code investigation findings (TypeScript/Node pnpm monorepo; `src/` gateway, `skills/`, `extensions/`, `apps/`, `ui/`):**
- **Its "connectors" are chat channels** (WhatsApp/Slack/Teams/Signal — how you *message the bot*), **not data-ingestion connectors** (crawl M365/CRM/SQL into a catalog). ~Zero overlap with what we need.
- **Model routing is trivial + not MLX-native:** routes to any OpenAI-compatible HTTP endpoint. With MLX-always we run `mlx_lm.server` and point at it — a one-liner. Their routing saves nothing.
- **Security is invertible, not reusable:** `main` session runs on the **host with full access** (bash/process/read/write/edit); only non-main gets a Docker sandbox. Enterprise needs no-host-exec + per-user tenant isolation as the *default*. Single-user DNA (per-agent sessions, DM pairing, personal workspace folders) is pervasive.
- **Skills** = markdown `SKILL.md` configs + ClawHub registry. Lightweight convention, not a heavy runtime.

**What it lacks (our actual IP — must build):** the **BKL/catalog** (structured + semantic planes, bitemporal assertions, entity resolution, derivation loop), enterprise data-ingestion connectors, org-wide identity/RBAC, per-role sensitivity, sealed multi-tenant security.

**Decision (revised after reading the code): BUILD OUR OWN — OpenClaw is a reference, not a fork.**
- What's left to reuse (chat UI + `SKILL.md` skill loader) is days to build clean, and building clean means the demo code *seeds the product* instead of throwaway fork-surgery.
- **Extract as patterns:** the `SKILL.md` skill convention, model-as-OpenAI-endpoint abstraction, hot-reload, "agent that does things" UX ergonomics.
- **Do not inherit:** channel layer, model routing, security model, single-user core.
- OpenClaw's real value = it *validates the category* (247k stars) — not a codebase to fork.
- Their prompt-injection guidance (full-size models, ~$30k dual Mac Studios) reflects *their* full-host-access threat model where injection = RCE. Our sandboxed, no-host-exec, read-mostly design has a different threat model — quantized models on one 256 GB Mac Studio are fine for MVP.

---

## Part B — v1 scope (the defensible boundary)

Ship the thinnest thing that proves *connect → catalog → play, privately, in the first hour*. Everything not on this list is explicitly deferred.

### In scope for v1

**Core OS (stable base):**
- Local model runtime (embeddings + extraction + reasoning) + published Platform API (thin but real).
- BKL minimum: structured plane (assertion log + belief resolution + basic entity resolution) + semantic plane (pgvector embeddings). Derivation loop: ingest → embed → extract → resolve.
- Identity/SSO + per-role sensitivity filtering on reads (baseline, not full RBAC).
- Operational baseline: local provisioning, single-node, encrypted at rest. (Fleet/OTA/attestation deferred.)

**Connectors (3):** Microsoft 365 **or** Google Workspace (pick one) · file system / shared drive · email+calendar (comes with the suite).

**Baked-in apps (3):** **Company Knowledge** (`ask()` with citations) · **Search** (semantic + structured, sourced) · **Employee Copilot** (grounded assistant + email drafting).

### Explicitly deferred (post-v1)
ERP/CRM/SQL/PBX connectors · Workflow Generation · Internal Agents · Document write-back beyond email · marketplace / third-party plugins · fleet management, OTA, sealed-boot attestation · multi-node/Enterprise tier · full RBAC · Edge SKU.

### The one thing v1 must prove
The **catalog is real and reusable**: three different apps deliver value from one BKL populated automatically from the company's own data, with provenance, entirely on-box. That validates the whole platform thesis.

---

## Part C — Mac Studio MVP demo outline

### Hardware

| | Spec | Notes |
|---|---|---|
| Machine | **Mac Studio, M-Ultra, 256 GB unified memory** | 256 GB is the demo sweet spot: runs a 70B-class model at good quality + embeddings + Postgres/pgvector + app stack in RAM with headroom. |
| Floor option | 96 GB | Runs a 30B-class model; fine for a cheaper demo, weaker reasoning. |
| Headroom option | 512 GB | Runs very large / MoE models; overkill for MVP. |
| Storage | 2–4 TB SSD | catalog + document blobs + models. |

> Validate the *current* top Mac Studio generation/chip and unified-memory options before purchase — Apple's lineup moves; anchor spec here is M3 Ultra-class. Ask me to pull the current lineup when purchasing.

### Software to install / enable

- **Model serving:** **MLX** — Apple-Silicon-native, fastest on Mac, and the standing default for all Mac local inference. (Not Ollama.)
- **Models (open-source, local):**
  - Embeddings — a strong open embedding model (bge-large / nomic-embed / Qwen-embed class).
  - Extraction/derivation — a 30B-class instruct model with reliable structured/JSON output.
  - Reasoning / `ask()` — a **70B-class instruct model, 4-bit** (~40 GB); fits 256 GB easily.
- **Data substrate:** **Postgres + pgvector** (assertion log + semantic plane in one store, matches the storage decision) + object store (local dir) for document blobs.
- **Runtime:** our own thin runtime — MLX model serving (OpenAI-compatible endpoint) + a `SKILL.md`-style skill loader + a web chat/console UX. Built clean (OpenClaw as pattern reference, not forked); this code seeds the product.
- **Apps:** the 3 baked-in apps implemented as skills/services over the Platform API.
- **Connectors:** one productivity suite (M365 or Google Workspace) + a local document folder.

### Demo data
Seed a fictional company (mailboxes, shared docs, a calendar, a CRM notes export) so cataloging completes in **minutes, not hours**, and the answers are inspectable.

### The demo script (the "wow")

1. **Power on** the pre-imaged Mac Studio.
2. **Configure (the only human step):** connect the productivity suite via OAuth; point at the shared drive.
3. **Catalog builds — live.** Progress UI shows people/customers/documents being imported, embedded, and **resolved** (the same person from email + CRM + calendar collapsing into one entity). This is the visible magic.
4. **Search:** one query returns hits across email + docs + calendar, each **with its source**.
5. **Company Knowledge:** ask *"What's the status of the Acme deal and who owns it?"* → a sourced answer stitched from CRM notes + emails + calendar, with `explain()` showing every citation.
6. **Copilot / email drafting:** *"Draft a follow-up to Acme referencing our last call and the open SLA"* → a grounded draft using cataloged context.
7. **The closer:** unplug the network cable — everything still works. **Nothing ever left the box.**

### What the demo proves
- Connect → catalog → play in the first hour (Part B thesis).
- One catalog, three apps → reuse validated (platform thesis).
- Provenance on every answer → trust.
- Fully local → the privacy promise, made physical.

### Rough build path
1. Stand up **MLX** serving the 3 models on the Mac Studio (OpenAI-compatible endpoint); build the thin runtime + skill loader + web console.
2. Add Postgres + pgvector; implement the minimal derivation loop (ingest → embed → extract → resolve) as a service.
3. Wire one connector (M365 or Workspace) + folder ingest into the loop.
4. Implement the 3 apps as skills over the Platform API (Knowledge/Search/Copilot).
5. Build the catalog-progress UI (the trust/time-to-value beat).
6. Seed demo data; rehearse the script; test the offline closer.

---

## Open items
- **Pick the demo suite:** Microsoft 365 vs. Google Workspace (whichever the target design partners use).
- **Confirm current Mac Studio generation** before purchase.
- **Confirm model set** (exact embedding / 30B / 70B choices) and licensing for commercial use.
- **Fork vs. clean for product** — revisit after the demo.
