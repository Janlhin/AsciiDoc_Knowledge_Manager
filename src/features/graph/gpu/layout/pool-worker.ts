/**
 * T-063 (#20) — pool worker entry.
 *
 * One worker owns one shard. It reads the shared position snapshot, accumulates
 * repulsion for its shard nodes (near field via a rebuilt uniform grid, far field
 * via per-shard summaries) and spring forces for the edges assigned to its shard,
 * then posts force slices back to the client. The client owns positions, velocity
 * and the integration pass, so workers stay stateless proposers.
 *
 * No big array is allocated per tick: snapshot views, grid scratch and force
 * slices are allocated once at `init` and ping-pong / reused afterwards.
 */
import { LAYOUT_DEFAULTS } from "../types";
import type { LayoutOptions } from "../types";
import { repelPair, springPair } from "./forces";
import type {
  PoolInMessage,
  PoolOutMessage,
  PoolTickMessage,
  RemoteForce,
  ShardSummarySync,
} from "./protocol";

const ctx = self as unknown as {
  postMessage(message: PoolOutMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<PoolInMessage>) => void) | null;
};

const NEAR_FACTOR = 2;

interface WorkerState {
  workerId: number;
  n: number;
  ownCount: number;
  shardOf: Int32Array;
  shardStart: Int32Array;
  shardNodes: Int32Array;
  edgeStart: Int32Array;
  edgeByShard: Int32Array;
  es: Int32Array;
  et: Int32Array;
  mass: Float32Array;
  opts: LayoutOptions;
  sab: boolean;
  /** owned-node → scratch slot index; -1 for other shards. */
  slotOf: Int32Array;
  /** snapshot positions (private copy on the transferable path, SAB view otherwise). */
  sx: Float32Array;
  sy: Float32Array;
  fx: Float32Array;
  fy: Float32Array;
  summaries: ShardSummarySync;
  // grid scratch, reused every tick
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  cellSize: number;
  near2: number;
  cellCount: Int32Array;
  cellStart: Int32Array;
  cursor: Int32Array;
  order: Int32Array;
  frozen: boolean;
}

let state: WorkerState | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function buildGrid(st: WorkerState): void {
  const n = st.n;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const xi = st.sx[i];
    const yi = st.sy[i];
    if (xi < minX) minX = xi;
    if (xi > maxX) maxX = xi;
    if (yi < minY) minY = yi;
    if (yi > maxY) maxY = yi;
  }
  const bw = Math.max(maxX - minX, 1e-6);
  const bh = Math.max(maxY - minY, 1e-6);
  const targetCells = Math.max(1, Math.ceil(n / 3));
  const span = Math.max(bw, bh);
  const cs = Math.max(st.opts.linkDistance * 0.5, span / Math.sqrt(targetCells));
  st.cellSize = cs;
  st.cols = Math.max(1, Math.ceil(bw / cs));
  st.rows = Math.max(1, Math.ceil(bh / cs));

  st.minX = minX;
  st.minY = minY;
  st.near2 = (NEAR_FACTOR * st.opts.linkDistance) ** 2;

  const cells = st.cols * st.rows;
  st.cellCount.fill(0, 0, cells);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(st.cols - 1, Math.floor((st.sx[i] - minX) / cs));
    const cy = Math.min(st.rows - 1, Math.floor((st.sy[i] - minY) / cs));
    st.cellCount[cx + cy * st.cols]++;
  }
  let acc = 0;
  for (let c = 0; c < cells; c++) {
    st.cellStart[c] = acc;
    acc += st.cellCount[c];
  }
  st.cursor.set(st.cellStart.subarray(0, cells));
  for (let i = 0; i < n; i++) {
    const cx = Math.min(st.cols - 1, Math.floor((st.sx[i] - minX) / cs));
    const cy = Math.min(st.rows - 1, Math.floor((st.sy[i] - minY) / cs));
    const cell = cx + cy * st.cols;
    st.order[st.cursor[cell]++] = i;
  }
}

function repelNear(st: WorkerState, i: number, slot: number): void {
  const xi = st.sx[i];
  const yi = st.sy[i];
  const cs = st.cellSize;
  const cols = st.cols;
  const rows = st.rows;
  const ccx = Math.min(cols - 1, Math.max(0, Math.floor((xi - st.minX) / cs)));
  const ccy = Math.min(rows - 1, Math.max(0, Math.floor((yi - st.minY) / cs)));

  for (let ny = ccy - 1; ny <= ccy + 1; ny++) {
    if (ny < 0 || ny >= rows) continue;
    for (let nx = ccx - 1; nx <= ccx + 1; nx++) {
      if (nx < 0 || nx >= cols) continue;
      const cell = nx + ny * cols;
      let k = st.cellStart[cell];
      const end = k + st.cellCount[cell];
      while (k < end) {
        const j = st.order[k];
        k++;
        if (j === i) continue;
        const dx = st.sx[j] - xi;
        const dy = st.sy[j] - yi;
        if (dx * dx + dy * dy > st.near2) continue;
        const p = repelPair(st.opts.charge, st.mass[j], xi, yi, st.sx[j], st.sy[j]);
        st.fx[slot] += p.fx;
        st.fy[slot] += p.fy;
      }
    }
  }
}

