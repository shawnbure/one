# Core Ontology Reference — Implementation Grade

**Status:** Draft v0.1
**Scope:** Structured plane, Core layer only. Vertical-agnostic by design — industry knowledge lives in the **semantic plane** (vectors + prompts), never as structured subtypes. See spec §0.5 and §1.
**Companion to:** [business-knowledge-layer-spec.md](business-knowledge-layer-spec.md)

This turns the Core layer from a table of names into a buildable data model: concrete attributes per entity type, the relationship catalog, and the physical storage schema for the assertion store.

---

## 1. Entity types — attributes

Every entity shares a common envelope, then adds type-specific intrinsic attributes. **Intrinsic attributes are stored as assertions**, not columns — the columns below are the *shape of the beliefs* apps read, not a physical table. This keeps everything sourced and temporal (per spec §2–3).

### Common envelope (all entities)

| Field | Type | Notes |
|---|---|---|
| `id` | ULID | canonical, immutable |
| `type` | enum | core type or domain-pack subtype |
| `tenant_id` | ULID | hard multi-tenant boundary |
| `aliases` | AliasRef[] | per-source external ids + name variants (entity resolution, spec §4) |
| `created_at` | timestamp | transaction time of first assertion |
| `sensitivity` | enum | default classification; per-assertion may override |

### `Party` (Person | Organization)

`display_name`, `party_kind` (person/org), `emails[]`, `phones[]`, `handles[]` (per channel), `org_membership` (→ relationships), `lifecycle_state` (lead/active/churned/…). Persons and orgs share the type so relationships (employs, contact-of) are uniform; `party_kind` discriminates.

### `Role`

`role_name`, `holder` (→ Party), `context` (→ any entity — the account/site/matter the role is scoped to), `granted_by`, temporal. A Role is *always* time-bounded and context-scoped — "account owner **of Acme** **since March**" — never a bare attribute on a Party.

### `Resource`

`resource_kind` (product/asset/license/capacity), `identifier` (SKU/serial), `unit`, `state`, `owned_by` (→ Party). Covers both sellable things and internal assets.

### `Event`

`event_kind`, `occurred_at` (valid time), `duration`, `participants[]` (→ Party via Role), `about[]` (→ any entities the event concerns), `outcome`. The workhorse type — calls, visits, purchases, status changes are all Events. High volume; see partitioning in §3.

### `Communication` (specializes `Event`)

`channel` (email/call/sms/chat), `direction`, `transcript_ref` (→ Document), `participants[]`, `thread_id`. The raw material `extracted` assertions are mined from.

### `Location`

`location_kind` (physical/logical), `address`, `geo`, `parent` (→ Location, for hierarchy). Sites, branches, regions, service areas.

### `Document`

`title`, `doc_kind`, `content_ref` (blob/object store), `embedding_ref`, `extracted_from[]` (provenance of extractions), `effective_period`. Source artifact for `extracted` assertions; also a retrieval target for `ask()`.

### `Obligation`

`obligation_kind` (SLA/contract term/subscription/promise), `owed_by` (→ Party), `owed_to` (→ Party), `terms`, `due` (state machine: pending/met/breached/waived), `governing_document` (→ Document). Makes commitments queryable — "which SLAs are at risk today?"

### `Process`

`process_name`, `steps[]` (ordered Activities), `applies_to`, `sla` (→ Obligation). A *template*; individual runs are Event chains linked to the Process.

### `Rule`

`rule_name`, `condition`, `effect`, `scope`, `precedence`, `source` (→ Document/human). Machine-evaluable policy — pricing, routing, entitlements. Feeds `computed`/`inferred` assertions.

---

## 2. Relationship catalog

Relationships are typed, directional, temporal, and themselves sourced (each is realized as an assertion where `object` is an entity ref). Cardinality and temporality are enforced by the belief-resolution policy, not the storage layer.

| Predicate | Domain → Range | Card. | Temporal | Notes |
|---|---|---|---|---|
| `employs` | Org → Person | 1..* | yes | end-dated on departure |
| `reports_to` | Person → Person | *..1 | yes | org chart, time-sliced |
| `member_of` | Party → Org | *..* | yes | generic affiliation |
| `is_customer_of` | Party → Org | *..* | yes | the relationship most apps hinge on |
| `holds_role` | Party → Role | *..* | yes | see `Role` scoping in §1 |
| `owns` | Party → Resource | *..* | yes | ownership/custody |
| `party_to` | Party → Obligation | 2..* | yes | both sides of a commitment |
| `participates_in` | Party → Event | *..* | no | occurred_at fixes the time |
| `about` | Event → any | *..* | no | what an event concerns |
| `located_at` | any → Location | *..1 | yes | |
| `governs` | Rule → any | *..* | yes | policy application |
| `derived_from` | Assertion → Assertion[] | *..* | — | inference provenance (spec §2) |
| `same_as` | Entity → Entity | — | — | entity-resolution merge; reversible |

