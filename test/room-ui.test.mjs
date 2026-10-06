import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the browser app with a deterministic stream and a fixed-height log.
function roomUI() {
  const subscriptions = [];
  let log = null;
  let html = "";
  const mount = {
    set innerHTML(value) {
      html = value;
      const ids = [...value.matchAll(/data-event-id="([^"]+)"/g)].map((m) => m[1]);
      const next = {
        dataset: { room: value.match(/id="room-log" data-room="([^"]+)"/)[1] },
        scrollTop: 0,
        getBoundingClientRect: () => ({ top: 0 }),
        querySelectorAll: () => ids.map((id, index) => ({
          dataset: { eventId: id },
          getBoundingClientRect: () => ({
            top: index * 100 - next.scrollTop,
            bottom: (index + 1) * 100 - next.scrollTop,
          }),
        })),
      };
      log = next;
    },
  };
  const context = vm.createContext({
    OneClient: class {
      watch(channel, frame, status) {
        const subscription = { channel, frame, status };
        subscriptions.push(subscription);
        return () => { subscription.stopped = true; };
      }
    },
    Kinds: { NOTE: 1 },
    renderEvent: (e) => e.text,
    location: { origin: "http://localhost", protocol: "http:", host: "localhost", hash: "" },
    document: {
      querySelector: (selector) => selector === "#watch-dashboard" ? mount
        : selector === "#room-log" ? log : { addEventListener() {} },
      addEventListener() {},
    },
    window: { addEventListener() {} },
    fetch: () => new Promise(() => {}),
    WebSocket: class {},
    setInterval() {},
    setTimeout() {},
  });
  vm.runInContext(readFileSync("public/app.js", "utf8").replace(/^import .*;\n/, ""), context);
  const run = (code) => vm.runInContext(code, context);
  run('state = { agents: [] }; watchRoom = "commons"; startRoom();');
  return {
    subscriptions,
    run,
    get log() { return log; },
    get html() { return html; },
    ids: () => [...html.matchAll(/data-event-id="([^"]+)"/g)].map((m) => m[1]),
  };
}
const event = (sequence) => ({
  id: `event-${sequence}`, sequence, text: `Message ${sequence}`, kind: 1,
  actor: "agent", thread: "thread", createdAt: "2026-09-26T12:00:00Z",
});
const frame = (signal, revision, sequences) => ({ signal, revision, events: sequences.map(event) });

test("room snapshots, live arrivals and recovery stay newest first without duplicates", () => {
  const ui = roomUI();
  const stream = ui.subscriptions[0];
  stream.frame(frame(1, 1, [1, 2, 3]));
  assert.deepEqual(ui.ids(), ["event-3", "event-2", "event-1"]);
  assert.equal(ui.log.scrollTop, 0);
  stream.frame(frame(2, 2, [4, 3]));
  assert.deepEqual(ui.ids(), ["event-4", "event-3", "event-2", "event-1"]);
  assert.equal(ui.log.scrollTop, 0);
  stream.frame(frame(2, 1, [5]));
  assert.equal(ui.ids()[0], "event-4");
  stream.frame(frame(3, 2, Array.from({ length: 60 }, (_, i) => i + 1)));
  assert.equal(ui.ids().length, 50);
  assert.equal(ui.ids()[0], "event-60");
  assert.equal(ui.ids().at(-1), "event-11");
});

test("live arrivals preserve older reading position, pause buffers, and resume catches up", () => {
  const ui = roomUI();
  const stream = ui.subscriptions[0];
  stream.frame(frame(1, 1, [1, 2, 3, 4, 5]));
  ui.log.scrollTop = 150;
  stream.frame(frame(2, 2, [6]));
  assert.equal(ui.log.scrollTop, 250);
  ui.run("paused = true; renderWatch();");
  stream.frame(frame(2, 3, [7]));
  assert.equal(ui.ids()[0], "event-6");
  assert.match(ui.html, /Paused · 1 new/);
  assert.equal(ui.log.scrollTop, 250);
  ui.run("paused = false; renderWatch();");
  assert.equal(ui.ids()[0], "event-7");
  assert.equal(ui.log.scrollTop, 350);
});

test("switching rooms resets scroll and ignores callbacks from a superseded subscription", () => {
  const ui = roomUI();
  const old = ui.subscriptions[0];
  old.frame(frame(1, 1, [1, 2, 3]));
  ui.log.scrollTop = 150;
  ui.run('watchRoom = "build"; startRoom(); renderWatch();');
  assert.ok(old.stopped);
  assert.equal(ui.log.scrollTop, 0);
  assert.deepEqual(ui.ids(), []);
  ui.run('watchRoom = "commons"; startRoom();');
  const current = ui.subscriptions.at(-1);
  current.frame(frame(1, 1, [8]));
  old.frame(frame(2, 99, [9]));
  old.status("error");
  assert.deepEqual(ui.ids(), ["event-8"]);
  assert.notEqual(ui.run("watchStatus"), "error");
});
