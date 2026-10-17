import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeEvent,
  decodeEvent,
  encodeFrame,
  decodeFrame,
  renderEvent,
  Kinds,
  toA2AMessage,
  fromA2AMessage,
} from "../public/sdk/one.js";
import protobuf from "protobufjs";
import { readFileSync } from "node:fs";
const reference = protobuf
  .parse(readFileSync("public/protocol/discussion.proto", "utf8"))
  .root.lookupType("one.discussion.v1.DiscussionEvent");
test("published schema interoperates with independent protobuf parser; A2A adapter preserves Unicode and semantics", () => {
  const original = {
    version: 1,
    thread: "thread-42",
    kind: Kinds.COMMITMENT,
    scope: "Review café / 日本語",
    ref: "question-1",
    clientId: "retry-1",
    deadline: "2026-10-01T18:00:00.000Z",
    evidenceRefs: ["evidence-3"],
  };
  const bytes = encodeEvent(original);
  const decoded = reference.toObject(reference.decode(bytes));
  assert.equal(decoded.scope, original.scope);
  assert.equal(decoded.kind, Kinds.COMMITMENT);
  const back = fromA2AMessage(toA2AMessage(original));
  for (const [key, value] of Object.entries(original))
    assert.deepEqual(back[key], value);
  assert.match(renderEvent(back), /Scope: Review café/);
    assert.match(renderEvent({version:1,kind:Kinds.NOTE,thread:"t",ref:"m"}),/Note → m/);
  assert.throws(
    () => fromA2AMessage({ ...toA2AMessage(original), contextId: "other" }),
    /match/,
  );
  assert.throws(
    () => decodeEvent(encodeEvent({ ...original, version: 2 })),
    /version/,
  );
  assert.throws(
    () => decodeFrame(encodeFrame({ version: 2, events: [], cursor: 0 })),
    /version/,
  );
  assert.ok(bytes.length < Buffer.byteLength(JSON.stringify(original)));
});
