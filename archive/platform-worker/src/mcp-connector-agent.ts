import { Agent } from "agents";
import type { Env } from "./types";

interface ConnectorState {
  tenantId: string | null;
  connectorId: string | null;
  serverId: string | null;
}

interface ExecutableTool {
  execute: (input: unknown, options: {
    toolCallId: string;
    messages: [];
    abortSignal: AbortSignal;
  }) => unknown | PromiseLike<unknown>;
}

export interface McpConnectorInspection {
  servers: Array<{ id: string; name: string; state: string; error: string | null }>;
  tools: Array<{
    serverId: string; name: string; aiToolName: string; title: string;
    description: string; inputSchemaJson: string;
  }>;
}

export class McpConnectorAgent extends Agent<Env, ConnectorState> {
  static options = { sendIdentityOnConnect: false };
  initialState: ConnectorState = { tenantId: null, connectorId: null, serverId: null };

  onStart(): void {
    this.mcp.configureOAuthCallback({
      successRedirect: `https://${this.env.APP_DOMAIN}/?workspace=connections&section=mcp&mcp=connected`,
      errorRedirect: `https://${this.env.APP_DOMAIN}/?workspace=connections&section=mcp&mcp=error`
    });
  }

  bindIdentity(tenantId: string, connectorId: string): void {
    if (this.state.tenantId && this.state.tenantId !== tenantId) throw new Error("MCP connector tenant mismatch");
    if (this.state.connectorId && this.state.connectorId !== connectorId) {
      throw new Error("MCP connector identity mismatch");
    }
    if (!this.state.tenantId || !this.state.connectorId) {
      this.setState({ ...this.state, tenantId, connectorId });
    }
  }

  async configureConnector(input: {
    tenantId: string; connectorId: string; name: string; url: string;
    transport: "streamable-http" | "sse" | "auto"; callbackHost: string;
  }) {
    this.bindIdentity(input.tenantId, input.connectorId);
    const serverId = stableServerId(input.connectorId);
    const result = await this.addMcpServer(input.name, input.url, {
      id: serverId,
      callbackHost: input.callbackHost,
      callbackPath: "oauth/mcp/callback",
      transport: { type: input.transport },
      retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5_000 }
    });
    this.setState({ ...this.state, serverId });
    return result;
  }

  async inspectConnector(tenantId: string, connectorId: string): Promise<McpConnectorInspection> {
    this.bindIdentity(tenantId, connectorId);
    const state = this.getMcpServers();
    return Promise.resolve({
      servers: Object.entries(state.servers).map(([id, server]) => ({
        id, name: server.name, state: server.state,
        error: server.error ? String(server.error).slice(0, 300) : null
      })),
      tools: this.mcp.listTools().map((tool) => ({
        serverId: tool.serverId,
        name: tool.name,
        aiToolName: `tool_${tool.serverId}_${tool.name}`,
        title: String(tool.title ?? tool.annotations?.title ?? tool.name).slice(0, 120),
        description: String(tool.description ?? "MCP capability").slice(0, 500),
        inputSchemaJson: JSON.stringify(tool.inputSchema ?? { type: "object", additionalProperties: true })
      }))
    });
  }

  async invokeConnectorTool(
    tenantId: string, connectorId: string, aiToolName: string, inputJson: string
  ): Promise<string> {
    this.bindIdentity(tenantId, connectorId);
    const toolDefinition: unknown = this.mcp.getAITools()[aiToolName];
    if (!isExecutableTool(toolDefinition)) throw new Error("MCP tool is not available on this connector");
    const input = parseBoundedJson(inputJson);
    const result = await toolDefinition.execute(input, {
      toolCallId: crypto.randomUUID(), messages: [], abortSignal: AbortSignal.timeout(15_000)
    });
    const serialized = JSON.stringify(result ?? null);
    if (serialized.length > 65_536) throw new Error("MCP tool result exceeded the 64 KB safety limit");
    return serialized;
  }

  async disconnectConnector(tenantId: string, connectorId: string) {
    this.bindIdentity(tenantId, connectorId);
    if (this.state.serverId) await this.removeMcpServer(this.state.serverId);
    this.setState({ ...this.state, serverId: null });
    return { disconnected: true };
  }
}

function stableServerId(connectorId: string) {
  return `workrr-${connectorId.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`.slice(0, 48);
}

function isExecutableTool(value: unknown): value is ExecutableTool {
  return Boolean(value && typeof value === "object" &&
    typeof (value as { execute?: unknown }).execute === "function");
}

function parseBoundedJson(value: string): unknown {
  if (value.length > 32_768) throw new Error("MCP tool input exceeded the 32 KB safety limit");
  try { return JSON.parse(value) as unknown; }
  catch { throw new Error("MCP tool input must be valid JSON"); }
}
