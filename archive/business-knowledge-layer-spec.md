# Business Knowledge Layer (BKL) — Core Specification

**Status:** Draft v0.1
**Role in the platform:** The permanent IP. Everything else (LLMs, vector stores, connectors, apps, the appliance) is a replaceable implementation detail. The BKL is the one asset that compounds and must outlive every underlying technology.

**Design mandate:** A durable, portable, auditable representation of *how a specific business actually works*, that apps consume through a stable contract and that a customer can carry with them even if every other component is swapped.

---

## 0. The five properties that make it defensible

If the BKL has these five properties, it's IP. If it's missing any, it's a database.

1. **Durable** — models the business, not the tools. Survives an LLM swap, a DB swap, a connector rewrite.
2. **Portable** — exportable to an open format the customer owns (the "Knowledge Bundle"). This makes "you own your knowledge" literally true, and paradoxically *increases* lock-in because it earns trust.
3. **Auditable** — every fact traces to a source, a time, and a method. No un-sourced assertions.
4. **Temporal** — knows not just what's true, but *when* it was true and *when we learned it*. This is the hard, defensible part.
5. **Reusable across apps** — the same layer answers many apps (CRM, scheduler, analytics). Proving this reuse is the moment the platform thesis is validated.

---

## 0.5 The two knowledge planes

The most important structural decision: the BKL is **two planes with different physics**, bridged at query time. Conflating them is the classic mistake.

| | **Structured plane** | **Semantic plane** |
|---|---|---|
| Contents | Core ontology + temporal assertions/beliefs | Vector embeddings + prompt templates |
| Physics | Deterministic, queryable, auditable, temporal | Fuzzy, similarity-based, generative |
| Answers | "Who is the account owner, and since when?" | "How do businesses like this usually handle X?" |
| Changes | Slowly; universal across all customers | Fast; this is where **verticalization lives** |
| Owned by | The platform (core service) | Configured per vertical/tenant (content + prompts) |

**Vertical and domain knowledge does NOT live in the ontology.** It lives in the semantic plane — as curated vector content and prompt templates. The platform provides *horizontal core services* (identity, the structured Core, extraction, retrieval, memory, connectors); an industry is a *configuration* of the semantic plane on top of those services, not a new set of entity types. This is what keeps the structured Core small, universal, and permanently reusable.

`ask()` (§5) is the bridge: it retrieves from the semantic plane **and** queries the structured plane, then reasons over both — grounding fuzzy domain expertise in precise, sourced facts.

---

## 1. The structured plane — Core ontology

The central tension: a rigid universal schema doesn't fit real businesses; a freeform graph isn't reusable or queryable. The resolution is a **small universal Core plus thin per-tenant extensions** — with all industry specialization pushed out to the semantic plane (§0.5), not modeled here.

### Layer 1 — Core (universal, the reusable IP)

Every business, in every industry, is built from a small set of primitives. This layer is fixed and is the intellectual property.

| Type | Meaning | Examples |
|---|---|---|
| `Party` | An actor — person or organization | employee, customer, vendor, lead |
| `Role` | A capacity a Party holds in a context | "account owner", "primary contact", "technician" |
| `Relationship` | A typed, temporal link between Parties | employs, reports-to, is-customer-of |
| `Resource` | Something owned, sold, or used | product, SKU, asset, license, room, vehicle |
| `Event` | Something that happened at a time | call, meeting, purchase, service visit, status change |
| `Communication` | A specific message exchange | email, call transcript, SMS, chat |
| `Location` | Physical or logical place | site, branch, address, region |
| `Document` | A source artifact | contract, invoice, policy PDF, spec |
| `Obligation` | A commitment with terms and a due state | SLA, contract term, subscription, promise-to-customer |
| `Process` | A repeatable sequence of Activities | onboarding, dispatch, renewal, escalation |
| `Rule` | A policy or constraint that governs behavior | "gold customers get 4-hour response", pricing rules |

Core relationships are themselves first-class and temporal (see §2).

### Layer 2 — Tenant Extensions (per-customer, thin)

Customer-specific *structured* fields ("we track `franchisee_region` on every account"). Stored as tenant-scoped schema deltas so a customer's peculiarities never pollute the Core. Kept deliberately thin — most customer specificity should live in the semantic plane, not as new columns.

**Rule:** a concept graduates from Tenant → Core only with strong evidence that it's truly universal. Keeps the Core small and permanently reusable.

### Where domain/vertical knowledge actually lives — the semantic plane

Industry expertise is **not** modeled as ontology subtypes. There is no "healthcare schema" or "home-services schema" in the structured plane. Instead a **Domain Pack** is a semantic-plane bundle, distributed as a plugin and a natural marketplace unit:

