# Appliance & Hardware Strategy

**Status:** Draft v0.1
**Thesis:** The product Workrr One *sells* is a **private-AI appliance** for mid-size businesses that want AI hosted in-house or in their own datacenter — owned, sealed, and turnkey. The OS/BKL exist to make that appliance frictionless to install and survivable to operate at fleet scale. Hardware is the product; software is what makes the hardware shippable to thousands of customers without an army of field engineers.

**Companion to:** [business-knowledge-layer-spec.md](business-knowledge-layer-spec.md)

---

## 1. Customer & the two deployment contexts

**Customer:** mid-size business (~50–500 employees). Wants private AI for data sovereignty, compliance, and cost control. Has IT, but **not** an ML/infra team. Buys outcomes, not GPUs. Will not assemble a stack from a dozen vendors.

Two contexts the customer chooses between — this defines the product line:

- **In-house (on-prem):** a box in the office/server closet. Priorities: quiet, low power, small footprint, near-zero administration. A compact node.
- **Datacenter (colo / private cloud):** rack-mounted, redundant, higher throughput and concurrency. A server node, possibly clustered.

Same OS, same BKL, same experience across both — only the chassis and scale differ.

---

## 2. Build vs. assemble — the decision that shapes the company

Copy the part of Apple that's the **integrated experience**, not the part that's **fabricating silicon**. The realistic posture is **Level 2: a co-branded sealed appliance built on OEM hardware.**

| Level | Posture | Precedent |
|---|---|---|
| 0 | Software only, BYO hardware | commodity, no moat |
| 1 | Software + certified hardware list | Red Hat |
| **2** | **OEM (Supermicro/Dell/Apple) builds; we image, seal, brand, support** | **Nutanix, Cohesity, Rubrik** |
| 3 | Custom-designed hardware / own silicon | Apple — huge capital, earned by volume |

**Decision: Level 2.** OEM carries manufacturing, supply chain, and RMA logistics. Workrr owns the differentiated layer: OS, sealing/security, BKL, fleet management, and the turnkey experience. Level 3 is a later move justified only by volume, not a founding bet.

Implication: Workrr is a **software + integration + support** company that *delivers as hardware*. The hardware feels like the product to the customer; the margin and moat live in the integration and the BKL.

---

## 3. Inference economics — why one node serves a whole company

The load-bearing fact: **a mid-size business is not a hyperscale inference problem.** ~200 people produce a modest concurrent AI load — a handful of background derivation jobs (transcript/document → assertions, latency-tolerant, batchable) plus interactive `ask()` queries (latency-sensitive, low concurrency). A single well-specced node handles it.

Workload → hardware mapping:

| Task | Model class | Memory (4-bit) | Latency profile |
|---|---|---|---|
| Embeddings (semantic plane) | small (≤1B) | ~2 GB | cheap, batchable |
| Derivation/extraction | 8B–32B | ~6–20 GB | background, batchable |
| `ask()` reasoning | 70B-class (quality) | ~40–48 GB | interactive, low concurrency |

A single 48GB accelerator (or a unified-memory box) co-hosts all three for one company. **BOM ≈ $4k–$12k** — trivial against a mid-market contract. The appliance is economically viable on *today's* hardware, not a bet on future silicon.

> Note (2026): specific SKUs/prices below are representative and move fast — my training cutoff is Jan 2026, so re-validate current parts before committing. Ask me to pull live specs when we lock the SKU line.

---

## 4. Product line — SKUs mapped to real hardware

### Workrr One **Edge** — compact on-prem node
The "Mac Mini of enterprise AI." Sits in an office. Silent, low-power, zero-admin.
- Candidate platforms: **Apple Silicon (Mac Studio, large unified memory)** or **NVIDIA compact AI desktop (DGX Spark / GB10-class, ~128GB unified)**.
- Runs local derivation + `ask()` for a single site. Optional encrypted cloud sync.
- Target: small/mid business, branch offices.

