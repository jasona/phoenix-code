import * as NodeReadline from "node:readline";
import document from "./document.json" with { type: "json" };

const uri = "ui://mission-control/dashboard";
const tool = {
  name: "dashboard",
  description: "Open Mission Control",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
  _meta: { ui: { resourceUri: uri } },
};
for await (const line of NodeReadline.createInterface({ input: process.stdin })) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.id === undefined) continue;
    let result;
    switch (request.method) {
      case "initialize":
        result = {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "mission-control", version: "1.0.0" },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: [tool] };
        break;
      case "resources/list":
        result = {
          resources: [{ uri, name: "Mission Control", mimeType: "text/html;profile=mcp-app" }],
        };
        break;
      case "tools/call":
        if (request.params?.name !== tool.name) throw new Error("Unknown tool");
        result = { content: [{ type: "text", text: "Mission Control" }] };
        break;
      case "resources/read":
        if (request.params?.uri !== uri) throw new Error("Unknown resource");
        result = {
          contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: document.html }],
        };
        break;
      default:
        throw new Error("Unknown method");
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: -32603, message: error.message },
      }) + "\n",
    );
  }
}
