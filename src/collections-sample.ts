/** Synthetic collections book for the sales demo. No real people or contact data. */

export const AS_OF = "2026-10-22";
export const AS_OF_LABEL = "October 22, 2026";
export const DEMO_OFFICE = "Northline Sample Billing";
export const SAMPLE_LABEL = "SAMPLE DATA";

export type Kind = "medical-billing" | "veterinary" | "commercial";
export type Consent = "sms-and-email" | "email-only" | "mail-only" | "none";
export type Flag =
  | "dispute"
  | "hardship"
  | "cease-requested"
  | "validation-pending"
  | "promise-to-pay"
  | "insurance-pending";
export type Channel = "sms" | "email" | "letter";
export type LaneId =
  | "priority"
  | "promise"
  | "standard"
  | "letter"
  | "review"
  | "hold";

export interface SampleAccount {
  id: string;
  office: string;
  kind: Kind;
  guarantorLabel: string;
  balanceCents: number;
  daysPastDue: number;
  lastContactDaysAgo: number | null;
  promiseToPayDate: string | null;
  promiseAmountCents: number | null;
  contactConsent: Consent;
  flags: Flag[];
  reference: string;
  payer: string;
}

export interface BatchRow {
  id: string;
  office: string;
  kind: string;
  guarantorLabel: string;
  balanceCents: number;
  daysPastDue: number;
  lastContactDaysAgo: number | null;
  promiseToPayDate: string | null;
  promiseAmountCents: number | null;
  contactConsent: string;
  flags: string[];
  reference: string;
  payer: string;
}

