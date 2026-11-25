import * as NodeReadline from "node:readline";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const file = NodePath.join(process.env.PHOENIX_PLUGIN_DATA, "completions.json");
let completions = [];
try {
  completions = JSON.parse(await NodeFSP.readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
console.log("Project Board sidecar ready; waiting for scoped thread completions.");
for await (const line of NodeReadline.createInterface({ input: process.stdin })) {
  const event = JSON.parse(line);
  if (event.type !== "thread.completed" || completions.some((item) => item.runId === event.runId))
    continue;
  completions = [...completions, event].slice(-100);
  await NodeFSP.writeFile(`${file}.tmp`, JSON.stringify(completions));
  await NodeFSP.rename(`${file}.tmp`, file);
  console.log(`Recorded completion for thread ${event.threadId}.`);
}
