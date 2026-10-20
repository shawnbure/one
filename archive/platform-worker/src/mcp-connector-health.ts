import { getAgentByName } from "agents";
import type { McpConnectorAgent } from "./mcp-connector-agent";
import { emitNotification } from "./notifications";
import type { Env } from "./types";

interface ConnectorRow {
  id: string;
  tenant_id: string;
  name: string;
  health_alerted_at: string | null;
}

export async function checkMcpConnectorHealth(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT id, tenant_id, name, health_alerted_at
    FROM mcp_connectors
    WHERE status IN ('ready','attention')
      AND (last_checked_at IS NULL OR datetime(last_checked_at) <= datetime(?,'-30 minutes'))
    ORDER BY COALESCE(last_checked_at, created_at), tenant_id, id LIMIT 50`)
    .bind(now.toISOString()).all<ConnectorRow>();
  let healthy = 0;
  let attention = 0;
  let alerted = 0;
  for (const connector of results) {
    try {
      const actor = await getAgentByName<Env, McpConnectorAgent>(
        env.MCP_CONNECTOR, `${connector.tenant_id}/${connector.id}`
      );
      const inspection = await actor.inspectConnector(connector.tenant_id, connector.id);
      const server = inspection.servers[0];
      if (server?.state === "ready") {
        await env.DB.prepare(`UPDATE mcp_connectors SET status='ready', last_checked_at=?,
          last_success_at=?, last_error=NULL, health_alerted_at=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND tenant_id=?`).bind(
            now.toISOString(), now.toISOString(), connector.id, connector.tenant_id
          ).run();
        healthy += 1;
        continue;
      }
      const detail = boundedError(server?.error ?? `Connector state is ${server?.state ?? "unavailable"}`);
      const outcome = await markAttention(env, connector, detail, now);
      attention += 1;
      alerted += outcome.alerted;
    } catch (error) {
      const outcome = await markAttention(env, connector, boundedError(error), now);
      attention += 1;
      alerted += outcome.alerted;
    }
  }
  return { checked: results.length, healthy, attention, alerted };
}

async function markAttention(env: Env, connector: ConnectorRow, detail: string, now: Date) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE mcp_connectors SET status='attention', last_checked_at=?,
      last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(now.toISOString(), detail, connector.id, connector.tenant_id),
    env.DB.prepare(`UPDATE mcp_connector_tools SET enabled=0, revision=revision+1,
      updated_at=CURRENT_TIMESTAMP WHERE connector_id=? AND tenant_id=? AND enabled=1`)
      .bind(connector.id, connector.tenant_id)
  ]);
  const prior = connector.health_alerted_at ? new Date(connector.health_alerted_at).getTime() : 0;
  if (Number.isFinite(prior) && prior > now.getTime() - 24 * 60 * 60_000) return { alerted: 0 };
  await emitNotification(env, connector.tenant_id, {
    eventType: "connection.mcp_attention",
    title: "MCP connector needs attention",
    detail: `${connector.name} is unavailable. Its capabilities were disabled. Reauthorize or inspect the connector from Connections.`,
    targetType: "mcp_connector",
    targetId: connector.id
  });
  await env.DB.prepare(`UPDATE mcp_connectors SET health_alerted_at=?
    WHERE id=? AND tenant_id=?`).bind(now.toISOString(), connector.id, connector.tenant_id).run();
  return { alerted: 1 };
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .slice(0, 300);
}
