import { esc, safeTone } from "../components/icons.js";

const LANES = [
  { key: "project", label: "Projects" },
  { key: "infra", label: "Worktrees & Crons" },
  { key: "thread", label: "Threads" },
  { key: "agent", label: "Team Agents" },
];

const TONE_COLOR = {
  green: "#34d399",
  success: "#34d399",
  amber: "#e5a93c",
  warning: "#e5a93c",
  blue: "#38bdf8",
  info: "#38bdf8",
  red: "#ef4444",
  error: "#ef4444",
  gray: "#6b7280",
  idle: "#6b7280",
  muted: "#6b7280",
};

function laneForNode(node) {
  const k = String(node.kind || node.type || "").toLowerCase();
  if (k.includes("proj")) return "project";
  if (k.includes("worktree") || k.includes("cron") || k.includes("sched") || k.includes("branch"))
    return "infra";
  if (k.includes("agent") || k.includes("member") || k.includes("swarm")) return "agent";
  return "thread";
}

function deriveFallbackGraph(snap) {
  const nodes = [];
  const edges = [];
  for (const p of snap?.projects || []) {
    const pid = `proj:${p.id}`;
    nodes.push({
      id: pid,
      kind: "project",
      label: p.name,
      sublabel: p.branch || "",
      tone: p.badge?.tone || "idle",
      threadId: p.threads?.[0]?.id || "",
    });

    let parentForThreads = pid;
    if ((p.worktreeCount || 0) > 0 || (p.automationCount || 0) > 0) {
      const wid = `infra:${p.id}`;
      nodes.push({
        id: wid,
        kind: "worktree",
        label: p.worktreeCount ? `${p.worktreeCount} Worktrees` : `${p.automationCount} Automation`,
        sublabel: p.branch || "main",
        tone: p.automationCount ? "blue" : "green",
        threadId: p.threads?.[0]?.id || "",
      });
      edges.push({ from: pid, to: wid });
      parentForThreads = wid;
    }

    for (const t of p.threads || []) {
      const tid = `thread:${t.id}`;
      nodes.push({
        id: tid,
        kind: "thread",
        label: t.title,
        sublabel: t.subtitle || t.status,
        tone: t.dotTone || "gray",
        threadId: t.id,
      });
      edges.push({ from: t.isCron ? parentForThreads : pid, to: tid });

      if (t.hasTeam && (t.swarmCount || 0) > 0) {
        const aid = `agent:${t.id}`;
        nodes.push({
          id: aid,
          kind: "agent",
          label: `@coordinator +${Math.max(0, (t.swarmCount || 1) - 1)}`,
          sublabel: "Team roster",
          tone: "amber",
          threadId: t.id,
        });
        edges.push({ from: tid, to: aid });
      }
    }
  }
  return { nodes, edges };
}

