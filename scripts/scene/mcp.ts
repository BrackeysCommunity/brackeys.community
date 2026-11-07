import { ENGINE_VERSION } from "@jams/engine";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ToolContext } from "./context";
import { defaultToolContext } from "./default-context";
import { MCP_TOOLS, runMcpTool } from "./mcp-tools";

export const MCP_SERVER_NAME = "jams-scenes";

/**
 * The scene tools as an MCP server over `ctx`: the CLI's commands, one MCP
 * tool each. Versioned with the engine, whose agent surface the tool names
 * belong to.
 */
export function createSceneMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: ENGINE_VERSION });
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (input: Record<string, unknown>) =>
        (await runMcpTool(tool, input, ctx)) as CallToolResult,
    );
  }
  return server;
}

if (import.meta.main) {
  // stdin is the transport, so no tool reads `-` from it.
  await createSceneMcpServer(defaultToolContext()).connect(new StdioServerTransport());
}
