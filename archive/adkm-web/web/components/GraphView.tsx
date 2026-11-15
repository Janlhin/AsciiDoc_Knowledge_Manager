import { useEffect, useRef } from "react";
import type { GraphData } from "../../shared/types.ts";

interface GNode {
  id: string;
  title: string;
  format: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
  r: number;
  missing?: boolean;
  placed?: boolean;
}
interface GEdge {
  s: GNode;
  t: GNode;
  kind: string;
  status: string;
  line: number;
  vis?: boolean;
}

const COL = {
  adoc: "#7f77dd",
  md: "#3f9e75",
  asset: "#6b6b78",
  missing: "#e24b4a",
  eXref: "rgba(127,119,221,.40)",
  eWiki: "rgba(63,158,117,.36)",
  eBad: "rgba(226,75,74,.55)",
  label: "#9a9aa8",
  labelHi: "#ececf4",
};

export function GraphView({
  graph,
  onOpen,
}: {
  graph: GraphData;
  onOpen: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    nodes: GNode[];
    edges: GEdge[];
    all: GNode[];
    connected: Set<string>;
    hover: GNode | null;
    drag: GNode | null;
    panning: boolean;
    last: { x: number; y: number };
    scale: number;
    tx: number;
    ty: number;
    heat: number;
  } | null>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctx0 = canvasEl.getContext("2d");
    if (!ctx0) return;
    // 显式非空别名：函数声明会被提升，闭包内无法沿用流分析结果
    const cv: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctx0;

    let W = 0;
    let H = 0;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    // ---- 建图 ----
    const byId = new Map<string, GNode>();
    for (const n of graph.nodes) {
      byId.set(n.id, { id: n.id, title: n.title, format: n.format, x: 0, y: 0, vx: 0, vy: 0, deg: 0, r: 4 });
    }
    const edges: GEdge[] = [];
    for (const e of graph.edges) {
      const s = byId.get(e.source);
      if (!s) continue;
      let t = byId.get(e.target);
      if (!t) {
        t = { id: e.target, title: e.target.replace(/^\?/, ""), format: "missing", x: 0, y: 0, vx: 0, vy: 0, deg: 0, r: 4, missing: true };
        byId.set(e.target, t);
      }
      s.deg++;
      t.deg++;
      edges.push({ s, t, kind: e.kind, status: e.status, line: e.line });
    }
    const all = Array.from(byId.values());
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.s.id);
      connected.add(e.t.id);
    }

    const st = {
      nodes: [] as GNode[],
      edges,
      all,
      connected,
      hover: null as GNode | null,
      drag: null as GNode | null,
      panning: false,
      last: { x: 0, y: 0 },
      scale: 1,
      tx: 0,
      ty: 0,
      heat: 0.9,
    };
    stateRef.current = st;

    function resize(): void {
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
    }
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(cv);

    // ---- 布局 ----
    const vis = all.filter((n) => connected.has(n.id));
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.34;
    const maxDeg = Math.max(1, ...vis.map((n) => n.deg));
    vis.forEach((n, i) => {
      const a = (i / Math.max(vis.length, 1)) * Math.PI * 2;
      const j = 0.55 + Math.random() * 0.7;
      n.x = cx + Math.cos(a) * R * j;
      n.y = cy + Math.sin(a) * R * j;
      n.r = n.format === "asset" ? 3.6 : 3.5 + Math.min(Math.sqrt(n.deg / maxDeg) * 12, 12);
      n.placed = true;
    });
    const visSet = new Set(vis.map((n) => n.id));
    for (const e of edges) e.vis = visSet.has(e.s.id) && visSet.has(e.t.id);
    st.nodes = vis;

    function step(): void {
      if (st.heat < 0.004) return;
      const n = st.nodes.length;
      for (let i = 0; i < n; i++) {
        const a = st.nodes[i];
        for (let k = i + 1; k < n; k++) {
          const b = st.nodes[k];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 0.01;
          }
          if (d2 > 300000) continue;
          const d = Math.sqrt(d2);
          const f = (1500 * st.heat) / d2;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      for (const e of st.edges) {
        if (!e.vis) continue;
        const dx = e.t.x - e.s.x;
        const dy = e.t.y - e.s.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = ((d - 105) / d) * 0.042 * st.heat;
        e.s.vx += dx * f;
        e.s.vy += dy * f;
        e.t.vx -= dx * f;
        e.t.vy -= dy * f;
      }
      for (const p of st.nodes) {
        p.vx += (W / 2 - p.x) * 0.0024 * st.heat;
        p.vy += (H / 2 - p.y) * 0.0024 * st.heat;
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.x += p.vx;
        p.y += p.vy;
      }
      st.heat *= 0.986;
    }

    function toWorld(px: number, py: number): { x: number; y: number } {
      return { x: (px - st.tx) / st.scale, y: (py - st.ty) / st.scale };
    }

    function hit(px: number, py: number): GNode | null {
      const w = toWorld(px, py);
      let best: GNode | null = null;
      let bestD = Infinity;
      for (const n of st.nodes) {
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        const tol = Math.max(n.r + 6 / st.scale, 10 / st.scale);
        if (d < tol && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    }

    function draw(): void {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = "#141418";
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(DPR * st.scale, 0, 0, DPR * st.scale, DPR * st.tx, DPR * st.ty);

      const adj = new Set<string>();
      if (st.hover) {
        adj.add(st.hover.id);
        for (const e of st.edges) {
          if (!e.vis) continue;
          if (e.s === st.hover) adj.add(e.t.id);
          if (e.t === st.hover) adj.add(e.s.id);
        }
      }

      for (const e of st.edges) {
        if (!e.vis) continue;
        const hi = st.hover && (e.s === st.hover || e.t === st.hover);
        ctx.beginPath();
        ctx.moveTo(e.s.x, e.s.y);
        ctx.lineTo(e.t.x, e.t.y);
        if (e.status !== "resolved") {
          ctx.strokeStyle = COL.eBad;
          ctx.setLineDash([4, 4]);
        } else if (e.kind === "wikilink" || e.kind === "markdown-link") {
          ctx.strokeStyle = COL.eWiki;
          ctx.setLineDash([3, 3]);
        } else {
          ctx.strokeStyle = COL.eXref;
          ctx.setLineDash([]);
        }
        ctx.lineWidth = hi ? 1.9 : 0.85;
        ctx.globalAlpha = st.hover ? (hi ? 1 : 0.15) : 1;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      for (const n of st.nodes) {
        const isHs = n === st.hover;
        ctx.globalAlpha = st.hover ? (adj.has(n.id) ? 1 : 0.18) : 0.94;
        const base = n.missing
          ? COL.missing
          : n.format === "asciidoc"
            ? COL.adoc
            : n.format === "markdown"
              ? COL.md
              : COL.asset;

        if (isHs) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 6, 0, Math.PI * 2);
          ctx.fillStyle = base + "2e";
          ctx.fill();
        }
        if (n.format === "asset" && !n.missing) {
          const s = n.r * 1.5;
          ctx.fillStyle = base;
          ctx.fillRect(n.x - s / 2, n.y - s / 2, s, s);
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx.fillStyle = base;
          ctx.fill();
        }

        if (n.format !== "asset" && (isHs || n.deg >= 3)) {
          const fs = Math.min(11 + Math.sqrt(n.deg) * 0.35, 13.5);
          ctx.font = `400 ${fs}px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`;
          ctx.fillStyle = isHs ? COL.labelHi : COL.label;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const nm = n.id.split("/").pop()?.replace(/\.(adoc|md)$/i, "") ?? n.id;
          ctx.fillText(nm.length > 28 ? nm.slice(0, 27) + "…" : nm, n.x, n.y + n.r + 5);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- 交互 ----
    function onMove(ev: MouseEvent): void {
      const rect = cv.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;

      if (st.drag) {
        const w = toWorld(px, py);
        st.drag.x = w.x;
        st.drag.y = w.y;
        st.heat = Math.max(st.heat, 0.45);
        return;
      }
      if (st.panning) {
        st.tx += ev.clientX - st.last.x;
        st.ty += ev.clientY - st.last.y;
        st.last = { x: ev.clientX, y: ev.clientY };
        return;
      }
      st.hover = hit(px, py);
      cv.style.cursor = st.hover ? "pointer" : "grab";

      const tip = tipRef.current;
      if (tip) {
        if (st.hover) {
          const rel = st.edges.filter((e) => e.vis && (e.t === st.hover || e.s === st.hover)).slice(0, 5);
          const lines = rel.map((e) => {
            const out = e.s === st.hover;
            const other = out ? e.t : e.s;
            return `${out ? "→" : "←"} ${other.id.split("/").pop()} L${e.line}`;
          });
          tip.style.display = "block";
          tip.style.left = Math.min(px + 15, W - 340) + "px";
          tip.style.top = Math.min(py + 15, H - 130) + "px";
          tip.innerHTML =
            `<div class="t1">${esc(st.hover.title || st.hover.id)}</div>` +
            `<div class="t2">${esc(st.hover.format)} · ${st.hover.deg} 个连接</div>` +
            `<div class="t3">${esc(st.hover.id)}</div>` +
            (lines.length ? `<div class="t2">${lines.map(esc).join("<br>")}</div>` : "");
        } else {
          tip.style.display = "none";
        }
      }
    }

    function onDown(ev: MouseEvent): void {
      const rect = cv.getBoundingClientRect();
      const n = hit(ev.clientX - rect.left, ev.clientY - rect.top);
      if (n && n.format !== "asset") {
        st.drag = n;
        cv.classList.add("dragging");
        st.heat = Math.max(st.heat, 0.5);
      } else {
        st.panning = true;
        st.last = { x: ev.clientX, y: ev.clientY };
        cv.classList.add("dragging");
      }
    }

    function onUp(): void {
      if (st.drag && st.drag.format !== "asset") {
        // 拖动距离很小时当作点击
        const moved = Math.hypot(st.drag.vx, st.drag.vy);
        if (moved < 0.4) onOpen(st.drag.id);
      }
      st.drag = null;
      st.panning = false;
      cv.classList.remove("dragging");
    }

    function onWheel(ev: WheelEvent): void {
      ev.preventDefault();
      const rect = cv.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      const before = toWorld(px, py);
      st.scale = Math.min(5, Math.max(0.2, st.scale * (ev.deltaY > 0 ? 0.9 : 1.1)));
      st.tx = px - before.x * st.scale;
      st.ty = py - before.y * st.scale;
    }

    cv.addEventListener("mousemove", onMove);
    cv.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });

    let raf = 0;
    function loop(): void {
      if (st.heat >= 0.004) step();
      draw();
      raf = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("mousemove", onMove);
      cv.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      cv.removeEventListener("wheel", onWheel);
    };
  }, [graph, onOpen]);

  const stats = graph.stats;

  return (
    <div className="graph-wrap">
      <canvas ref={canvasRef} className="graph-canvas" />
      <div className="graph-hud">
        <div className="r"><span>节点</span><span>{graph.nodes.length}</span></div>
        <div className="r"><span>引用</span><span>{graph.edges.length}</span></div>
        <div className="r"><span>有效</span><span>{stats.resolved}</span></div>
        <div className="r"><span>断链</span><span>{stats.broken + stats.unresolved}</span></div>
        <div className="r"><span>已连接</span><span>{stats.connected}</span></div>
        <div className="r"><span>孤立</span><span>{stats.orphaned}</span></div>
        <div className="graph-legend">
          <div className="legend-item"><span className="legend-dot" style={{ background: COL.adoc }} />AsciiDoc</div>
          <div className="legend-item"><span className="legend-dot" style={{ background: COL.md }} />Markdown</div>
          <div className="legend-item"><span className="legend-sq" style={{ background: COL.asset }} />资源</div>
        </div>
      </div>
      <div className="graph-tip" ref={tipRef} />
    </div>
  );
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