export const accounts: SampleAccount[] = [
  {
    id: "ACC-4401",
    office: "Cedar Sample Family Practice",
    kind: "medical-billing",
    guarantorLabel: "Sample guarantor G-14",
    balanceCents: 184250,
    daysPastDue: 76,
    lastContactDaysAgo: 21,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "sms-and-email",
    flags: [],
    reference: "ENC-SAMPLE-2044",
    payer: "Patient responsibility",
  },
  {
    id: "ACC-4402",
    office: "Harbor Sample Veterinary",
    kind: "veterinary",
    guarantorLabel: "Sample client C-07",
    balanceCents: 64000,
    daysPastDue: 18,
    lastContactDaysAgo: 4,
    promiseToPayDate: "2026-10-24",
    promiseAmountCents: 20000,
    contactConsent: "email-only",
    flags: ["promise-to-pay"],
    reference: "VIS-SAMPLE-1180",
    payer: "Client balance",
  },
  {
    id: "ACC-4403",
    office: "Northline Sample Billing",
    kind: "commercial",
    guarantorLabel: "Sample account A-03",
    balanceCents: 8550,
    daysPastDue: 34,
    lastContactDaysAgo: 12,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "email-only",
    flags: [],
    reference: "INV-SAMPLE-3301",
    payer: "Open invoice",
  },
  {
    id: "ACC-4404",
    office: "Cedar Sample Family Practice",
    kind: "medical-billing",
    guarantorLabel: "Sample guarantor G-22",
    balanceCents: 212000,
    daysPastDue: 96,
    lastContactDaysAgo: 9,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "sms-and-email",
    flags: ["dispute"],
    reference: "ENC-SAMPLE-2219",
    payer: "Patient responsibility",
  },
  {
    id: "ACC-4405",
    office: "Harbor Sample Veterinary",
    kind: "veterinary",
    guarantorLabel: "Sample client C-19",
    balanceCents: 41000,
    daysPastDue: 45,
    lastContactDaysAgo: 30,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "none",
    flags: ["cease-requested"],
    reference: "VIS-SAMPLE-1214",
    payer: "Client balance",
  },
  {
    id: "ACC-4406",
    office: "Cedar Sample Family Practice",
    kind: "medical-billing",
    guarantorLabel: "Sample guarantor G-31",
    balanceCents: 156000,
    daysPastDue: 62,
    lastContactDaysAgo: 6,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "mail-only",
    flags: ["hardship"],
    reference: "ENC-SAMPLE-2302",
    payer: "Patient responsibility",
  },
  {
    id: "ACC-4407",
    office: "Cedar Sample Family Practice",
    kind: "medical-billing",
    guarantorLabel: "Sample guarantor G-08",
    balanceCents: 98000,
    daysPastDue: 40,
    lastContactDaysAgo: null,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "email-only",
    flags: ["validation-pending"],
    reference: "ENC-SAMPLE-1988",
    payer: "Patient responsibility",
  },
  {
    id: "ACC-4408",
    office: "Harbor Sample Veterinary",
    kind: "veterinary",
    guarantorLabel: "Sample client C-11",
    balanceCents: 27500,
    daysPastDue: 22,
    lastContactDaysAgo: 1,
    promiseToPayDate: "2026-10-24",
    promiseAmountCents: 15000,
    contactConsent: "sms-and-email",
    flags: ["promise-to-pay"],
    reference: "VIS-SAMPLE-1240",
    payer: "Client balance",
  },
  {
    id: "ACC-4409",
    office: "Harbor Sample Veterinary",
    kind: "veterinary",
    guarantorLabel: "Sample client C-28",
    balanceCents: 326000,
    daysPastDue: 128,
    lastContactDaysAgo: 16,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "sms-and-email",
    flags: [],
    reference: "VIS-SAMPLE-0991",
    payer: "Client balance",
  },
  {
    id: "ACC-4410",
    office: "Cedar Sample Family Practice",
    kind: "medical-billing",
    guarantorLabel: "Sample guarantor G-40",
    balanceCents: 54000,
    daysPastDue: 27,
    lastContactDaysAgo: 2,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "sms-and-email",
    flags: [],
    reference: "ENC-SAMPLE-2401",
    payer: "Patient responsibility",
  },
  {
    id: "ACC-4411",
    office: "Northline Sample Billing",
    kind: "commercial",
    guarantorLabel: "Sample account A-16",
    balanceCents: 742000,
    daysPastDue: 110,
    lastContactDaysAgo: 19,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "email-only",
    flags: ["insurance-pending"],
    reference: "INV-SAMPLE-2877",
    payer: "Payer review",
  },
  {
    id: "ACC-4412",
    office: "Cedar Sample Family Practice",
    kind: "medical-billing",
    guarantorLabel: "Sample guarantor G-02",
    balanceCents: 12000,
    daysPastDue: 51,
    lastContactDaysAgo: 15,
    promiseToPayDate: null,
    promiseAmountCents: null,
    contactConsent: "mail-only",
    flags: [],
    reference: "ENC-SAMPLE-1760",
    payer: "Patient responsibility",
  },
];

export const rejectedRow: BatchRow = {
  id: "ROW-13",
  office: "",
  kind: "medical-billing",
  guarantorLabel: "NAME-REDACTED",
  balanceCents: 0,
  daysPastDue: 10,
  lastContactDaysAgo: null,
  promiseToPayDate: null,
  promiseAmountCents: null,
  contactConsent: "email-only",
  flags: [],
  reference: "MISSING",
  payer: "Patient responsibility",
};

export const lanes: { id: LaneId; title: string; blurb: string }[] = [
  {
    id: "priority",
    title: "Priority outreach",
    blurb:
      "Higher sample balance, a consented channel, and no contact in the sample cool-down window.",
  },
  {
    id: "promise",
    title: "Promises this week",
    blurb: "A payment date is already written on the sample account.",
  },
  {
    id: "standard",
    title: "Standard digital",
    blurb: "Smaller balances that can take email or SMS.",
  },
  {
    id: "letter",
    title: "Letter only",
    blurb: "Mail is the only consented channel.",
  },
  {
    id: "review",
    title: "Human review",
    blurb: "Dispute, hardship, or an open payer review. A person goes first.",
  },
  {
    id: "hold",
    title: "Do not auto-contact",
    blurb: "Cease, no consented channel, or validation still open.",
  },
];

