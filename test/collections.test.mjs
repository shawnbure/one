import test from "node:test";
import assert from "node:assert/strict";
import {
  accounts,
  batchRows,
  dashboard,
  fallbackCallSummary,
  fallbackDraft,
  money,
  sampleCsv,
  segmentPortfolio,
  transcriptText,
  validateBatch,
} from "../src/collections-sample.ts";

const channels = ["sms", "email", "letter"];
const pii = /@|\b\d{3}-\d{2}-\d{4}\b|\b\d{3}[-.)]\d{3}[-.]\d{4}\b/;

test("sample book is twelve synthetic accounts with stable lanes", () => {
  assert.equal(accounts.length, 12);
  assert.equal(new Set(accounts.map((account) => account.id)).size, 12);
  for (const account of accounts) {
    assert.match(account.guarantorLabel, /^Sample (guarantor|client|account) [A-Z]-\d{2}$/);
    assert.match(account.office, /Sample/);
    assert.match(account.reference, /SAMPLE/);
    assert.doesNotMatch(JSON.stringify(account), pii);
  }
  const book = dashboard();
  assert.equal(book.label, "SAMPLE DATA");
  assert.equal(book.asOf, "2026-10-22");
  assert.equal(
    book.totalCents,
    accounts.reduce((sum, account) => sum + account.balanceCents, 0),
  );
  assert.equal(money(book.totalCents), "$19,253.00");
  const lanes = Object.fromEntries(
    segmentPortfolio().map((lane) => [lane.id, lane.accounts.map((account) => account.id)]),
  );
  assert.deepEqual(lanes, {
    priority: ["ACC-4409", "ACC-4401"],
    promise: ["ACC-4408", "ACC-4402"],
    standard: ["ACC-4403", "ACC-4410"],
    letter: ["ACC-4412"],
    review: ["ACC-4411", "ACC-4404", "ACC-4406"],
    hold: ["ACC-4405", "ACC-4407"],
  });
});

test("bundled batch accepts the book and refuses the unnamed row", () => {
  const batch = validateBatch();
  assert.equal(batch.fileName, "sample-batch-2026-10-22.csv");
  assert.equal(batch.rowCount, 13);
  assert.equal(batch.accepted, 12);
  assert.equal(batch.rejected, 1);
  const rejected = batch.results.find((row) => row.status === "rejected");
  assert.equal(rejected.row.id, "ROW-13");
  assert.match(rejected.messages.join(" "), /Personal names are refused/);
  assert.match(rejected.messages.join(" "), /Office is required/);
  assert.match(rejected.messages.join(" "), /greater than zero/);
  assert.equal(sampleCsv().trim().split("\n").length, batchRows().length + 1);
  assert.doesNotMatch(sampleCsv(), pii);
});

test("drafts stay on consented channels and refuse cease or open validation", () => {
  const priority = fallbackDraft(accounts.find((account) => account.id === "ACC-4401"), "email");
  assert.equal(priority.blocked, false);
  assert.match(priority.text, /^SAMPLE DATA/);
  assert.match(priority.text, /ACC-4401/);
  assert.match(priority.text, /\$1,842\.50/);
  assert.match(priority.text, /Not sent|not delivered|Nothing in this demo is delivered/);
  assert.equal(fallbackDraft(accounts.find((account) => account.id === "ACC-4401"), "letter").blocked, true);
  const cease = fallbackDraft(accounts.find((account) => account.id === "ACC-4405"), "email");
  assert.equal(cease.blocked, true);
  assert.match(cease.reason, /Cease/);
  const validation = fallbackDraft(accounts.find((account) => account.id === "ACC-4407"), "email");
  assert.equal(validation.blocked, true);
  const dispute = fallbackDraft(accounts.find((account) => account.id === "ACC-4404"), "email");
  assert.equal(dispute.reviewRequired, true);
  assert.match(dispute.text, /disputed amount/i);
  assert.doesNotMatch(dispute.text, /You can pay the sample balance/);
  const promise = fallbackDraft(accounts.find((account) => account.id === "ACC-4408"), "sms");
  assert.match(promise.text, /\$150\.00/);
  for (const account of accounts) {
    for (const channel of channels) {
      const draft = fallbackDraft(account, channel);
      assert.doesNotMatch(`${draft.text}\n${draft.reason || ""}`, pii);
      assert.doesNotMatch(draft.text, /lawsuit|arrest|garnish|credit report/i);
      if (!draft.blocked && channel === "sms") assert.ok(draft.text.length <= 320, draft.text);
    }
  }
});

test("call summary uses only the fixed sample transcript", () => {
  const summary = fallbackCallSummary();
  assert.equal(summary.accountId, "ACC-4408");
  assert.equal(summary.promiseAmount, "$150.00");
  assert.equal(summary.promiseDate, "2026-10-24");
  assert.match(summary.nextAction, /5 p\.m\./);
  assert.match(transcriptText(), /next paycheck/);
  assert.match(transcriptText(), /not placed to a real person/);
  assert.doesNotMatch(transcriptText(), pii);
});