function clip(text, max = 22) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function renderGraph(snap, state) {
  const rawGraph =
    snap?.graph && Array.isArray(snap.graph.nodes) && snap.graph.nodes.length > 0
      ? snap.graph
      : deriveFallbackGraph(snap);

  const q = String(state.search || "")
    .trim()
    .toLowerCase();
  const rawNodes = rawGraph.nodes || [];
  const rawEdges = rawGraph.edges || [];

  const visibleIds = new Set();
  const filteredNodes = rawNodes.filter((n) => {
    const match =
      !q ||
      [n.label, n.sublabel, n.kind, n.type].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      );
    if (match) visibleIds.add(n.id);
    return match;
  });

  if (filteredNodes.length === 0) {
    return `
      <div class="mc-empty">
        <p class="mc-empty-title">No topology nodes match</p>
        <p class="mc-empty-sub">Clear your search query to visualize projects, worktrees, cron jobs, threads, and swarm agents.</p>
      </div>
    `;
  }

  const laneBuckets = new Map(LANES.map((l) => [l.key, []]));
  for (const n of filteredNodes) {
    laneBuckets.get(laneForNode(n)).push(n);
  }

  const activeLanes = LANES.filter((l) => laneBuckets.get(l.key).length > 0);
  const colW = 215;
  const nodeW = 166;
  const nodeH = 48;
  const rowGap = 14;
  const padX = 24;
  const topY = 44;

  const maxRows = Math.max(1, ...activeLanes.map((l) => laneBuckets.get(l.key).length));
  const width = Math.max(700, padX * 2 + activeLanes.length * colW - (colW - nodeW));
  const height = Math.max(300, topY + maxRows * (nodeH + rowGap) + 22);

  const posById = new Map();
  const headersSvg = [];
  const nodesSvg = [];

  const projectFirstThread = new Map();
  for (const p of snap?.projects || []) {
    if (p.threads?.[0]?.id) projectFirstThread.set(p.id, p.threads[0].id);
  }

  activeLanes.forEach((lane, colIdx) => {
    const x = padX + colIdx * colW;
    headersSvg.push(
      `<text class="mc-graph-col-label" x="${x + 4}" y="24">${esc(lane.label)}</text>`,
    );
    const list = laneBuckets.get(lane.key);
    const totalH = list.length * nodeH + Math.max(0, list.length - 1) * rowGap;
    const availH = height - topY - 22;
    const startY = topY + Math.max(0, (availH - totalH) / 2);

    list.forEach((node, rowIdx) => {
      const y = startY + rowIdx * (nodeH + rowGap);
      posById.set(node.id, { x, y, cx: x + nodeW / 2, cy: y + nodeH / 2 });

      const tone = safeTone(node.tone, "gray");
      const dotColor = TONE_COLOR[tone] || TONE_COLOR.gray;
      const threadId =
        node.threadId ||
        (lane.key === "thread" ? String(node.id).replace(/^thread:/, "") : "") ||
        (node.projectId ? projectFirstThread.get(node.projectId) || "" : "");
      const selected = threadId && threadId === state.selectedThreadId ? " selected" : "";
      const threadAttr = threadId ? ` data-select-thread="${esc(threadId)}"` : "";

      nodesSvg.push(`
        <g class="mc-graph-node${selected}" data-graph-node="${esc(node.id)}"${threadAttr}>
          <rect class="mc-graph-node-rect" x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="8"></rect>
          <circle cx="${x + 14}" cy="${y + 18}" r="4" fill="${dotColor}"></circle>
          <text class="mc-graph-node-label" x="${x + 25}" y="${y + 21}">${esc(clip(node.label, 18))}</text>
          <text class="mc-graph-node-sub" x="${x + 12}" y="${y + 37}">${esc(clip(node.sublabel || "", 23))}</text>
        </g>
      `);
    });
  });

  const edgesSvg = [];
  for (const edge of rawEdges) {
    const fromId = edge.from ?? edge.source;
    const toId = edge.to ?? edge.target;
    if (!visibleIds.has(fromId) || !visibleIds.has(toId)) continue;
    const a = posById.get(fromId);
    const b = posById.get(toId);
    if (!a || !b) continue;
    const x1 = a.x + nodeW;
    const y1 = a.cy;
    const x2 = b.x;
    const y2 = b.cy;
    const dx = Math.max(28, Math.abs(x2 - x1) * 0.45);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    edgesSvg.push(
      `<path class="mc-graph-edge" data-edge-from="${esc(fromId)}" data-edge-to="${esc(toId)}" d="${d}"></path>`,
    );
  }

  return `
    <div class="mc-graph-wrap">
      <div class="mc-graph-legend">
        <span>Workspace Topology · Click any thread or agent node to inspect</span>
        <div class="mc-graph-legend-items">
          <span class="mc-graph-legend-item"><span class="mc-dot tone-green"></span>Live / Active</span>
          <span class="mc-graph-legend-item"><span class="mc-dot tone-amber"></span>Attention / Team</span>
          <span class="mc-graph-legend-item"><span class="mc-dot tone-blue"></span>Cron / Scheduled</span>
          <span class="mc-graph-legend-item"><span class="mc-dot tone-gray"></span>Done / Idle</span>
        </div>
      </div>
      <div class="mc-graph-scroll">
        <svg class="mc-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mission Control topology graph">
          <g class="mc-graph-headers">${headersSvg.join("")}</g>
          <g class="mc-graph-edges">${edgesSvg.join("")}</g>
          <g class="mc-graph-nodes">${nodesSvg.join("")}</g>
        </svg>
      </div>
    </div>
  `;
}