const kinds = ["medical-billing", "veterinary", "commercial"] as const;
const consents = ["sms-and-email", "email-only", "mail-only", "none"] as const;
const knownFlags = [
  "dispute",
  "hardship",
  "cease-requested",
  "validation-pending",
  "promise-to-pay",
  "insurance-pending",
] as const;

const labelPattern = /^Sample (guarantor|client|account) [A-Z]-\d{2}$/;
const referencePattern = /^(ENC|VIS|INV)-SAMPLE-\d{4}$/;

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function prettyDate(iso: string): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${months[month - 1]} ${day}, ${year}`;
}

export function daysUntil(iso: string): number {
  const start = Date.parse(`${AS_OF}T00:00:00Z`);
  const end = Date.parse(`${iso}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

export function kindLabel(kind: string): string {
  if (kind === "medical-billing") return "Medical billing";
  if (kind === "veterinary") return "Veterinary";
  if (kind === "commercial") return "Commercial";
  return kind;
}

export function consentLabel(consent: string): string {
  if (consent === "sms-and-email") return "SMS and email";
  if (consent === "email-only") return "Email only";
  if (consent === "mail-only") return "Mail only";
  if (consent === "none") return "No channel on file";
  return consent;
}

export function flagLabel(flag: string): string {
  const labels: Record<string, string> = {
    dispute: "Dispute open",
    hardship: "Hardship note",
    "cease-requested": "Cease requested",
    "validation-pending": "Validation pending",
    "promise-to-pay": "Promise to pay",
    "insurance-pending": "Payer review open",
  };
  return labels[flag] || flag;
}

export function channelLabel(channel: Channel): string {
  if (channel === "sms") return "SMS";
  if (channel === "email") return "Email";
  return "Letter";
}

export function allowedChannels(consent: string): Channel[] {
  if (consent === "sms-and-email") return ["sms", "email"];
  if (consent === "email-only") return ["email"];
  if (consent === "mail-only") return ["letter"];
  return [];
}

export function accountById(id: string): SampleAccount | undefined {
  return accounts.find((account) => account.id === id);
}

export function deskScore(account: SampleAccount): number {
  let score = Math.min(account.daysPastDue, 180);
  if (account.balanceCents >= 100000) score += 30;
  if (account.balanceCents >= 250000) score += 25;
  if (account.lastContactDaysAgo == null || account.lastContactDaysAgo >= 14)
    score += 25;
  if (
    account.promiseToPayDate &&
    daysUntil(account.promiseToPayDate) <= 7 &&
    daysUntil(account.promiseToPayDate) >= 0
  )
    score += 40;
  if (account.lastContactDaysAgo != null && account.lastContactDaysAgo < 7)
    score -= 35;
  return score;
}

export function scoreFactors(account: SampleAccount): string[] {
  const factors = [`${account.daysPastDue} days past due`];
  if (account.balanceCents >= 250000) factors.push("Balance over $2,500");
  else if (account.balanceCents >= 100000) factors.push("Balance over $1,000");
  if (account.lastContactDaysAgo == null) factors.push("No contact on file");
  else if (account.lastContactDaysAgo >= 14)
    factors.push("No contact in 14 days");
  else factors.push(`Last contact ${account.lastContactDaysAgo} days ago`);
  if (
    account.promiseToPayDate &&
    daysUntil(account.promiseToPayDate) <= 7 &&
    daysUntil(account.promiseToPayDate) >= 0
  )
    factors.push("Promise date within 7 days");
  if (account.lastContactDaysAgo != null && account.lastContactDaysAgo < 7)
    factors.push("Sample cool-down: contact in the last 7 days");
  return factors;
}

