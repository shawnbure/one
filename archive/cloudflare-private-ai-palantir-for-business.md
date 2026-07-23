# workrr one — Cloudflare Infra · Private AI · Palantir for Business

**Status:** Draft v0.1 — **current primary direction** (supersedes the appliance-first plan for the near term)
**The pivot:** No appliance now (maybe later). Build on **Cloudflare's infrastructure**, leveraging workrr's existing Cloudflare expertise. Revenue horizon = **soon**, not greenfield. Keep the positioning: **private AI + "Palantir for business."** The appliance becomes an optional later tier for physical-sovereignty buyers.
**Supersedes for now:** appliance-hardware-strategy, business-sku-reference-architecture, Mac Studio/MLX MVP, Talos/NixOS OS foundation → all reframed as the *later on-prem tier*, parked.
**Companions:** [decision-apps-palantir-for-business.md](decision-apps-palantir-for-business.md) · [business-knowledge-layer-spec.md](business-knowledge-layer-spec.md) · [company-model-reality-check.md](company-model-reality-check.md)

---

## 1. Why Cloudflare (and why now)

- **Plays to workrr's real strength** — you already have Cloudflare expertise; build where you're strong.
- **Revenue soon** — managed, serverless infra means no hardware, no OEM, no fleet, no ops team. Ship pilots in weeks.
- **Private-capable** — inference can stay on Cloudflare (no data to OpenAI/Anthropic); deploy into the customer's own Cloudflare account; Zero Trust access; data-localization controls.
- **Global + cheap at rest** — edge compute, R2 with no egress fees, scales from one pilot to many tenants without re-architecture.
- **The catalog maps cleanly onto CF primitives** (below) — the architecture we designed runs here as-is.

---

## 2. Cloudflare as infrastructure — the stack

The two-plane catalog + derivation loop, mapped to Cloudflare products:

| Catalog layer | Cloudflare product |
|---|---|
| **Connectors / ingest** | Workers (cron + fetch), **Browser Rendering** (crawl), **Hyperdrive** (to customer SQL/Postgres), **Queues** |
| **Document blobs** | **R2** (no egress fees) |
| **Embeddings (semantic plane)** | **Workers AI** embedding models → **Vectorize** (vector DB) |
| **Extraction (LLM → assertions)** | **Workers AI** (open LLMs) and/or **AI Gateway** (route/cache/observe; reach larger or private models) |
| **Structured plane (bitemporal assertions + beliefs)** | **D1** (serverless SQLite, per-tenant) |
| **Entity resolution / per-tenant hot state / coordination** | **Durable Objects** (SQLite-backed, locks, WebSockets) |
| **Derivation-loop orchestration** | **Workflows** (durable execution) + **Queues** |
| **Beliefs/graph cache** | D1 + **Workers KV** |
| **Decision-app aggregation / metrics** | Workers + **Analytics Engine** (time-series) |
| **Identity, access, sensitivity** | **Cloudflare Access / Zero Trust**, WAF |
| **Real-time dashboards** | Durable Objects (WebSockets) + Workers |
| **Agentic apps / decision agents** | **Agents SDK** (stateful agents on Workers/DOs) |
| **Multi-tenant / customer deploy** | **Cloudflare for SaaS**, or deploy into the customer's own account |

