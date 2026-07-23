# Frictionless Cataloging — Config, Click, Use

**Status:** Draft v0.1
**Question:** Can the moat (the catalog/BKL) be stood up by configuration and clicks — no per-customer engineering?
**Answer:** Yes, for ~80–90% automatically, with a bounded *confirm* surface for the rest — and **never per-customer code**. The enabler is the universal Core ontology, which turns per-customer *modeling* into automatable *mapping*.
**Companions:** [os-experience-and-apps.md](os-experience-and-apps.md) · [business-knowledge-layer-spec.md](business-knowledge-layer-spec.md) · [core-ontology-reference.md](core-ontology-reference.md)

---

## 1. Why it *can* be click-use (the key insight)

Most "AI over your data" projects need a data engineer because they model each business bespoke. Workrr doesn't, because:

- **The target schema is fixed and universal.** Every source record becomes a Core type (Party/Event/Resource/Obligation/Document/…). There is no per-customer schema to design.
- So onboarding a source is a **mapping** ("this Salesforce Contact → a `Party`; this field → `email`") not a **modeling** exercise.
- **Mapping is automatable by LLM.** The derivation loop *infers* the mapping from the source's structure + a sample of records, guided by semantic-plane prompts. The human never writes ETL.

**Modeling → mapping → automated.** That chain is the whole reason "config, click, use" is achievable.

---

## 2. The only three things a customer ever does

The interaction vocabulary is deliberately tiny. If a customer is ever asked to do a fourth thing (design a schema, write a mapping, script a rule), the design has failed.

| | Action | Effort | Example |
|---|---|---|---|
| **Connect** | Authorize a source | one click (OAuth / point-at) | "Connect Microsoft 365" → admin consent |
| **Confirm** | Approve/reject a *proposal* | one click, optional, improves over time | "Are these two 'J. Smith' the same person?" → Yes |
| **Consume** | Use the apps | zero setup | open Search / Knowledge / Copilot |

Never: "Configure a schema." Never: "Write a mapping." Never: "Edit code." The customer confirms proposals; they never author models.

---

## 3. Automatic vs. click vs. confirm

| Step | How it happens | Customer effort |
|---|---|---|
| Crawl a source | Pre-built connector (we author once, amortized) | **Click** to authorize |
| Map records → Core ontology | **LLM inference** from schema + sample records | **Automatic** |
| Extract facts from unstructured content | Derivation loop (prompts + models) | **Automatic** |
| Embed content (semantic plane) | Automatic on ingest | **Automatic** |
| Entity resolution (dedupe across sources) | Automatic above confidence threshold | **Automatic** (+ **confirm** the ambiguous) |
| Sensitivity / access defaults | Inherited from source-system permissions | **Automatic** (+ optional policy tweak) |
| Business terminology ("SOW", "our accounts live in NetSuite") | Optional glossary hints | **Confirm/type** a few, optional |

The default path is: **connect → walk away → come back to a built catalog with a short review queue.**

---

## 4. The config surface is declarative data, not code

Everything a customer can influence is versioned config (JSON/UI-edited), never a programming task:

- **Connector config** — which sources, scopes, what to include/exclude. (Click-driven; OAuth handles auth.)
- **Business glossary** — optional term hints that tune the semantic plane ("a 'ticket' here means a support case in Zendesk"). Plain text, feeds prompts. Not required for day-one value.
- **Access policy** — role → sensitivity mapping. Defaulted from source permissions; adjustable in a few clicks.

That's the entire knobset. No schema editor, no mapping DSL, no rules engine exposed to the customer.

---

## 5. Walkthrough — connecting Microsoft 365 (one click → a catalog)

1. Admin clicks **Connect Microsoft 365** → tenant admin consent (the one privileged step).
2. Connector crawls directory, mailboxes, SharePoint, Teams, calendar.
3. Derivation loop, all automatic:
   - Directory users → `Party(person)` (source: directory, `stated`, high confidence → auto-commit).
   - Emails → `Communication`; participants resolved to Parties; content embedded; deals/obligations mentioned → `extracted` assertions (lower confidence).
   - Calendar → `Event`s linked to Parties.
   - SharePoint files → `Document`s, embedded + extracted.
4. Entity resolution collapses "John Smith" (email) + "J. Smith" (CRM) + attendee → one `Party`. High-confidence auto; ambiguous → **review queue**.
5. Sensitivity inherited from SharePoint/mailbox permissions automatically.
6. Admin sees a **catalog dashboard**: "312 people, 47 customers, 8,900 documents cataloged · 6 merges to confirm."
7. Admin optionally confirms the 6 merges and types 2 glossary hints. Done.
8. Employees open Search / Knowledge / Copilot.

Total customer authoring: clicks + optionally a handful of confirms and two sentences. **Zero code, zero schema.**

---

## 6. Trust & progressive enhancement (why "good enough on day one")

Frictionless can't mean "wrong." The guards:

- **Confidence gating** — high-confidence assertions/merges auto-commit; low-confidence queue for confirm. Nothing dubious silently becomes "truth."
- **Provenance on everything** — every catalog fact cites its source; `explain()` unwinds it. Trust is inspectable, not asserted.
- **Progressive enhancement** — value on day one from defaults; accuracy compounds as more data flows and as admins confirm. Time-to-value is immediate; precision is a curve, not a gate.

---

## 7. The friction that genuinely remains (don't oversell)

- **Auth requires an admin with rights.** OAuth admin-consent, service accounts, DB credentials, file-share access — clicks, but a privileged person must click them. Real, minimal.
- **The review queue is non-zero.** Ambiguous merges and low-confidence mappings need human confirms. Bounded and shrinking, but not zero.
- **Access policy needs *a* decision.** Who sees what is a business call; we default hard from source permissions but can't make it literally zero-config.
- **We author connectors (once).** "No per-customer code" is true; "no code anywhere" is not — each connector is engineering we do once and amortize across all customers.
- **Long-tail weird data.** A small fraction of sources have genuinely odd structures; handled by connector-level config *we* author, never customer code.

None of these require the *customer* to engineer anything. That's the bar.

---

## 8. Why this makes horizontal mid-market viable

Because the Core ontology is universal, **the same connect→confirm→consume flow works for any mid-size business in any industry** — no vertical customization, no bespoke onboarding. That's precisely what lets Workrr go horizontal (the GTM decision) without a services army per deal. Vertical nuance, when needed, is optional semantic-plane glossary/prompt config — not a different onboarding.

---

## 9. The design guardrail (one rule to protect frictionless)

**Never show the customer a blank modeling canvas.** The moment onboarding exposes a schema editor or a mapping DSL, it becomes consulting and the horizontal thesis dies. The customer's ceiling is *confirm a proposal* and *type a glossary hint*. Everything else is automatic or a click. Hold this line.

---

## Open items
- Design the **review-queue UX** (the confirm surface) — it's the one place friction concentrates; making it fast and pleasant is high-leverage.
- Decide the **confidence thresholds** for auto-commit vs. queue (per assertion type).
- Design the **catalog dashboard** (the "watch it build" moment — trust + time-to-value).
- Prototype the **LLM mapping step** on a real M365/CRM sample — this is the core bet; validate mapping accuracy early.
