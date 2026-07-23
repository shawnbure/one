# The OS — First-Hour Experience & Baked-In Applications

**Status:** Draft v0.1
**What the OS actually is:** the integrated software experience that turns the appliance into a working private-AI workplace in the **first hour** — *plug, configure, play* — and then hosts the tools employees use every day. It is **not** an abstract "AI OS," and it is **not** merely fleet management. Fleet ops (OTA, sealing, monitoring) are background substrate; the OS's *identity* is **connect everything → catalog everything → use everything, privately, on your own box.**
**Companions:** [business-sku-reference-architecture.md](business-sku-reference-architecture.md) · [business-knowledge-layer-spec.md](business-knowledge-layer-spec.md) · [appliance-hardware-strategy.md](appliance-hardware-strategy.md)

---

## 1. The OS's four responsibilities

1. **First-hour experience** — plug in, connect, and get value the same day. This is the value proposition.
2. **Cataloging** — import and catalog every connected company data system into the BKL. ("Catalog" is the customer-facing name for the two-plane knowledge layer.)
3. **Baked-in application suite** — the tools employees touch, all running on cataloged company data.
4. **Operational substrate** (background) — provisioning, OTA, monitoring, sealing. Necessary; not the identity.

Everything ships pre-installed: **open-source models + hardware + OS + apps**, sealed and private. Nothing to assemble.

---

## 2. The first hour — plug, configure, play

**Plug (minutes).** Rack/place the box, power, network. Secure boot + TPM attest; Fleet Agent phones home for license + config only — no business data moves.

**Configure (the first hour).** The only human step. An admin:
- connects identity/SSO,
- authorizes connectors (OAuth into Microsoft 365 / Google Workspace / CRM / etc.; points at file shares, databases, PBX),
- and that's it.

**Catalog (automatic, background).** The moment a source is connected the OS begins importing, resolving, and embedding everything into the BKL. The company's data becomes a single sourced, searchable catalog. Runs continuously thereafter.

**Play (immediately, deepening as the catalog fills).** Employees open the baked-in apps and start working. Answers get richer as cataloging completes — value on day one, compounding over weeks.

---

## 3. Cataloging — the bridge from connectors to value

"Import and catalog all company data" is the derivation loop (BKL spec §8) at product scale. Per source, the OS:

1. **Imports** — crawls records, files, messages, transcripts, database rows.
2. **Embeds** — content into the semantic plane (vectors) for retrieval.
3. **Extracts** — proposes structured `extracted` assertions against the Core ontology.
4. **Resolves** — entity resolution unifies the same customer/employee/account appearing across M365, the CRM, and the file system into one canonical entity.
5. **Catalogs** — the result is a live, sourced, deduplicated map of the whole company — people, customers, deals, documents, obligations, processes — with provenance and history.

The catalog *is* the moat: no individual source system has this unified, cross-connected, temporal view. The appliance does.

---

## 4. Connector catalog — the data that flows in

The OS ships with connectors for the systems a mid-size business already runs. Each is a plugin behind a stable contract; the marketplace extends the set.

| Category | Sources |
|---|---|
| Productivity suites | **Microsoft 365**, **Google Workspace** |
| Business systems | **CRM** systems, **ERP** systems, business applications |
| Data stores | **SQL databases**, **file systems** |
| Communications | **Email**, **calendars**, **PBX platforms** (transcripts as an ingest source — not a voice product) |
| Extensibility | generic **APIs**, custom connectors |

Connectors are bidirectional where useful: they read to catalog, and some write back (e.g. an email draft posted to the user's mailbox).

---

## 5. Baked-in application suite — the tools employees touch

All ship pre-installed, all run locally on cataloged company data, all are consumers of BKL contracts (spec §5) — proving the "second, third, Nth app on one BKL" reuse thesis out of the box.

| Baked-in tool | What it does | BKL contracts consumed |
|---|---|---|
| **Company Knowledge** | Unified, sourced answers about the business | `ask()`, `get()`, `explain()` |
| **Search** | Semantic + structured search across everything | retrieval over both planes, `neighbors()` |
| **Employee Copilot** | Per-employee assistant grounded in role + company data | `ask()` + agents, scoped by identity/sensitivity |
| **Workflow Generation** | Build and automate business processes | `Process`/`Rule` ontology, agents, connectors |
| **Email Drafting** | Context-aware drafts (who they are, history, obligations) | `ask()` context + generation, connector write-back |
| **Document Understanding** | Parse and interpret documents | derivation loop, `Document` entity |
| **Data Extraction** | Pull structured data from unstructured sources | derivation loop → `assert()` |
| **Internal Agents** | Autonomous tasks across connected systems | orchestration over connectors + BKL + tools |

Every one of these is impossible to do *well* without the catalog — which is exactly why the BKL had to exist first. The apps are the visible payoff of the invisible layer.

---

## 6. How it all sits together

```
   Connected systems                Baked-in apps (what employees touch)
   M365 · Google · CRM · ERP        Knowledge · Search · Copilot · Workflows
   SQL · Files · Email · Cal        Email drafting · Doc understanding
   PBX · APIs · Business apps        Data extraction · Internal agents
          │                                        ▲
          │  import + catalog                      │  ask / search / act
          ▼                                        │
   ┌──────────────────────────────────────────────────────────┐
   │  BKL "catalog": structured plane (ontology + assertions)  │
   │                 + semantic plane (vectors + prompts)      │
   └──────────────────────────────────────────────────────────┘
          running privately on the sealed appliance
          (open-source models pre-installed; data never leaves)
```

Connectors flow company data *in*; the catalog unifies it; baked-in apps turn it into work *out* — all on a box the company owns, with nothing leaving the premises.

---

## 7. Open items

- **Launch app set** — which of the eight baked-in tools ship in v1 vs. later? (Company Knowledge + Search + Copilot are the natural first three — they're the thinnest layer over the catalog and the clearest day-one value.)
- **Connector priority** — which sources first? (Microsoft 365 + Google Workspace + file systems cover the majority of mid-size data on day one.)
- **Catalog progress UX** — how the first-hour experience *shows* cataloging happening (trust + time-to-value depend on making the invisible visible).
- **Write-back scope** — which connectors are read-only vs. read-write at launch.