*Note on models:* Workers AI covers embeddings + mid-size extraction LLMs; AI Gateway gives flexibility to route to larger/dedicated models when reasoning quality demands it. (MLX from the appliance plan is Apple-only and does **not** apply here — that's the later on-prem tier.)

---

## 3. What "private AI" means on Cloudflare (the deployment model)

**Hard rule: workrr one is ALWAYS deployed in the customer's own Cloudflare account.** There is no multi-tenant workrr-hosted option. This is the product's defining privacy guarantee.

- The software runs entirely in the **customer's own** Cloudflare account: their Workers, their D1, their R2, their Vectorize, their Durable Objects.
- **The customer's data never leaves their own cloud boundary.** It is never pooled with other customers, never sent to workrr, never sent to a model vendor (inference runs on Workers AI / their AI Gateway), and never used to train anyone's model.
- workrr builds, deploys, and operates the software *inside* the customer's tenant (like a forward-deployed team with keys to a room, not a landlord holding the data). Access is auditable and revocable.
- Data-localization and Zero Trust controls keep data in-region and access governed.

Honest framing: this is **cloud-private** — the customer owns the account and the data boundary, and nothing is shared or externalized. It is not *physically* on-premises; the later on-prem appliance tier is the only path to physical/air-gapped sovereignty, for regulated buyers who require it. For the target mid-market, customer-account deployment is the right privacy posture and ships now.

---

## 4. Palantir for business (positioning, unchanged)

- Palantir **Foundry** = ontology + data integration; **AIP** = decisions on top → workrr's **catalog** + **decision apps**.
- Palantir = millions of dollars, forward-deployed-engineer army, giant-enterprise only.
- **workrr = that shape, on Cloudflare, turnkey, for the mid-market Palantir ignores.** Services-led data wiring (Palantir-FDE-style, productized) + a catalog that compounds across every engagement.
- Line: *"Palantir for the companies Palantir will never call back — running privately on your own Cloudflare."*

---

## 5. Target market

- **Who:** mid-size businesses (~50–500 employees) with data scattered across M365/Google, a CRM/ERP, SQL, and files — and recurring cross-departmental "compile-then-decide" pain (§6).
- **Privacy posture:** care about control and not feeding a model vendor, but **cloud-comfortable** — they don't *need* on-prem. (The on-prem/regulated segment = later appliance tier.)
- **Cloud-native lean:** already on, or comfortable with, Cloudflare/modern cloud.
- **Buyer:** starts at a department head who owns one of the 1–7 rituals (VP Sales/Finance/Ops/CS); expands to C-suite once a decision app is indispensable.
- **workrr's edge with them:** Cloudflare expertise + services delivery = fast, private, done-for-you.

---

## 6. The decision apps (1–7), lightly

The Palantir-for-business core — recurring cross-departmental rituals turned into *open app → decide*. (Full treatment: [decision-apps doc](decision-apps-palantir-for-business.md).)

1. **Business Review** — always-live exec/board report across every department. *(Most universal ritual.)*
2. **True Profitability** — real margin by customer/product/project (revenue + cost + labor + delivery). *(Most "we don't actually know this.")*
3. **Account Intelligence** — churn/health/growth across the book (pipeline + support + payments + usage).
4. **Quote/Order-to-Cash** — end-to-end lifecycle; where revenue is stuck.
5. **Spend & Vendor Intelligence** — total spend, duplicates, renewal exposure.
6. **Capacity & Utilization** — demand (pipeline) vs. supply (people/time).
7. **Forecast Reality** — forecast grounded in the company's own history.

**Lead trio:** Business Review · True Profitability · Account Intelligence. Quick-hit apps (Search, Ask, Contract Reader) remain the low-friction **on-ramp** that connects the data; the decision apps are what make workrr indispensable.

---

## 7. Speed-to-revenue GTM (services-led)

1. **Land** a services engagement with one client: wire their data into a catalog on Cloudflare (posture 1 or 2), deliver **one decision app** (or a quick-hit on-ramp).
2. **Bill the engagement** — revenue now; the client funds the build.
3. **Reuse the catalog** across the next app/team/client — the IP compounds.
4. **Expand** into more decision apps → rise to the C-suite on something they can't unsee.
5. **Later**, package the repeatable stack as a product (multi-tenant SaaS on Cloudflare), and — if regulated demand appears — the on-prem appliance tier.

**One-line strategy:** private, Cloudflare-hosted "Palantir for business," delivered services-first for revenue now, with a catalog that compounds into a product.

---

## 8. Open items
- Pick the **first decision app** to build as the flagship engagement (lead trio).
- Decide default deployment posture for pilots (multi-tenant vs. customer-tenant).
- Confirm model strategy on Workers AI vs. AI Gateway for the extraction + reasoning tiers.
- Identify the first client/engagement to land it on (existing workrr relationship = fastest).
