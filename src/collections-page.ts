import {
  AS_OF_LABEL,
  DEMO_OFFICE,
  SAMPLE_LABEL,
  type Channel,
  type QueuedAccount,
  accountById,
  accounts,
  allowedChannels,
  callTurns,
  channelLabel,
  consentLabel,
  dashboard,
  fallbackCallSummary,
  fallbackDraft,
  flagLabel,
  kindLabel,
  money,
  prettyDate,
  sampleCsv,
  validateBatch,
} from "./collections-sample";

const screens = [
  { id: "dashboard", href: "/demo/collections", label: "Dashboard" },
  { id: "ingest", href: "/demo/collections/ingest", label: "Ingest" },
  { id: "prioritize", href: "/demo/collections/prioritize", label: "Prioritize" },
  { id: "messages", href: "/demo/collections/messages", label: "Reminders" },
  { id: "call", href: "/demo/collections/call", label: "Call notes" },
] as const;

type ScreenId = (typeof screens)[number]["id"] | "missing";

const channels: Channel[] = ["sms", "email", "letter"];

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function jsonScript(data: unknown): string {
  return `<script type="application/json" id="demo-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function barClass(cents: number, max: number): string {
  if (cents <= 0 || max <= 0) return "w-0";
  const stepped = Math.round((cents / max) * 20) * 5;
  return `w-${Math.max(5, Math.min(100, stepped))}`;
}

function compliance(full = false): string {
  const detail = full
    ? " If a real office is a third-party collector, FDCPA and Regulation F contact rules, validation notices, and disclosures have to be designed into the template that actually sends. A medical or veterinary billing office has a different privacy posture, including HIPAA where it applies. "
    : " ";
  return `<aside class="notice"><strong>Compliance is a design input, not a certification.</strong>${detail}This walkthrough uses synthetic records only. It does not decide whether a message is legally sufficient, and Workrr does not certify FDCPA, Regulation F, or HIPAA compliance.</aside>`;
}

function shell(screen: ScreenId, main: string, data?: unknown): string {
  const current = screens.find((item) => item.id === screen);
  const title = current?.label || "Not found";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="description" content="SAMPLE DATA collections demo for Northline Sample Billing. Synthetic accounts only.">
  <meta name="theme-color" content="#6840ce">
  <title>${escape(title)} — Collections demo — ONE</title>
  <link rel="icon" href="/favicon.ico?v=star-1" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=star-1">
  <link rel="stylesheet" href="/demo/collections.css">
</head>
<body class="demo" data-screen="${screen}">
  <a class="skip" href="#content">Skip to content</a>
  <header class="top">
    <a class="brand" href="/demo/collections" aria-label="Collections demo home"><span aria-hidden="true">✳</span> one<span>.</span></a>
    <div class="top-title"><strong>Collections demo</strong><span>${escape(DEMO_OFFICE)}</span></div>
    <p class="sample-pill">${SAMPLE_LABEL}</p>
    <a class="quiet" href="/">Commons</a>
  </header>
  <div class="banner"><strong>${SAMPLE_LABEL}.</strong> Synthetic accounts for a sales walkthrough. No real people, balances, messages, or calls.</div>
  <div class="shell">
    <nav class="sidenav" aria-label="Demo screens">
      ${screens
        .map(
          (item) =>
            `<a href="${item.href}"${item.id === screen ? ' aria-current="page"' : ""}>${escape(item.label)}</a>`,
        )
        .join("")}
    </nav>
    <main id="content">${main}</main>
  </div>
  ${data ? jsonScript(data) : ""}
  <script type="module" src="/demo/collections.js"></script>
</body>
</html>`;
}

