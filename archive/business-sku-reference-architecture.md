# Workrr One **Business** — Reference Architecture

**Status:** Draft v0.1
**What this is:** The concrete definition of the **lead SKU** — a single-node, rack-mounted private-AI appliance for a mid-size business. This is where the three strategy docs converge into one buildable thing an OEM can quote and an engineer can build against.
**Build posture:** Level 2 (OEM co-brand). Workrr specifies this reference, an OEM manufactures, Workrr images/seals/supports.
**Companions:** [appliance-hardware-strategy.md](appliance-hardware-strategy.md) · [business-knowledge-layer-spec.md](business-knowledge-layer-spec.md) · [core-ontology-reference.md](core-ontology-reference.md)

> SKU parts below are **representative** (training cutoff Jan 2026). Re-validate current models/prices before locking the BOM.

---

## 1. What the customer gets

A sealed rack node that powers on, attests, phones home, self-configures, and begins learning the business from its own communications and documents. No GPU assembly, no vector-DB install, no model wrangling. One box, one throat to choke, all data stays on it.

Capacity envelope (single Business node, target): **~100–300 users**, continuous background derivation, **low-tens concurrent `ask()` queries**, a knowledge graph spanning millions of assertions and documents accumulated over years. Outgrow it → upgrade to Enterprise (clustered), carrying the BKL Bundle across.

---

## 2. Hardware reference (BOM)

| Component | Reference spec | Rationale |
|---|---|---|
| Chassis | 2U rack, redundant hot-swap PSU | colo/on-prem standard; single-node simplicity |
| CPU | 1× server CPU, 32+ cores (EPYC / Xeon class) | connectors, extraction pre/post, DB, orchestration |
| RAM | 256 GB (512 GB option) | Postgres + graph/vector projections + OS headroom |
| **GPU** | **1× 48 GB (L40S / RTX 6000 Ada class); 2× option** | co-hosts 70B-4bit `ask()` + 8–32B extraction + embeddings |
| Data storage | 2× 3.84 TB NVMe (RAID1) | assertion log + graph + vectors + document blobs; fast + redundant |
| Boot storage | 2× M.2 NVMe, **A/B partitions** | atomic OTA with rollback (OS + runtime + models) |
| Security | TPM 2.0, secure boot, self-encrypting drives | sealed-appliance / "private" promise made physical |
| Network | 2× 10/25 GbE | LAN ingest + optional encrypted control-plane sync |

Single-GPU BOM target ≈ **$8k–$15k**. Razor/blades: hardware near cost, margin in the BKL + support subscription.

---

## 3. Software stack (firmware → apps)

Every layer above the OS runs as a service behind the BKL contracts — no privileged path (spec §5). "The OS" is scoped to the six fleet-serving duties (hardware-strategy §5), nothing grander.

```
┌──────────────────────────────────────────────────────────┐
│  Apps / API surface   (ask() UI, admin console, connectors mgmt) │
├──────────────────────────────────────────────────────────┤
│  BKL — two planes                                          │
│   • Structured: assertion log + belief/graph projection    │
│   • Semantic:   vector index + prompt templates            │
│   • Derivation loop: ingest → embed → extract → resolve    │
├──────────────────────────────────────────────────────────┤
│  Platform services (each a contract, no back door)         │
│   identity/SSO · connector runtime · inference server      │
│   (vLLM/TensorRT-LLM) · extraction workers · retrieval/ask │
├──────────────────────────────────────────────────────────┤
│  Data substrate                                            │
│   Postgres (assertion log, partitioned) · graph+vector     │
│   projection · object store (document/transcript blobs)    │
├──────────────────────────────────────────────────────────┤
│  Runtime: containerd / single-node k3s · GPU drivers       │
├──────────────────────────────────────────────────────────┤
│  Appliance OS: hardened immutable Linux, A/B image         │
│   + Fleet Agent (attest, phone-home, OTA, telemetry)       │
├──────────────────────────────────────────────────────────┤
│  Firmware: secure boot + TPM attestation                   │
└──────────────────────────────────────────────────────────┘
```

Local models on-box (representative): an embedding model (semantic plane), an 8–32B model for high-throughput extraction/derivation, and a 70B-class model for `ask()` reasoning — all served from the single 48 GB GPU, updated via OTA.

---

## 4. Boot-to-value sequence — "powers on and learns the business"

This is the frictionless-install promise, made concrete:

1. **Rack, power, network.** Physical install by customer IT — minutes.
2. **Secure boot + attest.** TPM measures the image; Fleet Agent phones home to the Workrr control plane and proves it's a genuine, unmodified appliance.
3. **License + config pull.** Control plane returns the tenant license and base config; box self-configures. (No data pulled *in* — only config; business data never leaves the box.)
4. **Light admin setup.** Admin connects identity/SSO and the **first source** (email, chat, file share, call-transcript feed).
5. **Derivation loop starts.** Connectors ingest → content embedded into the semantic plane → extraction proposes `extracted` assertions → entity resolution links them → high-confidence auto-commits, low-confidence queues for review.
6. **Value accrues.** Within hours the graph is populated; `ask()` returns sourced answers and improves as more history is ingested. The box is now a living model of the business.

Steps 1–3 are zero-touch. Step 4 is the only human configuration. Everything after is automatic.

---

## 5. Security & sealing (the "private" promise, physical)

- **Data never leaves the box.** Only encrypted telemetry + config sync traverse the control-plane link; business data and the BKL stay local. Air-gap mode disables even that.
- **Sealed & attested:** secure boot + TPM ensures only Workrr-signed images run; tamper is detectable.
- **Encrypted at rest:** self-encrypting drives, keys TPM-sealed.
- **Auditable remote support:** support access is explicit, scoped, logged — never silent.
- **Restore path:** a failed box is replaced (OEM RMA) and rehydrated from the customer's **BKL Bundle** (spec §6) — the Bundle is the backup/restore artifact and the upgrade-carry artifact.

---

## 6. Fleet & lifecycle

- **OTA (A/B):** OS, runtime, and **models** update atomically with automatic rollback; staged across the fleet so a bad update can't brick everyone (hardware-strategy §5.3, §6).
- **Monitoring:** health, GPU/capacity, model status, derivation backlog — surfaced to the Workrr control plane for a small ops team to watch thousands of boxes.
- **Upgrade path:** Business → Enterprise via BKL Bundle transfer when the customer outgrows a single node.

---

## 7. Open items

- **Launch OEM partner** — Supermicro vs. Dell for this 2U reference.
- **Inference server** — vLLM vs. TensorRT-LLM vs. hybrid; affects GPU choice and model set.
- **Single-node orchestration** — bare containerd vs. k3s (leaning k3s for a consistent path to the Enterprise clustered tier).
- **Model set** — exact embedding / extraction / reasoning models to ship and their OTA cadence.
- **BOM validation** — re-pull current GPU/CPU/NVMe SKUs and prices before quoting the OEM.
- **Business model confirm** — razor/blades pricing (hardware near cost, subscription margin).
```
