# Platform Boundary — Stable Core vs. Plugins

**Status:** Draft v0.1
**Decision:** The **Core OS is stable base code that publishes a versioned API — it is NOT a plugin.** Everything *above* that API is a plugin: connectors, the baked-in apps, and domain packs. Workrr builds the first batch of plugins; the marketplace lets others build more.
**Refines:** the original vision's "everything is a plugin, even OS capabilities" — which is too pure to build against (see §4).
**Companions:** [os-experience-and-apps.md](os-experience-and-apps.md) · [business-knowledge-layer-spec.md](business-knowledge-layer-spec.md)

---

## 1. The boundary

```
   ┌─────────────────────────────────────────────────────────┐
   │  PLUGINS  (extensible — we build first, marketplace next)│
   │   • Baked-in apps: Knowledge, Search, Copilot, ...       │
   │   • Connectors: M365, Google, CRM, ERP, SQL, PBX, ...    │
   │   • Domain Packs: semantic-plane prompt + vector bundles │
   └─────────────────────────────────────────────────────────┘
            ▲   consume ONLY through the published API   ▲
   ─────────┼──────── PUBLISHED PLATFORM API ────────────┼───
            │        (versioned, stable, the contract)   │
   ┌─────────────────────────────────────────────────────────┐
   │  STABLE CORE OS  (base code — NOT a plugin)             │
   │   • BKL engines: structured plane + semantic plane      │
   │   • Derivation-loop primitives (ingest/embed/extract/   │
   │     resolve)                                             │
   │   • Identity & security · sensitivity enforcement       │
   │   • Runtime hosts: connector host, inference host,       │
   │     plugin host                                          │
   │   • Operational substrate: provisioning, OTA, sealing    │
   └─────────────────────────────────────────────────────────┘
```

The Core is the thing that *publishes* the contracts. Plugins are *implementations that consume* them. That is the entire distinction — not "internal vs. external code."

---

## 2. What is Core (stable base, never a plugin)

The Core is the minimal, stable foundation that must exist for any plugin to run. It can evolve *internally* freely, but the API it publishes is a durable contract.

- **BKL engines** — the structured-plane assertion/belief engine and the semantic-plane vector/prompt engine (BKL spec §0.5).
- **Derivation-loop primitives** — ingest, embed, extract, resolve. The catalog machinery.
- **Identity, security, and sensitivity enforcement** — the trust boundary; can't be delegated to a plugin.
- **Runtime hosts** — the connector host, the inference/model host, and the plugin host itself. (The host that *runs* plugins obviously can't be one.)
- **Operational substrate** — provisioning, OTA, monitoring, sealing (appliance-hardware-strategy §5).
- **The published Platform API** — the versioned surface everything above consumes.

**The test for "is it Core?":** *Does removing it break the platform's ability to host plugins, publish contracts, or enforce trust?* If yes → Core. If it's a feature consumed through a contract → plugin.

---

## 3. What is a Plugin (built on the published API)

Everything that delivers user-visible capability. Workrr ships the first batch; the API is what lets third parties add the rest.

| Plugin class | Examples | Consumes |
|---|---|---|
| **Baked-in apps** | Company Knowledge, Search, Employee Copilot, Workflow Generation, Email Drafting, Document Understanding, Data Extraction, Internal Agents | BKL contracts (`ask`, `get`, `neighbors`, `assert`, agents) |
| **Connectors** | Microsoft 365, Google Workspace, CRM, ERP, SQL, file systems, email, calendars, PBX, APIs | connector host + `assert()` |
| **Domain Packs** | industry prompt + curated-vector bundles | semantic-plane API |

All three classes are versioned, independently installable/removable, and swappable without touching the Core.

---

## 4. Why not "everything is a plugin" (correcting the original vision)

The founding notes said even OS capabilities should be plugins. The flaw: a plugin system needs a non-plugin foundation to define, publish, host, and secure the plugin contracts. If *everything* is a plugin, nothing publishes the contract and nothing enforces trust — there's no ground to stand on.

The corrected principle keeps the *spirit* (a small core, maximal extensibility) while being buildable:

- **Small stable core** publishes the contracts and hosts everything else.
- **Everything above the API is a plugin** — features evolve, get replaced, or get removed independently.
- **The distinction is "stable contract vs. implementation of it,"** exactly as the vision intended — the refinement is only that the *contract-publisher itself* is the one thing that can't be a plugin.

---

## 5. Dogfooding — no privileged path (this is what makes the API real)

Workrr's own baked-in apps are built on the **same published API** third parties use. There is no back door for first-party plugins.

- It forces the API to be genuinely complete and ergonomic — if our own Copilot needs it, it's in the public contract, not a private call.
- It means a third-party app is a first-class citizen from day one, which is the precondition for a credible marketplace.
- It's the concrete form of the original "API-first, no privileged path" principle (BKL spec §5): the seam is enforced at the *contract*, so the Core can be re-implemented underneath without breaking a single plugin.

---

## 6. Implications

- **Versioning:** the Platform API gets semantic versioning + a published deprecation policy. Plugins declare the API version they target. The Core may change internally at will as long as the contract holds.
- **Marketplace readiness:** because first-party and third-party plugins share the API, "open the marketplace" is a *policy/distribution* step, not an architecture rewrite.
- **Sequencing (unchanged):** don't build the plugin *system* speculatively. Build the first apps/connectors as plugins on the API, let the real seams appear, then harden the plugin host and open it up. The boundary is a design commitment now; the marketplace is a later milestone.
- **Appliance fit:** customers can remove plugins they don't need (smaller attack surface, less clutter) while the Core — and therefore the catalog and trust model — stays intact.
