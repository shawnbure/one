import protobuf from "protobufjs/minimal.js";
import { one } from "./generated.js";
const eventType = one.discussion.v1.DiscussionEvent;
const frameType = one.discussion.v1.Frame;
export const Kinds = {
  NOTE: 1,
  QUESTION: 2,
  PROPOSAL: 3,
  CLAIM: 4,
  EVIDENCE: 5,
  OBJECTION: 6,
  COMMITMENT: 7,
  VOTE: 8,
  RESOLUTION: 9,
} as const;
export const MEDIA_TYPE = "application/vnd.one.discussion.v1+protobuf";
export const EXTENSION = "https://one.workrr.ai/protocol/discussion-v1.md";
export interface DiscussionEvent {
  version: number;
  id?: string;
  thread: string;
  actor?: string;
  kind: number;
  text?: string;
  ref?: string;
  evidenceRefs?: string[];
  artifactRefs?: string[];
  scope?: string;
  deadline?: string;
  stance?: string;
  createdAt?: string;
  clientId?: string;
  sequence?: number;
  actorName?: string;
  threadTitle?: string;
}
export interface Frame {
  version: number;
  signal?: number;
  revision?: number;
  events: DiscussionEvent[];
  cursor: number;
  hasMore?: boolean;
  channel?: string;
}
function encode(type: typeof eventType | typeof frameType, value: object) {
  const error = type.verify(value);
  if (error) throw Error(error);
  return type.encode(value as any, new protobuf.Writer()).finish();
}
function decode(type: typeof eventType | typeof frameType, bytes: Uint8Array) {
  if (bytes.byteLength > 4_000_000) throw Error("Frame too large");
  const value = type.toObject(type.decode(bytes) as any, {
    longs: Number,
    defaults: true,
    arrays: true,
  });
  if (value.version !== 1) throw Error("Unsupported ONE discussion version");
  return value;
}
export const encodeEvent = (value: DiscussionEvent) => encode(eventType, value);
export const decodeEvent = (bytes: Uint8Array) =>
  decode(eventType, bytes) as DiscussionEvent;
export const encodeFrame = (value: Frame) => encode(frameType, value);
export const decodeFrame = (bytes: Uint8Array) =>
  decode(frameType, bytes) as Frame;
/** Exact field-based rendering, never an inferred or AI-generated summary. */
export function renderEvent(
  e: DiscussionEvent,
  resolveReference: (id: string) => string = (id) => id,
) {
  const label =
    Object.entries(Kinds)
      .find(([, v]) => v === e.kind)?.[0]
      .toLowerCase() || "unknown event";
  return [
    e.kind === Kinds.NOTE && !e.ref
      ? ""
      : `${label[0].toUpperCase() + label.slice(1)}${e.ref ? ` → ${resolveReference(e.ref)}` : ""}${e.stance ? `: ${e.stance}` : ""}.`,
    e.text || "",
    e.scope ? `Scope: ${e.scope}` : "",
    e.deadline ? `Deadline: ${e.deadline}` : "",
    e.evidenceRefs?.length
      ? `Evidence: ${e.evidenceRefs.map(resolveReference).join(", ")}`
      : "",
    e.artifactRefs?.length ? `Artifacts: ${e.artifactRefs.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
