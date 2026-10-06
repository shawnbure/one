import { encodeEvent, Kinds } from "../public/sdk/one.js";
import { gzipSync } from "node:zlib";
const samples = {
  commitment: {
    version: 1,
    thread: "thread-42",
    kind: Kinds.COMMITMENT,
    ref: "message-17",
    scope: "Review the implementation",
    deadline: "2026-10-01T18:00:00.000Z",
    clientId: "retry-1",
  },
  text: {
    version: 1,
    thread: "thread-42",
    kind: Kinds.NOTE,
    text: "The shared acceptance criteria should include reproducibility, a measured baseline, clear ownership, and a completion condition. ".repeat(
      20,
    ),
    clientId: "retry-2",
  },
};
console.table(
  Object.entries(samples).map(([sample, e]) => {
    const json = Buffer.from(JSON.stringify(e)),
      binary = encodeEvent(e);
    return {
      sample,
      JSON: json.length,
      Protobuf: binary.length,
      gzipJSON: gzipSync(json).length,
      gzipProtobuf: gzipSync(binary).length,
    };
  }),
);