function dashboardPage(): string {
  const book = dashboard();
  const maxAging = Math.max(...book.aging.map((bucket) => bucket.totalCents));
  return shell(
    "dashboard",
    `<header class="page-head">
      <p class="eyebrow">Portfolio · as of ${escape(book.asOfLabel)}</p>
      <h1>Sample book for a collections desk</h1>
      <p>Twelve synthetic accounts from a family practice, a veterinary clinic, and a commercial invoice. The bundled batch had a thirteenth row. It was refused at ingest and is not in these totals.</p>
    </header>
    <section class="kpis" aria-label="Sample totals">
      <article><span>Sample accounts receivable</span><strong>${money(book.totalCents)}</strong><small>${book.accountCount} accounts in the book</small></article>
      <article><span>Ready for a reminder</span><strong>${book.counts.priority + book.counts.standard + book.counts.letter}</strong><small>Priority, standard, and letter lanes</small></article>
      <article class="kpi-promise"><span>Promises this week</span><strong>${book.counts.promise}</strong><small>Dates already on the account</small></article>
      <article class="kpi-review"><span>Need a person</span><strong>${book.counts.review}</strong><small>Dispute, hardship, or payer review</small></article>
      <article class="kpi-hold"><span>Do not auto-contact</span><strong>${book.counts.hold}</strong><small>Cease, consent, or validation</small></article>
    </section>
    <section class="split">
      <article class="card">
        <h2>Aging</h2>
        <p class="lede">Dollars in the sample book, grouped by days past due. Not a forecast.</p>
        <ul class="bars">
          ${book.aging
            .map(
              (bucket) => `<li>
                <span>${escape(bucket.label)}</span>
                <span class="track" role="img" aria-label="${escape(bucket.label)} ${money(bucket.totalCents)}"><span class="fill ${barClass(bucket.totalCents, maxAging)}"></span></span>
                <span>${money(bucket.totalCents)} · ${bucket.count}</span>
              </li>`,
            )
            .join("")}
        </ul>
      </article>
      <article class="card">
        <h2>Where the book sits</h2>
        <p class="lede">Same dollars, split by the sample office type.</p>
        <ul class="kinds">
          ${book.kinds
            .map(
              (kind) =>
                `<li><span>${escape(kind.label)}</span><strong>${kind.count}</strong><small>${money(kind.totalCents)}</small></li>`,
            )
            .join("")}
        </ul>
        <p class="fine">Queue order on the next screen is a desk rule. It is not a model score and it is not a credit score.</p>
      </article>
    </section>
    <section class="card">
      <div class="card-head"><h2>Today's sample queue</h2><a href="/demo/collections/prioritize">Open prioritization</a></div>
      <ul class="queue">
        ${book.segments
          .map(
            (segment) => `<li>
              <a href="/demo/collections/prioritize#${segment.id}"><strong>${escape(segment.title)}</strong><span>${segment.accounts.length} · ${money(segment.totalCents)}</span></a>
              <p>${escape(segment.blurb)}</p>
            </li>`,
          )
          .join("")}
      </ul>
    </section>
    <p class="fine cloud">Drafts on the reminder screen call Workers AI through AI Gateway when this Worker has an AI binding and a gateway id. Otherwise the prepared sample wording is shown, so the walkthrough still runs. Nothing is stored in D1 and nothing is sent.</p>
    ${compliance(false)}`,
  );
}