- **Prompt templates** — how to interpret, extract from, and reason about this industry's language ("in HVAC, a 'no-cool call' means…").
- **Curated vector content** — reference material, playbooks, regulations, best practices, embedded for retrieval.
- **Extraction guidance** — what to pull out of this vertical's transcripts and documents into Core assertions, and how.
- **Retrieval/answer config** — default `ask()` behavior for the vertical.

A Domain Pack *configures* the horizontal core services; it does not extend the structured ontology. The Core types (`Party`, `Event`, `Communication`, `Obligation`, …) already cover every industry — a "job", a "matter", and a "ticket" are all `Event`/`Process` instances distinguished by semantic-plane interpretation, not by new structured types. **Do not build packs speculatively** — author the first from a real customer's prompts and documents.

---

## 2. The Assertion model — the heart of the system

The single most important design decision: **facts are first-class objects, not graph edges.** A graph stores "the current answer." An assertion store remembers *every claim, who made it, when, and why* — and derives the current answer from that. This is what makes the BKL auditable and temporal.

### The Assertion

```jsonc
{
  "id": "asrt_01H...",
  "subject": "party_acme_corp",          // entity ref
  "predicate": "primary_contact",        // from ontology
  "object": "party_jane_doe",            // entity ref OR literal value
  "value_type": "entity",                // entity | scalar | money | date | text | enum

  // --- Bitemporality: two independent time axes ---
  "valid_from": "2026-01-01T00:00:00Z",  // when this became true IN THE WORLD
  "valid_to":   null,                     // null = still true
  "observed_at":"2026-07-06T14:22:00Z",   // when WE learned it (transaction time)

  // --- Provenance: the trust chain ---
  "source": {
    "connector": "salesforce",
    "record": "Contact/003xx",
    "extractor": "connector.sfdc.v3"
  },
  "method": "stated",                     // stated | extracted | inferred | computed | human
  "confidence": 0.98,                     // 0..1
  "asserted_by": "principal_or_system",

  // --- Lifecycle ---
  "supersedes": ["asrt_01G..."],          // explicit override chain
  "retracted": false,
  "sensitivity": "internal"               // public | internal | confidential | restricted
}
```

### Why bitemporality matters (the sophisticated, defensible bit)

Two independent time axes:

- **Valid time** — when the fact was true in the real world.
- **Transaction time** — when the system learned it.

This lets the BKL answer questions no ordinary database can:
- "What did we *believe* about this customer's contract on the day we made that decision?" (transaction time)
- "Who was the account owner *in March*?" (valid time)
- "This invoice was backdated — show me when we actually received the information." (both)

For AI decisions this is not a nice-to-have. It's what makes the system *auditable* and *defensible in a dispute*, and it's genuinely hard to retrofit — so build it in from assertion #1.

### Assertion `method`, ranked by trust

`human` (a person confirmed it) > `stated` (a system of record declared it) > `extracted` (pulled from a document/transcript) > `inferred` (reasoned by the platform) > `computed` (derived/aggregated). Inferred and computed assertions must cite the assertions they derive from, so any conclusion can be unwound to ground truth.

---

## 3. Beliefs — the queryable "current truth"

Apps don't want to sift raw assertions. They want the answer. A **Belief** is the platform's current best answer for a `(subject, predicate)` pair, materialized from the underlying assertions by a resolution policy.

```jsonc
{
  "subject": "party_acme_corp",
  "predicate": "primary_contact",
  "current": "party_jane_doe",
  "confidence": 0.98,
  "as_of": "2026-07-06T14:22:00Z",
  "derived_from": ["asrt_01H...", "asrt_01F..."],
  "conflicts": []                          // populated when sources disagree
}
```

**Resolution policy** (how conflicting assertions collapse to one belief):
1. Filter to valid (not retracted, `valid_to` covers the query time).
2. Rank by **source trust × recency × confidence**.
3. Highest wins → becomes `current`; the rest are retained and surfaced under `conflicts`.

Reads hit beliefs (fast, cached). Audits drill into assertions (complete, slow). Both are always available. This read/write split is also the natural cache boundary for local-vs-cloud execution later.

---

## 4. Entity Resolution — the other half of the moat

Real businesses have the same customer in five systems under four spellings. Turning those into *one* `Party` is entity resolution, and it's as much of the moat as bitemporality.

- Every entity has one canonical id plus **aliases** (per-source external ids and name variants).
- Resolution runs on ingest: blocking → candidate scoring (deterministic keys + fuzzy + embedding similarity) → merge above threshold, else queue for human review.
- Merges are themselves **assertions** (`method: inferred`, reversible). A bad merge can be split without data loss.
- Domain packs supply resolution hints (e.g. healthcare uses MRN; SaaS uses account domain).

