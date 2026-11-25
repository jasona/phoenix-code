import * as NodeReadline from "node:readline";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const directory = process.env.PHOENIX_PLUGIN_DATA;
if (!directory) throw new Error("Install and enable this plugin in Phoenix.");
await NodeFSP.mkdir(directory, { recursive: true });
const dataPath = NodePath.join(directory, "tasks.json");
let tasks;
try {
  tasks = JSON.parse(await NodeFSP.readFile(dataPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  tasks = [];
}
const tools = [
  {
    name: "board",
    description: "Open the project board",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: "ui://project-board/board" } },
  },
  {
    name: "add_task",
    description: "Add a task",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    _meta: { ui: { visibility: ["app"] } },
  },
  {
    name: "toggle_task",
    description: "Toggle a task",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    _meta: { ui: { visibility: ["app"] } },
  },
];
const result = (projectId, completions) => ({
  content: [
    { type: "text", text: `${tasks.filter((task) => task.projectId === projectId).length} tasks` },
  ],
  structuredContent: {
    tasks: tasks.filter((task) => task.projectId === projectId),
    processId: process.pid,
    completions,
  },
});
const lines = NodeReadline.createInterface({ input: process.stdin });
for await (const line of lines) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.id === undefined) continue;
    let response;
    switch (request.method) {
      case "initialize":
        response = {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "project-board", version: "0.1.0" },
        };
        break;
      case "ping":
        response = {};
        break;
      case "tools/list":
        response = { tools };
        break;
      case "resources/read":
        if (request.params.uri !== "ui://project-board/board") throw new Error("Unknown resource");
        response = {
          contents: [
            {
              uri: request.params.uri,
              mimeType: "text/html;profile=mcp-app",
              text: await NodeFSP.readFile(new URL("board.html", import.meta.url), "utf8"),
            },
          ],
        };
        break;
      case "tools/call": {
        const { name, arguments: args = {} } = request.params;
        const projectId = args._phoenix?.projectId ?? args.projectId;
        if (name === "add_task") {
          if (
            typeof args.title !== "string" ||
            !args.title.trim() ||
            args.title.length > 500 ||
            tasks.length >= 1000
          )
            throw new Error("Enter a task title under 500 characters (maximum 1000 tasks).");
          tasks.push({
            id: crypto.randomUUID(),
            title: args.title.trim(),
            done: false,
            ...(projectId ? { projectId } : {}),
          });
        } else if (name === "toggle_task") {
          const task = tasks.find((task) => task.id === args.id && task.projectId === projectId);
          if (!task) throw new Error("Task no longer exists");
          task.done = !task.done;
        } else if (name !== "board") throw new Error("Unknown tool");
        if (name !== "board") {
          await NodeFSP.writeFile(`${dataPath}.tmp`, JSON.stringify(tasks));
          await NodeFSP.rename(`${dataPath}.tmp`, dataPath);
        }
        let completions = [];
        try {
          completions = JSON.parse(
            await NodeFSP.readFile(NodePath.join(directory, "completions.json"), "utf8"),
          ).filter((event) => event.projectId === projectId);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        response = result(projectId, completions);
        break;
      }
      default:
        throw new Error("Unsupported method");
    }
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response })}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32603, message: error.message } })}\n`,
    );
  }
}