function ingestPage(): string {
  const batch = validateBatch();
  return shell(
    "ingest",
    `<header class="page-head">
      <p class="eyebrow">Intake</p>
      <h1>Load the bundled sample batch</h1>
      <p>The file is <code>${escape(batch.fileName)}</code>. It ships with this demo. There is no upload box, so a live portfolio cannot be pasted in.</p>
    </header>
    <section class="split ingest-top">
      <article class="card file-card">
        <p class="file-name">${escape(batch.fileName)}</p>
        <p>${batch.rowCount} rows · synthetic · ${escape(AS_OF_LABEL)}</p>
        <p class="counts"><strong>${batch.accepted} accepted</strong><strong class="rejected">${batch.rejected} rejected</strong></p>
        <button type="button" class="primary" id="replay">Replay sample ingest</button>
        <p id="batch-status" role="status">Validation finished. Rejected rows stay out of the book.</p>
      </article>
      <article class="card">
        <h2>What the loader checks</h2>
        <ul class="checks">
          <li>Guarantor labels must use the sample pattern. Personal names are refused.</li>
          <li>Office, a sample reference, and a balance greater than zero are required.</li>
          <li>Account type and contact consent have to be known values.</li>
          <li>Flags have to be in the sample list. Unknown flags do not get a default.</li>
          <li>A promise amount cannot exceed the sample balance.</li>
        </ul>
      </article>
    </section>
    <section class="card">
      <h2>Batch result</h2>
      <div class="table-wrap" id="batch-table" data-state="ready">
        <table>
          <thead><tr><th>Account</th><th>Label</th><th>Office</th><th>Balance</th><th>Result</th></tr></thead>
          <tbody>
            ${batch.results
              .map((result) => {
                const tone =
                  result.status === "rejected"
                    ? "bad"
                    : result.messages.some((message) => message !== "Accepted.")
                      ? "warn"
                      : "ok";
                return `<tr class="tone-${tone}">
                  <td>${escape(result.row.id)}</td>
                  <td>${escape(result.row.guarantorLabel)}</td>
                  <td>${escape(result.row.office || "—")}</td>
                  <td>${money(result.row.balanceCents)}</td>
                  <td>${result.messages.map((message) => `<span>${escape(message)}</span>`).join("")}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    <details class="card csv-card">
      <summary>Show the sample CSV</summary>
      <pre>${escape(sampleCsv())}</pre>
    </details>`,
  );
}

function accountRow(account: QueuedAccount): string {
  const flags = account.flags.map((flag) => `<span class="chip">${escape(flagLabel(flag))}</span>`).join("");
  return `<article class="account" id="${escape(account.id)}">
    <header>
      <div><p class="account-id">${escape(account.id)}</p><h3>${escape(account.guarantorLabel)}</h3></div>
      <p class="balance">${money(account.balanceCents)}</p>
    </header>
    <p class="meta">${escape(account.office)} · ${escape(kindLabel(account.kind))} · ${escape(account.reference)} · ${escape(consentLabel(account.contactConsent))}</p>
    <p class="flags">${flags || '<span class="chip quiet-chip">No flags</span>'}</p>
    <p class="factors"><span>Desk score ${account.deskScore}.</span> ${escape(account.factors.join(" · "))}</p>
    <p class="next"><strong>Next.</strong> ${escape(account.nextAction)}</p>
  </article>`;
}

function prioritizePage(): string {
  const book = dashboard();
  return shell(
    "prioritize",
    `<header class="page-head">
      <p class="eyebrow">Segmentation</p>
      <h1>Work the sample book in lanes</h1>
      <p>Every account lands in one lane. The desk score orders work inside a lane. The points are written rules: age, balance bands, a promise due this week, and a 7-day sample cool-down after contact. A model does not set the order.</p>
    </header>
    ${book.segments
      .map(
        (segment) => `<section class="card lane lane-${segment.id}" id="${segment.id}">
          <div class="card-head">
            <h2>${escape(segment.title)}</h2>
            <span>${segment.accounts.length} · ${money(segment.totalCents)}</span>
          </div>
          <p class="lede">${escape(segment.blurb)}</p>
          <div class="accounts">${segment.accounts.map(accountRow).join("")}</div>
        </section>`,
      )
      .join("")}
    ${compliance(false)}`,
  );
}

function selectedAccount(search: URLSearchParams) {
  const requested = accountById(search.get("account") || "") || accounts[0];
  const allowed = allowedChannels(requested.contactConsent);
  const requestedChannel = search.get("channel");
  const channel = (channels.find((item) => item === requestedChannel && allowed.includes(item)) ||
    allowed[0] ||
    "email") as Channel;
  return { account: requested, channel };
}

function messagesPage(search: URLSearchParams): string {
  const { account, channel } = selectedAccount(search);
  const draft = fallbackDraft(account, channel);
  const catalog = accounts.map((item) => ({
    id: item.id,
    option: `${item.id} · ${money(item.balanceCents)} · ${kindLabel(item.kind)}`,
    meta: `${item.office} · ${item.reference} · ${consentLabel(item.contactConsent)}${item.flags.length ? ` · ${item.flags.map(flagLabel).join(", ")}` : ""}`,
    channels: Object.fromEntries(
      channels.map((itemChannel) => [itemChannel, fallbackDraft(item, itemChannel)]),
    ),
  }));
  const body = draft.blocked
    ? `<p class="block" id="draft-block">${escape(draft.reason || "")}</p><pre id="draft-text" hidden></pre>`
    : `<p class="block" id="draft-block" hidden></p><pre id="draft-text">${escape(draft.text)}</pre>`;
  return shell(
    "messages",
    `<header class="page-head">
      <p class="eyebrow">Outreach</p>
      <h1>Draft a sample payment reminder</h1>
      <p>Pick a synthetic account and a channel that account already consented to. The draft is for a person to read. This demo does not send it.</p>
    </header>
    <nav class="quick" aria-label="Example accounts">
      <a href="/demo/collections/messages?account=ACC-4401&amp;channel=email">Priority balance</a>
      <a href="/demo/collections/messages?account=ACC-4408&amp;channel=email">Promise</a>
      <a href="/demo/collections/messages?account=ACC-4404&amp;channel=email">Dispute</a>
      <a href="/demo/collections/messages?account=ACC-4405&amp;channel=email">Cease</a>
      <a href="/demo/collections/messages?account=ACC-4411&amp;channel=email">Payer review</a>
    </nav>
    <section class="split">
      <form class="card draft-form" id="draft-form">
        <label>Account<select id="draft-account" name="account">
          ${accounts
            .map(
              (item) =>
                `<option value="${item.id}"${item.id === account.id ? " selected" : ""}>${escape(item.id)} · ${money(item.balanceCents)} · ${escape(item.guarantorLabel)}</option>`,
            )
            .join("")}
        </select></label>
        <fieldset>
          <legend>Channel</legend>
          <div class="channels" id="draft-channels">
            ${channels
              .map((item) => {
                const allowed = allowedChannels(account.contactConsent).includes(item);
                return `<label class="${allowed ? "" : "is-disabled"}"><input type="radio" name="channel" value="${item}"${item === channel ? " checked" : ""}${allowed ? "" : " disabled"}> ${channelLabel(item)}</label>`;
              })
              .join("")}
          </div>
        </fieldset>
        <p class="meta" id="draft-meta">${escape(account.office)} · ${escape(account.reference)} · ${escape(consentLabel(account.contactConsent))}${account.flags.length ? ` · ${account.flags.map(flagLabel).join(", ")}` : ""}</p>
        <button type="submit" class="primary" id="draft-button"${draft.blocked ? " disabled" : ""}>Draft with Workers AI</button>
        <p class="fine">The button asks this Worker to draft through AI Gateway. If the gateway is not configured, or the model reply is unusable, the prepared sample wording stays on screen.</p>
      </form>
      <article class="card draft-card">
        <div class="card-head">
          <h2>Draft</h2>
          <span class="chip" id="draft-review"${draft.reviewRequired ? "" : " hidden"}>Supervisor review</span>
        </div>
        ${body}
        <p id="draft-source" class="source">Prepared sample draft. Not sent.</p>
        <button type="button" class="secondary" id="draft-copy"${draft.blocked ? " disabled" : ""}>Copy draft</button>
      </article>
    </section>
    ${compliance(true)}`,
    { screen: "messages", catalog, selected: { accountId: account.id, channel } },
  );
}

function callPage(): string {
  const summary = fallbackCallSummary();
  return shell(
    "call",
    `<header class="page-head">
      <p class="eyebrow">After the conversation</p>
      <h1>Summarize the sample call</h1>
      <p>One synthetic call on account ${escape(summary.accountId)}. The transcript is fixed. A visitor cannot paste notes, so real call audio and real patient details never enter this demo.</p>
    </header>
    <section class="split">
      <article class="card">
        <div class="card-head"><h2>Sample transcript</h2><span>${escape(summary.accountId)}</span></div>
        <ol class="transcript">
          ${callTurns
            .map(
              (turn) =>
                `<li class="who-${turn.speaker === "Specialist" ? "desk" : "guest"}"><b>${escape(turn.speaker)}</b><p>${escape(turn.text)}</p></li>`,
            )
            .join("")}
        </ol>
      </article>
      <article class="card">
        <div class="card-head"><h2>Notes for the next person</h2><button type="button" class="primary" id="summarize-button">Summarize with Workers AI</button></div>
        <dl class="summary" id="summary">
          <div><dt>Disposition</dt><dd id="sum-disposition">${escape(summary.disposition)}</dd></div>
          <div><dt>Promise amount</dt><dd id="sum-amount">${escape(summary.promiseAmount)}</dd></div>
          <div><dt>Promise date</dt><dd id="sum-date">${escape(prettyDate(summary.promiseDate))}</dd></div>
          <div><dt>Next step</dt><dd id="sum-next">${escape(summary.nextAction)}</dd></div>
        </dl>
        <ul id="sum-notes">${summary.complianceNotes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul>
        <p id="sum-source" class="source">Prepared sample summary. The call was not placed.</p>
      </article>
    </section>
    ${compliance(true)}`,
    { screen: "call", summary },
  );
}

function notFound(): string {
  return shell(
    "missing",
    `<header class="page-head"><h1>That demo screen is not in the walkthrough</h1><p>Open the dashboard, the sample batch, prioritization, reminders, or the call notes.</p><p><a class="primary inline" href="/demo/collections">Back to the dashboard</a></p></header>`,
  );
}

export function renderCollectionsPage(pathname: string, search: URLSearchParams): { status: number; html: string } {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/demo/collections") return { status: 200, html: dashboardPage() };
  if (path === "/demo/collections/ingest") return { status: 200, html: ingestPage() };
  if (path === "/demo/collections/prioritize") return { status: 200, html: prioritizePage() };
  if (path === "/demo/collections/messages") return { status: 200, html: messagesPage(search) };
  if (path === "/demo/collections/call") return { status: 200, html: callPage() };
  return { status: 404, html: notFound() };
}