Without this, the graph fragments and every downstream answer is wrong. With it, the BKL becomes the single source of truth that no individual source system is.

---

## 5. The consumption contract (stable API surface)

Apps never touch storage. They consume the BKL through these contracts only — this is the "no privileged path" principle applied where it matters (the API, not necessarily the runtime). Every read carries provenance.

```
resolve(ref)                     -> canonical Entity (+ aliases)
get(entity, aspect?)             -> Belief[] with provenance
neighbors(entity, relation, f?)  -> Entity[] (typed graph traversal)
ask(nl_query, context)           -> Answer { text, citations[], confidence }
assert(fact, source)             -> AssertionId   (the ONLY write path)
subscribe(pattern)               -> change stream (belief-level deltas)
explain(belief_or_answer)        -> full provenance trace to ground assertions
history(entity, predicate, at?)  -> temporal series across both time axes
```

Design notes:
- `ask()` is the LLM-facing surface: retrieval over the graph + documents, reasoned answer, **mandatory citations** back to assertions. No citation → not returned.
- `assert()` is the single write path. Everything — a connector sync, a human edit, an inference — enters as an assertion. There is no back door that mutates beliefs directly. This is what keeps the audit trail complete.
- `explain()` is the trust feature and a product differentiator: any answer unwinds to sourced facts.

---

## 6. Portability — the Knowledge Bundle

The promise "you own your business knowledge" is only real if it's exportable to an open format independent of Workrr's runtime.

- **Knowledge Bundle** = ontology version + all assertions + entity/alias tables + resolution history + belief snapshots, in an open, documented serialization (line-delimited JSON + a manifest; graph as an open interchange format).
- Fully re-importable to reconstruct state on any conformant runtime.
- This is the ultimate expression of the platform thesis: LLMs, DBs, and clouds change; **the Bundle does not.** It's also the honest backstop that makes enterprises willing to commit — and, counterintuitively, the strongest trust-based lock-in you can build.

---

## 7. Access & sensitivity

Knowledge is sensitive; retrieval must be policy-filtered per requesting principal.

- Every assertion carries a `sensitivity` classification.
- Reads are filtered by the requesting principal's clearance *before* results are formed — including inside `ask()`, so the reasoning layer can never leak a restricted fact into a generated answer.
- Ties into the platform's identity/security services (which the platform owns), consumed here as just another contract.

---

## 8. What to build first (proving order)

Do **not** build the whole platform, domain packs, or the plugin system up front. The wedge is the **derivation engine**: point the platform at a business's own communications and documents, and watch it build a living, sourced model of the business automatically. This forces the BKL into existence by necessity and is compelling on its own ("we listen to how your business actually runs and turn it into structured, queryable knowledge").

1. **Core types only** (§1 Layer 1) + the **assertion store** with bitemporality (§2). Monolithic, in-process. No premature distribution.
2. **Beliefs + resolution policy** (§3) and basic **entity resolution** (§4).
3. **The derivation loop:** ingest `Communication`/`Document` sources — **transcripts (incl. voice, as a transcript source — not a voice-agent product), emails, chats, files** — into the raw store, embed them into the semantic plane, and run extraction into `extracted` assertions on the structured plane. One connector is enough to start. This is the wedge.
4. Add a **second consumer** on the *same* BKL (e.g. a retrieval/`ask()` surface, then a CRM-style view). When it reuses the layer without a rewrite → **platform thesis proven.**
5. Only now extract stable contracts (§5), the first **Domain Pack** (semantic-plane prompts + vectors, §1), and the **Bundle** (§6). Plugins and marketplace follow from real seams, not imagined ones.

Note: voice is deliberately **not** a headline product here. It enters the system exactly like any other communication — as a transcript to derive data from.

---

## 9. Open decisions (need answers before implementation)

- **Storage substrate:** native graph DB vs. relational-with-graph-views vs. hybrid (graph for topology + columnar for temporal assertion history). The assertion log is append-heavy and time-series-shaped; the belief layer is read-heavy and graph-shaped. These may want different stores behind one contract.
- **Embedding strategy:** where do vectors live relative to assertions — attached to Documents/Communications only, or to every entity?
- **Inference boundary:** what's computed eagerly on ingest (materialized beliefs) vs. lazily at query time (`ask`-time reasoning)? Affects the local-appliance story directly.
- **First domain pack:** which industry is the design partner? That choice shapes Layer 2 and entity-resolution hints.
- **Human-in-the-loop:** the review queue for low-confidence merges and conflicting beliefs — is that a core service or the first internal app on top of the BKL?
```
