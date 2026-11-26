import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const PUBLIC_DIR = NodePath.join(__dirname, "ui");

const MODULES = [
  { id: "drafts.js", rel: "drafts.js" },
  { id: "components/icons.js", rel: "components/icons.js" },
  { id: "components/modal.js", rel: "components/modal.js" },
  { id: "views/overview.js", rel: "views/overview.js" },
  { id: "views/inbox.js", rel: "views/inbox.js" },
  { id: "views/board.js", rel: "views/board.js" },
  { id: "views/timeline.js", rel: "views/timeline.js" },
  { id: "views/graph.js", rel: "views/graph.js" },
  { id: "views/verification.js", rel: "views/verification.js" },
  { id: "activity.js", rel: "activity.js" },
  { id: "views/inspector.js", rel: "views/inspector.js" },
  { id: "views/usage.js", rel: "views/usage.js" },
  { id: "app-main.js", rel: "app-main.js" },
];

function resolveModuleId(fromRel, spec) {
  const baseDir = NodePath.dirname(fromRel);
  const resolved = NodePath.resolve("/", baseDir, spec).slice(1);
  return resolved;
}

function transformModule(mod) {
  const src = NodeFS.readFileSync(NodePath.join(PUBLIC_DIR, mod.rel), "utf-8");
  const exportNames = [];

  // Transform multi-line and single-line ES module imports into local bindings from __MC.
  let code = src.replace(
    /^\s*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm,
    (_full, specifiers, fromPath) => {
      const targetId = resolveModuleId(mod.rel, fromPath);
      const cleanSpecs = specifiers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\s+as\s+/g, ": "))
        .join(", ");
      return `const { ${cleanSpecs} } = __MC[${JSON.stringify(targetId)}];`;
    },
  );

  // Transform export function declarations.
  code = code.replace(
    /^\s*export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    (_m, asyncKw, name) => {
      exportNames.push(name);
      return `${asyncKw || ""}function ${name}`;
    },
  );

  // Transform export const/let/var declarations.
  code = code.replace(/^\s*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => {
    exportNames.push(name);
    return `${kind} ${name}`;
  });

  // Transform export { a, b } blocks if any.
  code = code.replace(/^\s*export\s*\{([\s\S]*?)\};?\s*$/gm, (_m, list) => {
    for (const entry of list.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const localName = parts[0].trim();
      const exportName = (parts[1] || parts[0]).trim();
      exportNames.push({ localName, exportName });
    }
    return "";
  });

  const exportEntries = exportNames.map((entry) =>
    typeof entry === "string" ? `${entry}: ${entry}` : `${entry.exportName}: ${entry.localName}`,
  );

  const indented = code
    .split("\n")
    .map((line) => (line ? `    ${line}` : ""))
    .join("\n");

  return [
    `  // --- ${mod.rel} ---`,
    `  __MC[${JSON.stringify(mod.id)}] = (() => {`,
    indented,
    `    return { ${exportEntries.join(", ")} };`,
    `  })();`,
  ].join("\n");
}

function buildClientBundle() {
  const parts = [
    "/* Auto-generated classic non-module bundle by build-client.mjs. Do not edit directly; edit app-main.js, views/*, or components/* and re-run build-client.mjs. */",
    "(function () {",
    "  'use strict';",
    "  const __MC = Object.create(null);",
    "",
    ...MODULES.map(transformModule),
    "})();",
    "",
  ];

  const bundle = parts.join("\n");

  // Verify classic non-module script syntax (throws SyntaxError if any import/export leaked).
  void new Function(bundle);

  const css = NodeFS.readFileSync(NodePath.join(PUBLIC_DIR, "styles.css"), "utf8");
  const bridge = NodeFS.readFileSync(NodePath.join(PUBLIC_DIR, "phoenix.js"), "utf8");
  const template = NodeFS.readFileSync(NodePath.join(PUBLIC_DIR, "index.html"), "utf8");
  const html = template
    .replace("<!-- styles -->", () => "<style>" + css + "</style>")
    .replace(
      "<!-- scripts -->",
      () =>
        "<script>" +
        bridge +
        "</script><script>" +
        bundle.replaceAll("</script", "<\\/script") +
        "</script>",
    );
  const outPath = NodePath.join(__dirname, "document.json");
  const serialized = JSON.stringify({ html }, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (NodeFS.readFileSync(outPath, "utf8") !== serialized)
      throw new Error("Run node plugins/mission-control/build-client.mjs");
  } else NodeFS.writeFileSync(outPath, serialized);
  return { outPath, bytes: Buffer.byteLength(html) };
}
buildClientBundle();
