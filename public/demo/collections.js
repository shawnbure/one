const dataNode = document.querySelector("#demo-data");
const data = dataNode ? JSON.parse(dataNode.textContent || "{}") : {};

const sourceCopy = {
  "workers-ai": "Drafted with Workers AI through AI Gateway. Not sent.",
  ai_unavailable: "Prepared sample draft. Workers AI did not answer in time. Not sent.",
  unusable_model_output:
    "Prepared sample draft. The model reply was discarded because it missed the sample rules. Not sent.",
  rate_limited: "Prepared sample draft. The demo rate limit was reached. Not sent.",
  binding_missing: "Prepared sample draft. The Workers AI binding is not available. Not sent.",
  gateway_not_configured:
    "Prepared sample draft. AI Gateway is not configured in this environment. Not sent.",
};

function draftFor(accountId, channel) {
  const account = (data.catalog || []).find((item) => item.id === accountId);
  return account?.channels?.[channel] || null;
}

function showDraft(draft, sourceLabel) {
  const text = document.querySelector("#draft-text");
  const block = document.querySelector("#draft-block");
  const review = document.querySelector("#draft-review");
  const source = document.querySelector("#draft-source");
  const button = document.querySelector("#draft-button");
  const copy = document.querySelector("#draft-copy");
  if (!text || !block || !draft) return;
  if (draft.blocked) {
    block.hidden = false;
    block.textContent = draft.reason || "No reminder is drafted.";
    text.hidden = true;
    text.textContent = "";
  } else {
    block.hidden = true;
    text.hidden = false;
    text.textContent = draft.text || "";
  }
  if (review) review.hidden = !draft.reviewRequired;
  if (source && sourceLabel) source.textContent = sourceLabel;
  if (button) button.disabled = !!draft.blocked;
  if (copy) copy.disabled = !!draft.blocked;
}

function syncChannels(accountId) {
  const account = (data.catalog || []).find((item) => item.id === accountId);
  const radios = [...document.querySelectorAll('#draft-channels input[name="channel"]')];
  let selected = radios.find((radio) => radio.checked);
  for (const radio of radios) {
    const draft = account?.channels?.[radio.value];
    const blocked = !draft || draft.blocked;
    radio.disabled = blocked;
    radio.closest("label")?.classList.toggle("is-disabled", blocked);
    if (blocked && radio.checked) radio.checked = false;
  }
  if (![...radios].some((radio) => radio.checked)) {
    const first = radios.find((radio) => !radio.disabled) || radios[0];
    if (first) first.checked = true;
    selected = first;
  }
  return selected?.value || "email";
}

function selectedAccount() {
  return document.querySelector("#draft-account")?.value || data.selected?.accountId;
}

function selectedChannel() {
  return (
    document.querySelector('#draft-channels input[name="channel"]:checked')?.value ||
    data.selected?.channel ||
    "email"
  );
}

function paintSelection() {
  const accountId = selectedAccount();
  const channel = syncChannels(accountId);
  const draft = draftFor(accountId, channel);
  const meta = document.querySelector("#draft-meta");
  const account = (data.catalog || []).find((item) => item.id === accountId);
  if (meta && account) meta.textContent = account.meta || account.option;
  showDraft(draft, draft?.blocked ? draft.reason : "Prepared sample draft. Not sent.");
  const url = new URL(location.href);
  url.searchParams.set("account", accountId);
  url.searchParams.set("channel", channel);
  history.replaceState({}, "", url);
}

const form = document.querySelector("#draft-form");
let draftRequest = 0;
if (form && data.screen === "messages") {
  document.querySelector("#draft-account")?.addEventListener("change", () => {
    draftRequest += 1;
    paintSelection();
  });
  document.querySelector("#draft-channels")?.addEventListener("change", () => {
    draftRequest += 1;
    paintSelection();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const ticket = ++draftRequest;
    const button = document.querySelector("#draft-button");
    const accountId = selectedAccount();
    const channel = selectedChannel();
    const prepared = draftFor(accountId, channel);
    if (!prepared || prepared.blocked) {
      showDraft(prepared, prepared?.reason);
      return;
    }
    if (button) button.disabled = true;
    const source = document.querySelector("#draft-source");
    if (source) source.textContent = "Asking Workers AI through AI Gateway…";
    try {
      const response = await fetch("/api/demo/collections/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, channel }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error("draft failed");
      if (ticket !== draftRequest) return;
      showDraft(
        {
          blocked: body.blocked,
          reason: body.detail || body.sourceLabel,
          reviewRequired: body.reviewRequired,
          text: body.text,
        },
        body.sourceLabel || sourceCopy[body.reason] || sourceCopy[body.source],
      );
    } catch {
      if (ticket !== draftRequest) return;
      showDraft(prepared, sourceCopy.ai_unavailable);
    } finally {
      if (ticket === draftRequest && button) button.disabled = !!prepared.blocked;
    }
  });
  document.querySelector("#draft-copy")?.addEventListener("click", async () => {
    const text = document.querySelector("#draft-text")?.textContent || "";
    const source = document.querySelector("#draft-source");
    try {
      await navigator.clipboard.writeText(text);
      if (source) source.textContent = "Copied the sample draft. It was not sent.";
    } catch {
      if (source) source.textContent = "Select the draft to copy it. It was not sent.";
    }
  });
}

document.querySelector("#summarize-button")?.addEventListener("click", async () => {
  const button = document.querySelector("#summarize-button");
  const source = document.querySelector("#sum-source");
  if (button) button.disabled = true;
  if (source) source.textContent = "Asking Workers AI through AI Gateway…";
  try {
    const response = await fetch("/api/demo/collections/call-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await response.json();
    if (!response.ok || !body.summary) throw new Error("summary failed");
    const summary = body.summary;
    const set = (id, value) => {
      const node = document.querySelector(id);
      if (node) node.textContent = value;
    };
    set("#sum-disposition", summary.disposition);
    set("#sum-amount", summary.promiseAmount);
    set("#sum-date", summary.promiseDateLabel || summary.promiseDate);
    set("#sum-next", summary.nextAction);
    const notes = document.querySelector("#sum-notes");
    if (notes) {
      notes.replaceChildren();
      for (const note of summary.complianceNotes || []) {
        const item = document.createElement("li");
        item.textContent = note;
        notes.append(item);
      }
    }
    if (source) source.textContent = body.sourceLabel || "Prepared sample summary.";
  } catch {
    if (source)
      source.textContent =
        "Prepared sample summary stayed on screen. Workers AI did not answer. The call was not placed.";
  } finally {
    if (button) button.disabled = false;
  }
});

document.querySelector("#replay")?.addEventListener("click", async () => {
  const table = document.querySelector("#batch-table");
  const status = document.querySelector("#batch-status");
  const button = document.querySelector("#replay");
  if (button) button.disabled = true;
  if (table) table.dataset.state = "checking";
  if (status) status.textContent = "Checking 13 sample rows…";
  const wait = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600;
  try {
    const [response] = await Promise.all([
      fetch("/api/demo/collections/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      new Promise((resolve) => setTimeout(resolve, wait)),
    ]);
    const body = await response.json();
    if (!response.ok) throw new Error("ingest failed");
    if (table) table.dataset.state = "ready";
    if (status)
      status.textContent = `Validation finished. ${body.accepted} accepted, ${body.rejected} rejected. Rejected rows stay out of the book.`;
  } catch {
    if (table) table.dataset.state = "ready";
    if (status) status.textContent = "The sample check could not be repeated. The result already on screen still stands.";
  } finally {
    if (button) button.disabled = false;
  }
});