function repelFar(st: WorkerState, i: number, slot: number): void {
  const xi = st.sx[i];
  const yi = st.sy[i];
  const sum = st.summaries;
  for (let s = 0; s < sum.mass.length; s++) {
    if (s === st.workerId) continue;
    const m = sum.mass[s];
    if (m <= 0) continue;
    const dx = sum.comX[s] - xi;
    const dy = sum.comY[s] - yi;
    const d2 = dx * dx + dy * dy + 1;
    const d = Math.sqrt(d2);
    const f = (st.opts.charge * m) / d2;
    st.fx[slot] -= (dx / d) * f;
    st.fy[slot] -= (dy / d) * f;
  }
}

function runStep(st: WorkerState, wakeSet: Int32Array | undefined): PoolTickMessage {
  const t0 = nowMs();
  st.fx.fill(0);
  st.fy.fill(0);

  buildGrid(st);
  const tGrid = nowMs();

  const active: readonly number[] = wakeSet ? Array.from(wakeSet) : ownNodes(st);
  for (const i of active) {
    const slot = st.slotOf[i];
    if (slot < 0) continue;
    repelNear(st, i, slot);
    repelFar(st, i, slot);
  }
  const tRep = nowMs();

  const remote: RemoteForce[] = [];
  const link = st.opts.linkDistance;
  for (let k = st.edgeStart[st.workerId]; k < st.edgeStart[st.workerId + 1]; k++) {
    const e = st.edgeByShard[k];
    const s = st.es[e];
    const t = st.et[e];
    const sp = springPair(link, st.sx[s], st.sy[s], st.sx[t], st.sy[t]);
    const slot = st.slotOf[s];
    if (slot >= 0) {
      st.fx[slot] += sp.fx;
      st.fy[slot] += sp.fy;
    }
    if (st.shardOf[t] !== st.workerId) {
      remote.push({ index: t, fx: -sp.fx, fy: -sp.fy });
    }
  }
  const tSprings = nowMs();

  return {
    type: "tick",
    workerId: st.workerId,
    epoch: 0,
    fx: st.fx,
    fy: st.fy,
    remote,
    stageMs: {
      buildGridMs: tGrid - t0,
      repulsionMs: tRep - tGrid,
      springsMs: tSprings - tRep,
    },
  };
}

function ownNodes(st: WorkerState): readonly number[] {
  const out: number[] = [];
  for (let k = st.shardStart[st.workerId]; k < st.shardStart[st.workerId + 1]; k++) {
    out.push(st.shardNodes[k]);
  }
  return out;
}

ctx.onmessage = (event: MessageEvent<PoolInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      const opts: LayoutOptions = { ...LAYOUT_DEFAULTS, ...(msg.opts ?? {}) };
      const ownCount = msg.shardStart[msg.workerId + 1] - msg.shardStart[msg.workerId];
      const slotOf = new Int32Array(msg.shardOf.length).fill(-1);
      for (let k = msg.shardStart[msg.workerId]; k < msg.shardStart[msg.workerId + 1]; k++) {
        slotOf[msg.shardNodes[k]] = k - msg.shardStart[msg.workerId];
      }

      let sx: Float32Array;
      let sy: Float32Array;
      if (msg.sab && msg.sabX && msg.sabY) {
        sx = new Float32Array(msg.sabX);
        sy = new Float32Array(msg.sabY);
      } else {
        sx = msg.x.slice();
        sy = msg.y.slice();
      }

      const cellSlots = Math.max(
        opts.gridTarget * opts.gridTarget,
        Math.ceil(msg.shardOf.length / 3) + 32,
      );
      state = {
        workerId: msg.workerId,
        n: msg.shardOf.length,
        ownCount,
        shardOf: msg.shardOf,
        shardStart: msg.shardStart,
        shardNodes: msg.shardNodes,
        edgeStart: msg.edgeStart,
        edgeByShard: msg.edgeByShard,
        es: msg.es,
        et: msg.et,
        mass: msg.mass,
        opts,
        sab: msg.sab,
        slotOf,
        sx,
        sy,
        fx: new Float32Array(ownCount),
        fy: new Float32Array(ownCount),
        summaries: { comX: new Float32Array(msg.shardCount), comY: new Float32Array(msg.shardCount), mass: new Float32Array(msg.shardCount) },
        cols: 1,
        rows: 1,
        minX: 0,
        minY: 0,
        cellSize: 1,
        near2: 1,
        cellCount: new Int32Array(cellSlots),
        cellStart: new Int32Array(cellSlots),
        cursor: new Int32Array(cellSlots),
        order: new Int32Array(msg.shardOf.length),
        frozen: false,
      };
      ctx.postMessage({ type: "ready", workerId: msg.workerId });
      break;
    }
    case "step": {
      if (!state || state.frozen) return;
      if (!state.sab) {
        if (msg.snapshotX) state.sx.set(msg.snapshotX);
        if (msg.snapshotY) state.sy.set(msg.snapshotY);
      }
      if (msg.summaries) {
        state.summaries.comX.set(msg.summaries.comX);
        state.summaries.comY.set(msg.summaries.comY);
        state.summaries.mass.set(msg.summaries.mass);
      }
      const tick = runStep(state, msg.wakeSet);
      tick.epoch = msg.epoch;
      ctx.postMessage(tick);
      break;
    }
    case "freeze": {
      if (state) state.frozen = true;
      break;
    }
    case "thaw": {
      if (state) state.frozen = false;
      break;
    }
    case "pin":
    case "unpin":
      // pin/unpin is applied by the client on the canonical state; accepted for protocol parity.
      break;
    case "destroy":
      state = null;
      break;
  }
};

export {};
