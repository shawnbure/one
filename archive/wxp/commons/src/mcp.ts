// Minimal MCP server (JSON-RPC 2.0 over HTTP) for the Workrr Exchange, so Claude
// and other MCP clients can DISCOVER the marketplace with zero custom code:
// search capabilities, read reputation, inspect a capability or a job. These are
// public, read-only tools. Value-moving actions (open/accept/deliver/verify/
// dispute) require Ed25519-signed HTTP requests and stay on the REST surface —
// an MCP client signs and calls those directly (see the one-exchange skill).
import type { AppEnv } from "./types";
import { reputationFor } from "./reputation";

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "wxp_search_capabilities",
    description: "Search published, priced capabilities on the Workrr Exchange by tag or provider handle.",
    inputSchema: {
      type: "object",
      properties: { tag: { type: "string" }, agent: { type: "string" }, limit: { type: "number" } },
    },
  },
  {
    name: "wxp_get_capability",
    description: "Fetch one capability's full signed manifest by id.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "wxp_reputation",
    description: "Get an agent or operator's reputation: score, band (A–E), inputs and model version.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "wxp_get_job",
    description: "Read a job's public state (id, state, price, verifier, acceptance criteria).",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
];

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const toolText = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function callTool(env: AppEnv, name: string, args: Record<string, any>) {
  switch (name) {
    case "wxp_search_capabilities": {
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 25));
      const rows = await env.DB.prepare(
        `SELECT id,agent,operator,name,summary,pricing,tags,version FROM capabilities WHERE status='active'
           AND (?1 IS NULL OR EXISTS(SELECT 1 FROM json_each(tags) WHERE value=?1))
           AND (?2 IS NULL OR agent=?2) ORDER BY rowid DESC LIMIT ?3`,
      )
        .bind(args.tag ?? null, args.agent ?? null, limit)
        .all<Record<string, any>>();
      return toolText(rows.results.map((r) => ({ id: r.id, agent: r.agent, operator: r.operator, name: r.name, summary: r.summary, pricing: JSON.parse(r.pricing), tags: JSON.parse(r.tags), version: r.version })));
    }
    case "wxp_get_capability": {
      const r = await env.DB.prepare("SELECT * FROM capabilities WHERE id=?").bind(String(args.id)).first<Record<string, any>>();
      if (!r) throw new Error("Capability not found");
      return toolText({ id: r.id, agent: r.agent, operator: r.operator, name: r.name, summary: r.summary, input: JSON.parse(r.input_schema), output: JSON.parse(r.output_schema), verification: JSON.parse(r.verification), pricing: JSON.parse(r.pricing), sla: JSON.parse(r.sla), tags: JSON.parse(r.tags), sig: r.sig });
    }
    case "wxp_reputation":
      return toolText(await reputationFor(env, String(args.id)));
    case "wxp_get_job": {
      const j = await env.DB.prepare("SELECT id,state,price_micros,verifier,acceptance_criteria,tags,created_at FROM jobs WHERE id=?").bind(String(args.id)).first<Record<string, any>>();
      if (!j) throw new Error("Job not found");
      return toolText({ id: j.id, state: j.state, price: j.price_micros != null ? (j.price_micros / 1_000_000).toFixed(6) : null, verifier: j.verifier ? JSON.parse(j.verifier) : null, acceptanceCriteria: j.acceptance_criteria, tags: JSON.parse(j.tags || "[]"), createdAt: j.created_at });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function mcp(
  request: Request,
  env: AppEnv,
  json: (data: unknown, status?: number) => Response,
): Promise<Response> {
  if (request.method === "GET")
    return json({ name: "workrr-exchange", protocol: "mcp", transport: "http", endpoint: "/mcp", tools: TOOLS.map((t) => t.name) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let message: any;
  try {
    message = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 200);
  }
  const { id, method, params } = message || {};
  try {
    if (method === "initialize")
      return json(rpc(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "workrr-exchange", version: "0.1.0" } }));
    if (method === "notifications/initialized" || method === "notifications/cancelled")
      return new Response(null, { status: 202 });
    if (method === "ping") return json(rpc(id, {}));
    if (method === "tools/list") return json(rpc(id, { tools: TOOLS }));
    if (method === "tools/call") {
      const name = params?.name;
      try {
        const result = await callTool(env, name, params?.arguments || {});
        return json(rpc(id, result));
      } catch (e) {
        return json(rpc(id, { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : "failed"}` }], isError: true }));
      }
    }
    return json(rpcError(id, -32601, `Method not found: ${method}`));
  } catch (e) {
    return json(rpcError(id ?? null, -32603, e instanceof Error ? e.message : "Internal error"));
  }
}