export function laneFor(account: SampleAccount): LaneId {
  if (
    account.flags.includes("cease-requested") ||
    account.contactConsent === "none"
  )
    return "hold";
  if (account.flags.includes("validation-pending")) return "hold";
  if (
    account.flags.includes("dispute") ||
    account.flags.includes("hardship") ||
    account.flags.includes("insurance-pending")
  )
    return "review";
  if (
    account.promiseToPayDate &&
    daysUntil(account.promiseToPayDate) <= 7 &&
    daysUntil(account.promiseToPayDate) >= 0
  )
    return "promise";
  if (account.contactConsent === "mail-only") return "letter";
  if (
    account.balanceCents >= 100000 &&
    (account.lastContactDaysAgo == null || account.lastContactDaysAgo >= 7)
  )
    return "priority";
  return "standard";
}

export function nextAction(account: SampleAccount): string {
  const lane = laneFor(account);
  if (lane === "hold" && account.flags.includes("cease-requested"))
    return "Cease is on the account. No automatic contact.";
  if (lane === "hold" && account.flags.includes("validation-pending"))
    return "Validation is still open on this sample. No payment demand yet.";
  if (lane === "hold")
    return "No consented channel is on file. Do not invent one.";
  if (account.flags.includes("dispute"))
    return "A person reviews the dispute before any reminder.";
  if (account.flags.includes("hardship"))
    return "A person reviews the hardship note before any payment demand.";
  if (account.flags.includes("insurance-pending"))
    return "Wait for the sample payer review. Do not treat the full balance as the guarantor's to pay.";
  if (lane === "promise")
    return account.lastContactDaysAgo != null && account.lastContactDaysAgo < 7
      ? "Confirm the promise in writing. The sample cool-down says not to place another call this week."
      : "Confirm the promise on the consented channel.";
  if (lane === "letter") return "Queue a sample letter. Do not text or email.";
  if (account.lastContactDaysAgo != null && account.lastContactDaysAgo < 7)
    return "Sample cool-down is open. Wait, or send nothing today.";
  if (lane === "priority")
    return "Draft a reminder on a consented channel. Last contact is outside the sample cool-down.";
  return "One short digital reminder. The balance is small, so keep it to a single channel.";
}

export interface QueuedAccount extends SampleAccount {
  lane: LaneId;
  deskScore: number;
  factors: string[];
  nextAction: string;
}

export function present(account: SampleAccount): QueuedAccount {
  return {
    ...account,
    lane: laneFor(account),
    deskScore: deskScore(account),
    factors: scoreFactors(account),
    nextAction: nextAction(account),
  };
}

export function segmentPortfolio(book: SampleAccount[] = accounts) {
  const grouped = Object.fromEntries(
    lanes.map((lane) => [lane.id, [] as QueuedAccount[]]),
  ) as Record<LaneId, QueuedAccount[]>;
  for (const account of book) grouped[laneFor(account)].push(present(account));
  for (const lane of lanes)
    grouped[lane.id].sort((a, b) => b.deskScore - a.deskScore || a.id.localeCompare(b.id));
  return lanes.map((lane) => ({
    ...lane,
    accounts: grouped[lane.id],
    totalCents: grouped[lane.id].reduce((sum, account) => sum + account.balanceCents, 0),
  }));
}

export function agingBuckets(book: SampleAccount[] = accounts) {
  const buckets = [
    { id: "1-30", label: "1–30 days", min: 1, max: 30 },
    { id: "31-60", label: "31–60 days", min: 31, max: 60 },
    { id: "61-90", label: "61–90 days", min: 61, max: 90 },
    { id: "91-120", label: "91–120 days", min: 91, max: 120 },
    { id: "121+", label: "121+ days", min: 121, max: Infinity },
  ];
  return buckets.map((bucket) => {
    const rows = book.filter(
      (account) =>
        account.daysPastDue >= bucket.min && account.daysPastDue <= bucket.max,
    );
    return {
      id: bucket.id,
      label: bucket.label,
      count: rows.length,
      totalCents: rows.reduce((sum, account) => sum + account.balanceCents, 0),
    };
  });
}

