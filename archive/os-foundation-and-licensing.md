# OS Foundation & Open-Source Licensing

**Status:** Draft v0.1
**Question answered:** Can we base "our OS" on open source without getting crippled by revenue-triggered license restrictions?
**Short answer:** Yes for the base/infrastructure OS — and you should. Constrain to **permissive licenses (green list)**, avoid **revenue-capped / source-available licenses (red list)**. The differentiated Core (catalog/BKL) you build regardless.
**Companions:** [platform-boundary-core-vs-plugins.md](platform-boundary-core-vs-plugins.md) · [business-sku-reference-architecture.md](business-sku-reference-architecture.md)

---

## 1. Two things called "OS" — different answers

| "OS" | What it is | Leverage or build? |
|---|---|---|
| **Base / infrastructure OS** | The Linux the appliance boots, immutable image, A/B OTA, orchestration, DB, model serving, secure-boot/TPM | **Leverage OSS.** Never build from scratch. |
| **Core OS (platform sense)** | Catalog/BKL engines, entity resolution, bitemporality, plugin host, published API | **Build.** It's the moat; no OSS drop-in exists. |

"Workrr OS" = permissive OSS base + hardening + our Core platform on top. (Exactly what Go1OS / AirgapAI are: branded hardened Linux + their stack, not novel kernels.)

---

## 2. The licensing rule — "not crippled at a revenue amount"

Your instinct is precise. The danger is **revenue-capped / source-available "fake open"** licenses. Filter every dependency in the shippable appliance through this:

### 🟢 GREEN — permissive, no revenue restriction, safe to embed & ship
`MIT` · `Apache 2.0` · `BSD-2/3-Clause` · `MPL 2.0` · `ISC` · `PostgreSQL License` · `Zlib` · `CC0/Unlicense`
Use freely, including commercially, at any revenue, closed-source on top. Apache 2.0 additionally grants patent rights — prefer it.

### 🟡 YELLOW — copyleft: no revenue cap, but source-sharing obligations
`LGPL` (fine for dynamic linking) · `GPL` (fine for standalone tools you ship unmodified; contaminates linked proprietary code) · `AGPL` (**network copyleft** — if you *modify* it and expose it over a network, you must publish your changes).
These are *not* revenue-crippled — they're free at any scale — but manage the obligations. **Avoid AGPL for any Core component you modify;** it's fine to use AGPL tools unmodified as separate processes.

### 🔴 RED — revenue-capped / source-available / anti-compete → DO NOT embed in the shippable OS
`BSL (Business Source License)` · `SSPL` · `Commons Clause` · `Elastic License v2` · `Functional Source License (FSL)` · `Sustainable Use License` (n8n) · `Confluent Community License` · `Redis RSALv2`.
These are the "crippled at a revenue amount / can't offer as a service / can't compete" licenses. **Canonical example: Akka** relicensed to BSL — *free only for companies under $25M revenue.* That is exactly what you're avoiding. **Also watch relicensing risk:** a green project can flip to red (HashiCorp/Terraform→BSL, Redis→SSPL, Akka→BSL). Prefer projects under neutral foundations (CNCF/Apache/Linux Foundation) which are far harder to relicense.

---

## 3. Recommended permissive base stack (all 🟢/🟡-safe)

| Layer | Choice | License |
|---|---|---|
| **Immutable appliance OS** | **Talos Linux** (API-managed, immutable — aligns with fleet model) or **Flatcar** / **NixOS** (atomic, built-in rollback) | MPL 2.0 / Apache 2.0 / MIT |
| **Image build (if custom)** | Yocto or Buildroot | permissive (MIT/GPL tooling, your output) |
| **A/B OTA + rollback** | **RAUC** or OSTree/bootc (Mender client = Apache 2.0, but server has an enterprise split — watch) | LGPL |
| **Orchestration** | k3s + containerd | Apache 2.0 |
| **Secure boot / TPM / encryption** | systemd, dm-verity, LUKS, tpm2-tools | GPL/LGPL (standard, ship-safe) |
| **Data substrate** | **PostgreSQL + pgvector** | PostgreSQL License 🟢 |
| **Model serving (Mac)** | **MLX** | MIT 🟢 |
| **Runtime/agent patterns** | OpenClaw (reference only, not forked) | MIT 🟢 |

This stack has **zero revenue-capped dependencies** and gives you immutable image + OTA/rollback + orchestration + DB + serving for free. You build the Core on top.

---

## 4. Model weights — a separate licensing axis (watch this)

Model *weights* have their own licenses, distinct from code:
- **Prefer Apache 2.0 open-weight models** (e.g. Mistral open-weight releases; many Qwen releases) — clean, no restrictions.
- **Llama** ships under the **Llama Community License** — *not* revenue-capped, but restrictive: a >700M-MAU clause, "Built with Llama" attribution, and a ban on using it to improve other models. Usable for a private on-prem appliance, but it's not truly free — flag it.
- **Verify every model individually** — some "open" models carry non-commercial or research-only terms.
- Rule: default to **Apache-2.0-weighted models** for the shipped appliance; treat anything else as a deliberate, reviewed exception.

---

## 5. The boundary — leverage vs. build

- **Leverage (OSS, green):** everything from the metal up through orchestration, DB, and model serving. This is undifferentiated plumbing; owning it buys nothing.
- **Build (our IP):** the catalog/BKL (two planes, entity resolution, bitemporality, provenance), the derivation loop, the plugin host + published API, the baked-in apps, and the sealing/fleet layer that makes it an appliance.
- **Net:** "our OS" is a curated distribution + our platform — legitimately *ours* as an integrated product, while standing entirely on permissive open source. No revenue cliff, no relicensing hostage situation, no wasted effort re-inventing Linux.

---

## 6. Open-core case: Onyx (ex-Danswer) — should we build on it?

Onyx dual-licenses: **MIT Community Edition** (Chat, RAG, Agents, Actions, **50+ connectors**) + **commercial Enterprise Edition** (SSO/SAML, **RBAC, user groups, document permission-sync**, analytics, custom data-filtering, whitelabeling).

- **Crippled?** Not revenue-capped — MIT core is free at any revenue. But **feature-crippled (open-core):** the multi-tenant enterprise essentials (RBAC, SSO, permission-sync) are commercial-only. A sealed multi-tenant appliance *needs* those, so the free edition can't stand alone as our OS. A feature cliff exactly where we need substance.
- **Strategic:** Onyx is our most direct competitor. Building on their open-core — where the parts we need are their paid upsell — hands a competitor control of our roadmap.
- **Architectural:** Onyx is a **RAG platform, not a catalog/BKL** (no entity resolution, bitemporality, or two-plane model). It biases us back toward commodity RAG — the position we deliberately rejected.
- **Verdict: do NOT build on Onyx as the OS/platform.** **Harvest its MIT connectors** (50+ ingestion connectors = undifferentiated plumbing, permissively licensed — retain MIT notices). Build the catalog, access control, and apps ourselves. Same shape as the OpenClaw conclusion: harvest permissive components, don't adopt as foundation.

## 7. Open items
- Pick the immutable-OS base: **Talos vs. NixOS vs. Flatcar** (Talos leans into the API-managed fleet model; NixOS gives declarative reproducible images + trivial rollback).
- Confirm the OTA mechanism (RAUC vs. OSTree/bootc).
- Establish a **license gate in CI** (fail the build on any red-list dependency) — cheap insurance against a transitive BSL/SSPL sneaking in.
- Maintain an approved-model list keyed by weight license.