**Design rule:** if a "fact about X" involves time, a second party, or a source, it is a **relationship or a scoped Role**, never a scalar attribute on X. Scalars are reserved for genuinely intrinsic, single-valued properties (a person's legal name). This is what keeps the graph answerable and the history intact.

---

## 3. Physical storage — resolving the substrate decision

The spec (§9) left storage open. Recommendation: **hybrid, single logical contract, two physical stores** — because the two access patterns are genuinely different shapes and forcing them into one store compromises both.

### Store A — Assertion Log (append-only, temporal)

The system of record. Every assertion ever made. Append-only; never updated in place (retraction is a new assertion). Time-series / columnar shaped.

```sql
CREATE TABLE assertions (
  id            BYTEA PRIMARY KEY,      -- ULID
  tenant_id     BYTEA NOT NULL,
  subject       BYTEA NOT NULL,         -- entity id
  predicate     TEXT  NOT NULL,
  object_ref    BYTEA,                  -- entity id, if value_type=entity
  object_value  JSONB,                  -- literal, otherwise
  value_type    TEXT  NOT NULL,
  valid_from    TIMESTAMPTZ NOT NULL,
  valid_to      TIMESTAMPTZ,            -- null = open
  observed_at   TIMESTAMPTZ NOT NULL,   -- transaction time
  method        TEXT  NOT NULL,         -- stated|extracted|inferred|computed|human
  confidence    REAL  NOT NULL,
  source        JSONB NOT NULL,         -- connector/record/extractor
  supersedes    BYTEA[],
  derived_from  BYTEA[],                -- for inferred/computed
  retracted     BOOL  NOT NULL DEFAULT false,
  sensitivity   TEXT  NOT NULL DEFAULT 'internal'
);
-- Partition by (tenant_id, observed_at month). Events/Communications dominate volume.
CREATE INDEX ON assertions (tenant_id, subject, predicate, valid_from DESC);
CREATE INDEX ON assertions (tenant_id, observed_at);   -- "what did we know as of T"
```

Postgres with monthly partitioning is a fine starting substrate; it defers the "do we need a dedicated columnar/TSDB engine" question until volume proves it, and the shape above ports cleanly if we do.

### Store B — Belief / Graph projection (read-optimized)

A materialized projection of *current* beliefs and entity topology, rebuilt from the log. This is the cache apps actually read; it can be dropped and fully rebuilt from Store A at any time (which is also the local-appliance sync primitive).

- Graph adjacency for `neighbors()` traversal.
- Current-belief rows keyed `(tenant, subject, predicate)` with `derived_from` back-pointers into Store A.
- Vector index (Store B-adjacent) over `Document`/`Communication` embeddings for `ask()` retrieval.

Start B as materialized views / a projection table in the same Postgres; graduate to a dedicated graph or vector engine behind the *same contract* only when traversal or ANN search proves it. The contract (spec §5) never changes when the substrate does — which is the whole point.

### Why not one store

- Assertion log is **append-heavy, immutable, time-indexed** — wants columnar/partitioned.
- Belief/graph layer is **read-heavy, mutable-by-rebuild, topology-indexed** — wants graph + ANN.
Forcing one engine to serve both compromises the audit trail *or* the query latency. Two physical stores, one logical contract, keeps the "swap the substrate without touching consumers" promise real.

---

## 4. Resolved vs. still-open

**Resolved here:**
- Storage substrate → hybrid, two stores, one contract (§3), Postgres-first.
- Intrinsic-vs-relationship boundary → §2 design rule.
- Bitemporal physical schema → §3 Store A.

**Still open (from spec §9), unchanged by "vertical TBD":**
- Embedding scope — Documents/Communications only vs. every entity. *Lean: start with Documents/Communications only.*
- Eager vs. lazy inference boundary — affects the appliance story; decide when the first app exists.
- Human-in-the-loop review queue — core service vs. first internal app.

**Reframed:** "Domain Packs" are semantic-plane bundles (prompt templates + curated vector content + extraction guidance), **not** structured schema. The Core types below already cover every industry — a "job", "matter", and "ticket" are all `Event`/`Process` instances distinguished in the semantic plane, not by new structured types. First pack deferred until a real customer supplies the prompts/documents. Core is complete enough to build the assertion store, the derivation loop, and the first connector against without it.
```