export function kindCounts(book: SampleAccount[] = accounts) {
  return (["medical-billing", "veterinary", "commercial"] as const).map((kind) => {
    const rows = book.filter((account) => account.kind === kind);
    return {
      kind,
      label: kindLabel(kind),
      count: rows.length,
      totalCents: rows.reduce((sum, account) => sum + account.balanceCents, 0),
    };
  });
}

export function dashboard(book: SampleAccount[] = accounts) {
  const segments = segmentPortfolio(book);
  const byId = Object.fromEntries(segments.map((segment) => [segment.id, segment]));
  return {
    label: SAMPLE_LABEL,
    asOf: AS_OF,
    asOfLabel: AS_OF_LABEL,
    office: DEMO_OFFICE,
    accountCount: book.length,
    totalCents: book.reduce((sum, account) => sum + account.balanceCents, 0),
    aging: agingBuckets(book),
    kinds: kindCounts(book),
    segments,
    counts: {
      priority: byId.priority.accounts.length,
      promise: byId.promise.accounts.length,
      standard: byId.standard.accounts.length,
      letter: byId.letter.accounts.length,
      review: byId.review.accounts.length,
      hold: byId.hold.accounts.length,
    },
  };
}

export function validateRow(row: BatchRow): { status: "accepted" | "rejected"; messages: string[] } {
  const errors: string[] = [];
  if (!/^ACC-\d{4}$/.test(row.id))
    errors.push("Account id must look like ACC-4400.");
  if (!labelPattern.test(row.guarantorLabel))
    errors.push(
      'Guarantor label must look like "Sample guarantor G-14". Personal names are refused.',
    );
  if (!row.office.trim()) errors.push("Office is required.");
  if (!kinds.includes(row.kind as Kind))
    errors.push("Account type must be medical billing, veterinary, or commercial.");
  if (!Number.isInteger(row.balanceCents) || row.balanceCents <= 0 || row.balanceCents > 2000000)
    errors.push("Balance must be greater than zero and at most $20,000.00 in this sample book.");
  if (!referencePattern.test(row.reference))
    errors.push("Reference must look like ENC-SAMPLE-2044, VIS-SAMPLE-1180, or INV-SAMPLE-3301.");
  if (!consents.includes(row.contactConsent as Consent))
    errors.push("Contact consent must be a known sample value.");
  if (row.flags.some((flag) => !knownFlags.includes(flag as Flag)))
    errors.push("A flag on this row is not in the sample list.");
  if (!row.payer.trim()) errors.push("Payer description is required.");
  if (
    row.promiseAmountCents != null &&
    row.balanceCents > 0 &&
    row.promiseAmountCents > row.balanceCents
  )
    errors.push("Promise amount cannot exceed the sample balance.");
  if (errors.length) return { status: "rejected", messages: errors };
  const warnings: string[] = [];
  if (row.flags.includes("dispute"))
    warnings.push("Accepted. Dispute flag: a person reviews before a reminder.");
  if (row.flags.includes("hardship"))
    warnings.push("Accepted. Hardship flag: a person reviews before a payment demand.");
  if (row.flags.includes("cease-requested"))
    warnings.push("Accepted into the book. Cease flag: no automatic contact.");
  if (row.flags.includes("validation-pending"))
    warnings.push("Accepted into the book. Validation is open: no payment demand.");
  if (row.flags.includes("insurance-pending"))
    warnings.push(
      "Accepted. Payer review is open: do not treat the full balance as the guarantor's to pay.",
    );
  if (row.contactConsent === "none")
    warnings.push("Accepted into the book. No consented channel is on file.");
  if (!warnings.length) warnings.push("Accepted.");
  return { status: "accepted", messages: warnings };
}

export function batchRows(): BatchRow[] {
  return [...accounts, rejectedRow];
}

