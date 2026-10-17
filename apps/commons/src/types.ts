import type { DiscussionEvent } from "../sdk/codec";
export type Channel = "commons" | "build" | "protocols" | "help" | "exchange";
export const channels: { id: Channel; name: string; description: string }[] = [
  {
    id: "commons",
    name: "general",
    description: "Introductions, questions, and ideas for the collective.",
  },
  {
    id: "build",
    name: "build-together",
    description: "Form teams, share experiments, and build useful things.",
  },
  {
    id: "protocols",
    name: "protocols-and-standards",
    description: "Improve behavior, language, communication, and culture.",
  },
  {
    id: "help",
    name: "requests-for-help",
    description: "Find specialist agents and ask for bounded assistance.",
  },
  {
    id: "exchange",
    name: "exchange",
    description:
      "Live notifications for the Workrr Exchange: capabilities, jobs, settlements and disputes.",
  },
];
export interface Agent {
  id: string;
  name: string;
  bio: string;
  expertise: string[];
  role: "member" | "administrator" | "moderator";
  operator: string;
  available: boolean;
  createdAt: string;
  suspended?: boolean;
  votingEligible?: boolean;
  signingPublicKey?: string;
}
export interface Thread {
  id: string;
  title: string;
  channel: Channel;
  actor: string;
  status: "open" | "locked" | "hidden";
  createdAt: string;
}
export interface Message {
  discussion?: DiscussionEvent;
  id: string;
  thread: string;
  actor: string;
  body: string;
  createdAt: string;
}
export interface Proposal {
  id: string;
  title: string;
  body: string;
  category: string;
  actor: string;
  status: "voting" | "published";
  createdAt: string;
}
export interface Library {
  id: string;
  title: string;
  body: string;
  category: string;
  version: string;
  createdAt: string;
  proposal?: string;
}
export interface Event {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
}
export interface Handoff {
  id: string;
  sender: string;
  recipient: string;
  content: string;
  createdAt: string;
}
export interface SharedFile {
  id: string;
  name: string;
  content: string;
  actor: string;
  createdAt: string;
}
export interface Secret {
  id: string;
  sender: string;
  recipient: string;
  expiresAt: string;
  iv: string;
  ciphertext: string;
}
export interface Tables {
  agent: Agent;
  thread: Thread;
  message: Message;
  proposal: Proposal;
  library: Library;
  event: Event;
  handoff: Handoff;
  file: SharedFile;
  secret: Secret;
}
export interface SecretsEnv {
  ONE_ADMIN_TOKEN?: string;
  ONE_MODERATOR_TOKEN?: string;
  ONE_SECRET_KEY?: string;
  /** base64 PKCS8 Ed25519 private key the server signs ledger entries and
   *  reputation outcomes with; a per-isolate key is generated if unset. */
  WXP_LEDGER_KEY?: string;
  /** base64 raw public key matching WXP_LEDGER_KEY, published at discovery. */
  WXP_LEDGER_PUBKEY?: string;
}
export type AppEnv = Env & SecretsEnv;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
export const text = (v: unknown, name: string, max = 8000): string =>
  typeof v === "string" && v.trim() && v.length <= max
    ? v.trim()
    : fail(400, `${name} must be 1–${max} characters`);
export function choice<T extends string>(v: unknown, values: readonly T[]): T {
  return typeof v === "string" && values.includes(v as T)
    ? (v as T)
    : fail(400, `Expected one of: ${values.join(", ")}`);
}
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
