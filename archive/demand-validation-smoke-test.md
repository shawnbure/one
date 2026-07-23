# Demand Validation — Smoke Test Plan

**Status:** Active experiment
**Why this exists:** After designing the whole platform top-down, we have strong evidence it's *buildable* and *coherent*, and **zero evidence anyone wants it.** This test buys a cheap, fast signal on desirability *before* writing code or buying hardware.
**Landing page:** [scratchpad/workrr-landing.html](../../../private/tmp/claude-501/-Users-shawnbure-Development-workrr-one/81e07c3f-a4cb-4ccb-91c0-7b7531107368/scratchpad/workrr-landing.html) · live preview: https://claude.ai/code/artifact/ea36f4a8-13c4-4fb7-bdf5-d5f07fea437b

---

## 1. What this test does and does NOT prove

- **Does:** whether the *message* is compelling enough that a real target visitor takes an action (gives a work email for early access). A read on message-pull.
- **Does NOT:** whether they'll pay, whether the pain is acute, or whether they'd tolerate an appliance. A strong result means **"keep going → do real conversations,"** not "validated."
- Treat a pass as a green light to interview, not to build.

## 2. Pre-register the threshold (decide now, before traffic)

Honesty requires committing the number *before* seeing results, or we'll rationalize.

- **Primary metric:** email conversion rate = (early-access emails) ÷ (unique visitors from the *target audience*).
- **Pass:** **≥ 6%** conversion over **≥ 300 targeted visitors** → the message pulls; proceed to customer interviews.
- **Weak:** 2–6% → message or audience is off; revise copy/targeting and re-run once.
- **Fail:** **< 2%** over 300+ targeted visitors → the message does not pull. Stop and rethink the premise, not the page.
- Guardrail: junk/personal-email signups don't count. Ask for a **work email**; discard free-mail domains from the numerator.

*(6% is a deliberately honest bar for a cold B2B early-access ask — high enough to mean something, low enough to be reachable if the pain is real.)*

## 3. The message being tested

- **Core promise:** connect your scattered systems into *one private, living model of your business* your whole team can ask, search, and act on — installs in an afternoon, data never leaves the building.
- **The wedge against the real competitor (Microsoft/Google Copilot):** "An assistant reads one app at a time. Workrr understands the whole business." This is the crux — if this contrast doesn't land, the whole thesis is weak, because Copilot is free-ish and already installed.
- **Proof points:** unified/entity-resolved catalog (the moat), private appliance, every answer sourced.

## 4. Optional but recommended: A/B the two demand hypotheses

We're unsure whether demand is **horizontal** (any mid-size team, "know your business") or **acute in regulated/data-sensitive** shops (privacy = painkiller). Run two headline variants to the same funnel:

- **A — Horizontal:** "Your business already knows the answer. It's just scattered across a dozen systems." (current page)
- **B — Sovereignty:** "Private AI that knows your business — and never sends a byte to the cloud." (lead with data control)

Whichever converts materially better tells you *where the pain is*, which directly informs the GTM decision you made earlier.

## 5. Deployment (make it capture leads + measure)

The Artifact preview can't capture emails (sandboxed). To run the real test:

1. Host the page: Carrd, Framer, Vercel, or Netlify (wrap the file in a full `<!doctype html>` document).
2. Wire the form to a real endpoint: **Tally** or **Formspree** (both free) — replace the `// DEPLOY:` stub in the page's script.
3. Add privacy-friendly analytics: **Plausible** or GA4 — track unique visitors + a `signup` event on submit.
4. Buy a domain (e.g. workrr.ai already owned) and point it at the page.

## 6. Drive *targeted* traffic (not randoms — randoms invalidate the test)

The number only means something if visitors resemble buyers (mid-size ops/IT/GM). Sources:

- **LinkedIn** — a founder post + a small paid campaign targeted by company size (50–500) and role (owner/COO/IT director).
- **Warm network** — email/DM people who fit the profile; ask them to react honestly.
- **Relevant communities** — ops/IT/vertical Slack/Discord/subreddits where self-promo is tolerated.
- **Small ad budget** ($300–500) to reach the 300 targeted visitors quickly.

## 7. Decision rule

- **Pass → interview.** Book 8–12 conversations with the people who signed up. *Now* test willingness-to-pay, pain acuity, and appliance tolerance. That's the real validation; this was the gate to it.
- **Weak → one revision.** Change the headline/audience per §4, re-run once. Don't iterate forever on a smoke test.
- **Fail → stop and rethink the premise.** The idea isn't wrong because a page underperformed, but a cold audience not clicking a sharp promise is a real signal that the pain isn't top-of-mind. Reconsider segment (regulated?) or whether this is a product at all.

## 8. Timeline
~1 week: deploy (½ day) → drive traffic (3–5 days) → read results against §2 → decide. Cheaper than one day of building the wrong thing.