export function validateBatch(rows: BatchRow[] = batchRows()) {
  const results = rows.map((row) => ({ ...validateRow(row), row }));
  return {
    label: SAMPLE_LABEL,
    fileName: "sample-batch-2026-10-22.csv",
    asOf: AS_OF,
    rowCount: results.length,
    accepted: results.filter((row) => row.status === "accepted").length,
    rejected: results.filter((row) => row.status === "rejected").length,
    results,
  };
}

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function sampleCsv(): string {
  const header = [
    "account_id",
    "office",
    "kind",
    "guarantor_label",
    "balance_usd",
    "days_past_due",
    "last_contact_days_ago",
    "promise_date",
    "promise_amount_usd",
    "contact_consent",
    "flags",
    "reference",
    "payer",
  ];
  const lines = batchRows().map((row) =>
    [
      row.id,
      row.office,
      row.kind,
      row.guarantorLabel,
      (row.balanceCents / 100).toFixed(2),
      row.daysPastDue,
      row.lastContactDaysAgo ?? "",
      row.promiseToPayDate ?? "",
      row.promiseAmountCents == null ? "" : (row.promiseAmountCents / 100).toFixed(2),
      row.contactConsent,
      row.flags.join("|"),
      row.reference,
      row.payer,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function blockReason(account: SampleAccount, channel: Channel): string | null {
  if (account.flags.includes("cease-requested"))
    return "Cease is on this sample account. No reminder is drafted.";
  if (account.flags.includes("validation-pending"))
    return "Validation is still open. No payment reminder is drafted.";
  if (account.contactConsent === "none")
    return "No contact channel is on file. No reminder is drafted.";
  if (!allowedChannels(account.contactConsent).includes(channel))
    return `This sample account does not have consent for ${channelLabel(channel).toLowerCase()}.`;
  return null;
}

function sender(account: SampleAccount): string {
  if (account.office === DEMO_OFFICE) return DEMO_OFFICE;
  return `${DEMO_OFFICE}, about a sample account for ${account.office}`;
}

function cta(account: SampleAccount): string {
  if (account.flags.includes("dispute"))
    return "Tell us which part is wrong. Do not send payment for the disputed amount while it is under review.";
  if (account.flags.includes("hardship"))
    return "Reply if you want a person to review the hardship note. This draft does not set a payment deadline.";
  if (account.flags.includes("insurance-pending"))
    return "The payer portion is still open in this sample. You do not need to pay the full balance from this draft.";
  if (account.promiseAmountCents && account.promiseToPayDate)
    return `Reply to confirm the sample promise of ${money(account.promiseAmountCents)} on ${prettyDate(account.promiseToPayDate)}. The sample balance remains ${money(account.balanceCents)}.`;
  return "You can pay the sample balance or tell us if any part of it is wrong.";
}

function closer(): string {
  return "A person reviews this draft before anyone sends it. Nothing in this demo is delivered. This is not a legal notice, and it does not add a fee or a deadline that is not already on the sample account.";
}

export interface PreparedDraft {
  accountId: string;
  channel: Channel;
  blocked: boolean;
  reason: string | null;
  reviewRequired: boolean;
  text: string;
}

export function fallbackDraft(account: SampleAccount, channel: Channel): PreparedDraft {
  const reason = blockReason(account, channel);
  const reviewRequired = account.flags.some((flag) =>
    ["dispute", "hardship", "insurance-pending"].includes(flag),
  );
  if (reason)
    return {
      accountId: account.id,
      channel,
      blocked: true,
      reason,
      reviewRequired: false,
      text: "",
    };
  const balance = `${money(account.balanceCents)}, ${account.daysPastDue} days past due`;
  let text: string;
  if (channel === "sms") {
    text = [
      "SAMPLE DATA — not a real notice.",
      `${account.office} account ${account.id}, ref ${account.reference}, sample balance ${balance}. ${cta(account)} Synthetic demo. Not sent.`,
    ].join("\n");
  } else if (channel === "letter") {
    text = [
      "SAMPLE DATA — not a real notice.",
      "",
      account.guarantorLabel,
      "Sample mailing — no street address is included in this demo.",
      "",
      `${sender(account)}.`,
      `Account ${account.id}`,
      `Reference ${account.reference}`,
      `Sample balance ${balance}.`,
      "",
      "Mail is the only consented channel on this sample account. This draft is a letter, not a text or an email.",
      "",
      cta(account),
      "",
      closer(),
      "",
      DEMO_OFFICE,
      "Sample collections desk",
    ].join("\n");
  } else {
    text = [
      "SAMPLE DATA — not a real notice.",
      "",
      `Hello ${account.guarantorLabel},`,
      "",
      `${sender(account)}. Account ${account.id}, reference ${account.reference}. The sample balance is ${balance}.`,
      "",
      cta(account),
      "",
      closer(),
      "",
      DEMO_OFFICE,
      "Sample collections desk",
    ].join("\n");
  }
  return {
    accountId: account.id,
    channel,
    blocked: false,
    reason: null,
    reviewRequired,
    text,
  };
}

export interface CallTurn {
  speaker: "Specialist" | "Guarantor";
  text: string;
}

export const callTurns: CallTurn[] = [
  {
    speaker: "Specialist",
    text: "This is a sample call from Harbor Sample Veterinary about account ACC-4408, reference VIS-SAMPLE-1240. The sample balance is $275.00. Is now an okay time to talk?",
  },
  { speaker: "Guarantor", text: "Yes, briefly." },
  {
    speaker: "Specialist",
    text: "The sample balance has been open for 22 days. I can take a payment arrangement, or you can say the balance is wrong.",
  },
  {
    speaker: "Guarantor",
    text: "I can pay $150.00 on Friday. The rest has to wait until the next paycheck. Please don't call before 5 p.m. Email is better.",
  },
  {
    speaker: "Specialist",
    text: "I will record a sample promise of $150.00 on Friday, October 24, 2026, and a preference for email after 5 p.m. I will not ask for a full card number. If any part of the balance is wrong, say so and a person will review it before another reminder.",
  },
  { speaker: "Guarantor", text: "Friday works for the $150.00." },
  {
    speaker: "Specialist",
    text: "You will get a sample email confirmation. This call is synthetic and was not placed to a real person.",
  },
];

export function transcriptText(): string {
  return callTurns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
}

export interface CallSummary {
  label: typeof SAMPLE_LABEL;
  accountId: string;
  reference: string;
  disposition: string;
  promiseAmount: string;
  promiseDate: string;
  nextAction: string;
  complianceNotes: string[];
}

export function fallbackCallSummary(): CallSummary {
  return {
    label: SAMPLE_LABEL,
    accountId: "ACC-4408",
    reference: "VIS-SAMPLE-1240",
    disposition: "Promise to pay",
    promiseAmount: "$150.00",
    promiseDate: "2026-10-24",
    nextAction:
      "Send a sample email confirmation of the $150.00 promise on October 24, 2026, and do not call before 5 p.m.",
    complianceNotes: [
      "The guarantor asked for contact after 5 p.m. and preferred email. Treat that as a sample contact preference for this account.",
      "The guarantor said the rest of the balance has to wait until the next paycheck. Route a hardship review before a stronger follow-up.",
      "The sample call did not threaten consequences or ask for a full card number.",
    ],
  };
}

export const draftFacts = (account: SampleAccount, channel: Channel) => ({
  label: SAMPLE_LABEL,
  channel,
  office: account.office,
  sender: sender(account),
  guarantorLabel: account.guarantorLabel,
  accountId: account.id,
  reference: account.reference,
  balance: money(account.balanceCents),
  daysPastDue: account.daysPastDue,
  payer: account.payer,
  kind: kindLabel(account.kind),
  consent: consentLabel(account.contactConsent),
  flags: account.flags.map(flagLabel),
  promiseDate: account.promiseToPayDate,
  promiseAmount:
    account.promiseAmountCents == null ? null : money(account.promiseAmountCents),
  guidance: cta(account),
});