### Workrr One **Business** — rack-mount single node
2U/4U server with 1–2 datacenter GPUs (e.g. L40S / RTX 6000 Ada 48GB class).
- Higher concurrency, multi-user, larger knowledge graph, more connectors.
- Colo or on-prem rack. Redundant storage.
- Target: the core mid-market buyer.

### Workrr One **Enterprise** — clustered / multi-node
Multiple GPU nodes (up to H100/next-gen class), HA, air-gap option, K8s under the hood.
- Larger graphs, higher throughput, strict compliance.
- On-prem, private cloud, or air-gapped.
- Target: upper mid-market / regulated.

**Same OS + BKL + experience across all three.** Tiering is chassis, concurrency, and scale — never a different product.

---

## 5. What the OS must deliver — operational substrate

The OS has two faces. Its **identity** is the first-hour experience + baked-in app suite ([os-experience-and-apps.md](os-experience-and-apps.md)) — that's what the customer buys. This section covers its other face: the **operational substrate** that keeps a hardware fleet alive. Both are required; neither alone is "the OS."

The operational duties:

1. **Zero-touch provisioning** — box powers on, phones home, self-configures, begins learning. The "frictionless install" promise made real.
2. **Fleet management & remote monitoring** — health, capacity, model status, alerts across thousands of boxes you'll never physically touch. This is the difference between a viable and an unviable support cost.
3. **Safe OTA updates** — atomic, rollback-capable updates of OS, runtime, **and models**, without breaking a box in a basement. (A/B image partitions.)
4. **Sealed-security model** — secure boot, TPM-backed identity, full-disk encryption, tamper evidence. The "private" promise made *physical* — the data never leaves and the box proves it.
5. **Graceful degradation & local autonomy** — the appliance keeps working with no cloud connection (air-gap / outage). Cloud is optional sync, never a dependency.
6. **Remote support & diagnostics** — secure, auditable remote access for support without violating the privacy model.

If the OS does these six things, the hardware business is operable by a small team. That is the entire justification for building an OS.

---

## 6. The hard problems of a hardware business (name them now)

- **Support & RMA:** physical failures need a replacement path. Level 2 pushes most of this to the OEM, but the *experience* of failure recovery (restore-from-sync onto a new box) is Workrr's to own — and the BKL Bundle (spec §6) is exactly the restore artifact.
- **Update risk:** a bad OTA can brick a fleet. A/B partitions + staged rollout + automatic rollback are non-negotiable (see §5.3).
- **Model lifecycle:** models improve constantly. The appliance must adopt new/better local models via OTA without the customer thinking about it — and without regressing their tuned behavior.
- **Supply chain & margin:** hardware margins are thin; the business model must put margin in software/subscription (the BKL, updates, support), with hardware near cost. Classic razor/blades.
- **Capacity mismatch:** a customer outgrows their tier. Need a clean upgrade path (Edge → Business) that carries the BKL Bundle across.

---

## 7. Decisions & open items

**Decided (2026-07-06):**
- **Build posture → Level 2 (OEM co-brand).** OEM manufactures; Workrr images/seals/brands/supports. Next: pick launch OEM partner(s).
- **Lead SKU → Workrr One Business** (rack single-node). Core mid-market buyer, standard NVIDIA GPU server, avoids Apple/edge-specific risk while proving the model. Reference architecture: [business-sku-reference-architecture.md](business-sku-reference-architecture.md).

**Still open:**
- **Business model** — recommend razor/blades (hardware near cost, margin in BKL + support subscription). Confirm.
- **Launch OEM partner** — Supermicro vs. Dell vs. other for the Business SKU.
- **Edge platform bet (later tier)** — Apple Silicon vs. NVIDIA compact (DGX Spark-class). Deferred; Business ships first.
- **Live hardware validation** — re-pull current 2026 SKUs/prices before locking the BOM.
```
