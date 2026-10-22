# Collections demo script

A 5–7 minute walkthrough of the sample collections desk at `/demo/collections`. Use it with a collections agency or a medical or veterinary billing office. Stay with the synthetic book on the screen. Do not invent results, customer names, or savings figures.

## Before you open it

- Use the deployed One site, path `/demo/collections`.
- Every screen says **SAMPLE DATA**. Say that out loud once. The accounts, balances, transcript, and drafts are fictional. There are no real people in the book.
- The reminder and call-notes buttons try Workers AI through AI Gateway. If that is not configured, the screen keeps the prepared sample wording and says so. Keep going. The story does not depend on a live model.
- Nothing on these screens is sent, posted, or stored as a customer record.
- Leave the discovery questions for the end. They are for the buyer, not for the demo to answer.

If you only have five minutes: dashboard, the rejected ingest row, one priority reminder, the cease account (no draft), then the call summary.

## 1. Dashboard — about a minute

Open `/demo/collections`.

**Say:** This is a sample book for a desk that works past-due balances. Twelve accounts are in. One row from the batch was refused and is not in the totals. The lanes are the work for today: who can take a reminder, who already promised, who needs a person, and who should not be contacted automatically.

**Point at:** the receivable total, the “need a person” and “do not auto-contact” counts, and the queue. Mention that aging is just the sample dollars grouped by days past due.

**Pain:** Owners usually hear the past-due number as one pile. The workable calls, the promises, and the accounts that should sit still are mixed together, so the floor either works the top of a spreadsheet or waits for whoever calls in.

## 2. Ingest — about a minute

Open `/demo/collections/ingest`.

**Say:** The batch is a file that ships with the demo. There is no upload box, on purpose. Replay the check. Twelve rows join the book. One row is refused because the label is not a sample label, the office is blank, the balance is zero, and the reference is not a sample reference.

**Point at:** the rejected row, then one accepted row that carries a warning (dispute, hardship, cease, validation, or payer review).

**Pain:** Batches arrive messy. Staff rekey them, and a bad row can land in the same list as an account someone is about to text. The useful version of this step is a gate: what gets in, what is held, and what a person has to look at before anyone makes contact.

## 3. Prioritize — about a minute

Open `/demo/collections/prioritize`.

**Say:** Each account is in one lane. Inside a lane, a desk score orders the work. The points are written rules: how old the balance is, two balance bands, a promise due this week, and a sample cool-down after a recent contact. A model does not set this order, and it is not a credit score.

**Point at:** priority (quiet, higher balances), promises this week, the standard account still inside the cool-down, letter-only, human review, and do-not-contact.

**Pain:** A date-sorted list gives another touch to small balances that were just called, and it leaves a large quiet balance sitting. It also does not separate “do not contact” from “someone should read this before we ask for money.”

The 7-day pause is a rule of this sample desk. It is not a statement of Regulation F. An agency still has to map its own call windows and frequency limits.

## 4. Reminders — about a minute and a half

Open `/demo/collections/messages`.

**Say:** Start with the priority balance. The draft names the sample office, the account, the reference, and the balance. It tells the reader they can pay or say the balance is wrong. It says a person reviews it before anyone sends it. Click “Draft with Workers AI” if you want a live draft. If the badge stays on the prepared sample wording, say that the gateway is not connected in this environment and keep reading the sample.

**Then click:** Dispute, and read the line that says not to collect the disputed amount. Then click Cease. No draft is produced. That is the point.

**Pain:** Reminders get written from a blank page, or from a template that does not know about a dispute, a hardship note, a payer still in review, or a cease. The risk is not only a slow letter. It is a message that asks for the wrong thing.

**Do not say** the wording is approved, compliant, or ready to send. If the buyer is an agency, FDCPA and Regulation F disclosures, validation, and call rules have to be built into the template that actually goes out. If the buyer is a medical or veterinary office, HIPAA and state privacy rules are part of that design. This screen does not satisfy those rules, and Workrr does not certify compliance.

## 5. Call notes — about a minute

Open `/demo/collections/call`.

**Say:** This is one synthetic call on the veterinary account that promised $150.00 on October 24. Read the guarantor’s lines: the rest waits until the next paycheck, do not call before 5 p.m., email is better. The notes beside it are what the next person needs: the promise, the date, the next step, and those two preferences. The transcript is fixed. There is nowhere to paste a real call.

**Click** “Summarize with Workers AI” if you want to show the live path. The promise amount and date have to match the sample or the prepared summary stays.

**Pain:** The promise and the “don’t call before five” live in someone’s memory or in a free-text note the next person does not see. The next touch then contradicts the last conversation.

## Close

Come back to the dashboard queue if you want one picture to leave on screen.

What this demo is: a Cloudflare Worker on the same service as One, a fixed synthetic book, rules for who gets worked, and drafts or a call summary from Workers AI through AI Gateway when that gateway is configured.

What it is not: a claim about a named customer, a savings number, a credit score, or a compliance certification. Real account data, uploads, and pasted notes are intentionally absent.

## Discovery questions

Ask three or four. Let them answer.

1. Where do past-due accounts enter the office today, and what has to be true before a row is safe for someone to work?
2. Which accounts should a person see before any reminder goes out — disputes, hardship, payer review, cease, missing validation, or something else on your floor?
3. Who may approve a message, and which channels are actually consented? What should the system refuse to draft?
4. After a call, where do the promise, the contact preference, and the next step get written so the next person follows them?

## If they ask about compliance

Treat FDCPA, Regulation F, HIPAA, and state privacy rules as requirements their counsel and their own workflow have to settle before any real account is connected. Describe them as considerations for the design. Do not say the demo, the model, or Workrr is certified, approved, or “compliant” under those regimes. Do not quote a penalty, a fine, or a percentage from memory.
