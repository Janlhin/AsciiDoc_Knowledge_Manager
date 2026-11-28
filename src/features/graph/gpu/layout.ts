/**
 * T-063 GPU graph view — deterministic force-directed layout kernel (pure TS).
 *
 * No DOM / WebGL / React: positions live in preallocated typed arrays and a tick
 * allocates nothing on the heap. Randomness is confined to the seeded xorshift32
 * disk initialisation; every later force step is a fixed index loop, so the same
 * graph + seed reproduces bit-identical positions (proven by `fingerprint()`).
 *
 * Force model per tick:
 *  - near field: a uniform spatial grid rebuilt every tick, direct pair repulsion
 *    against nodes in the 3×3 neighbourhood;
 *  - far field: Barnes–Hut quadtree (adjustable `theta`) aggregates distant
 *    clusters; leaf nodes inside the grid cutoff are skipped to avoid doubles;
 *  - springs along edges, weak pull toward the origin, velocity damping, alpha decay.
 */
import { LAYOUT_DEFAULTS } from "./types";
import type { GpuGraph, LayoutOptions, LayoutState, WorldBounds } from "./types";

/** xorshift32 state boxed so the stream never touches `Math.random`. */
interface Rng {
  s: number;
}

function nextUniform(rng: Rng): number {
  let x = rng.s;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  rng.s = x >>> 0;
  return rng.s / 4294967296;
}

/** alpha floor; below it the layout is considered settled. */
const ALPHA_MIN = 1e-3;
/** velocity retained each tick (the rest dissipates). */
const DAMPING = 0.9;
/** spring stiffness along an edge. */
const SPRING_K = 0.1;
/** squared softening distance so coincident nodes do not explode. */
const EPS2 = 1;
/** max leaf capacity in the Barnes–Hut tree. */
const Q_LEAF_CAP = 4;
/** recursion depth guard for degenerate clustered input. */
const Q_MAX_DEPTH = 40;

class LayoutImpl implements LayoutState {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly options: LayoutOptions;

  /** edge endpoints, pre-extracted into flat typed arrays. */
  private readonly es: Int32Array;
  private readonly et: Int32Array;
  /** per-node repulsion mass (degree + 1). */
  private readonly mass: Float32Array;

  private alphaVal: number;
  private settledFlag: boolean;

  /** force accumulators, zeroed at the start of every tick. */
  private readonly ax: Float32Array;
  private readonly ay: Float32Array;

  // uniform grid, rebuilt every tick
  private cols = 1;
  private rows = 1;
  private cellSize = 1;
  /** squared direct-repulsion cutoff; closer pairs are the grid's job, farther ones the BH tree's. */
  private near2 = 1;
  private minX = 0;
  private minY = 0;
  private maxX = 0;
  private maxY = 0;
  private readonly cellCount: Int32Array;
  private readonly cellStart: Int32Array;
  private readonly cursor: Int32Array;
  private readonly order: Int32Array;

  // Barnes–Hut pool, allocated once at construction
  private pool = 0;
  private readonly qCX: Float32Array;
  private readonly qCY: Float32Array;
  private readonly qSize: Float32Array;
  private readonly qComX: Float32Array;
  private readonly qComY: Float32Array;
  private readonly qMass: Float32Array;
  private readonly qCh0: Int32Array;
  private readonly qCh1: Int32Array;
  private readonly qCh2: Int32Array;
  private readonly qCh3: Int32Array;
  private readonly qLeaf0: Int32Array;
  private readonly qLeaf1: Int32Array;
  private readonly qLeaf2: Int32Array;
  private readonly qLeaf3: Int32Array;
  private readonly qLeafN: Uint8Array;
  private readonly qIsLeaf: Uint8Array;
  private qRoot = 0;

  constructor(graph: GpuGraph, opts?: Partial<LayoutOptions>) {
    const n = graph.nodes.length;
    this.count = n;
    this.options = { ...LAYOUT_DEFAULTS, ...(opts ?? {}) };

    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.ax = new Float32Array(n);
    this.ay = new Float32Array(n);
    this.mass = new Float32Array(n);

    this.es = new Int32Array(graph.edges.length);
    this.et = new Int32Array(graph.edges.length);
    for (let e = 0; e < graph.edges.length; e++) {
      this.es[e] = graph.edges[e].source;
      this.et[e] = graph.edges[e].target;
    }
    for (let i = 0; i < n; i++) {
      this.mass[i] = graph.nodes[i].degree + 1;
    }

    // seeded disk spread: angle uniform, radius sqrt-uniform so the area fills evenly
    const seed = this.options.seed >>> 0;
    const rng: Rng = { s: seed === 0 ? LAYOUT_DEFAULTS.seed >>> 0 : seed };
    const spread = this.options.linkDistance * Math.sqrt(Math.max(n, 1)) * 0.5;
    const TAU = Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const angle = nextUniform(rng) * TAU;
      const radius = spread * Math.sqrt(nextUniform(rng));
      this.x[i] = Math.cos(angle) * radius;
      this.y[i] = Math.sin(angle) * radius;
    }

    // worst-case cell count: occupancy target n/3 plus the +1 rim from ceil();
    // gridTarget² is kept as the floor for small graphs.
    const targetCells = Math.ceil(this.count / 3);
    const cellSlots = Math.max(
      this.options.gridTarget * this.options.gridTarget,
      targetCells + 2 * Math.ceil(Math.sqrt(targetCells)) + 16,
    );
    this.cellCount = new Int32Array(cellSlots);
    this.cellStart = new Int32Array(cellSlots);
    this.cursor = new Int32Array(cellSlots);
    this.order = new Int32Array(n);

    const poolCap = 4 * n + 16;
    this.qCX = new Float32Array(poolCap);
    this.qCY = new Float32Array(poolCap);
    this.qSize = new Float32Array(poolCap);
    this.qComX = new Float32Array(poolCap);
    this.qComY = new Float32Array(poolCap);
    this.qMass = new Float32Array(poolCap);
    this.qCh0 = new Int32Array(poolCap);
    this.qCh1 = new Int32Array(poolCap);
    this.qCh2 = new Int32Array(poolCap);
    this.qCh3 = new Int32Array(poolCap);
    this.qLeaf0 = new Int32Array(poolCap);
    this.qLeaf1 = new Int32Array(poolCap);
    this.qLeaf2 = new Int32Array(poolCap);
    this.qLeaf3 = new Int32Array(poolCap);
    this.qLeafN = new Uint8Array(poolCap);
    this.qIsLeaf = new Uint8Array(poolCap);

    this.alphaVal = 1;
    this.settledFlag = false;
  }

  alpha(): number {
    return this.alphaVal;
  }

  settled(): boolean {
    return this.settledFlag;
  }

  stepUntil(ticks: number): void {
    const limit = Math.min(ticks, this.options.maxTicks);
    for (let k = 0; k < limit; k++) {
      if (this.settledFlag) return;
      this.step();
    }
  }

  bounds(): WorldBounds {
    return {
      minX: this.minX,
      minY: this.minY,
      maxX: this.maxX,
      maxY: this.maxY,
    };
  }

  fingerprint(): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < this.count; i++) {
      const a = Math.round(this.x[i] * 1000);
      const b = Math.round(this.y[i] * 1000);
      h1 = Math.imul(h1 ^ (a >>> 0), 0x01000193) >>> 0;
      h1 = Math.imul(h1 ^ (b >>> 0), 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (a >>> 0), 0x85ebca6b) >>> 0;
      h2 = Math.imul(h2 ^ (b >>> 0), 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }

  step(): void {
    if (this.settledFlag) return;
    const o = this.options;
    this.alphaVal = Math.max(this.alphaVal * (1 - o.alphaDecay), ALPHA_MIN);
    if (this.alphaVal <= ALPHA_MIN) this.settledFlag = true;

    const n = this.count;
    this.ax.fill(0);
    this.ay.fill(0);

    this.computeBounds();
    this.buildGrid();
    this.buildQuadtree();

    for (let i = 0; i < n; i++) {
      this.applyRepulsion(i);
    }

    // edge springs: one pass over the flat edge list, force split to both ends
    for (let e = 0; e < this.es.length; e++) {
      const s = this.es[e];
      const t = this.et[e];
      let dx = this.x[t] - this.x[s];
      let dy = this.y[t] - this.y[s];
      let d2 = dx * dx + dy * dy;
      if (d2 < EPS2) {
        // coincident ends: deterministic nudge by index order, no randomness
        dx = (t - s) * 1e-3;
        dy = 1e-3;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const f = SPRING_K * (d - o.linkDistance);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      this.ax[s] += fx;
      this.ay[s] += fy;
      this.ax[t] -= fx;
      this.ay[t] -= fy;
    }

    // gravity toward the origin, then velocity integration
    const g = o.gravity;
    const damp = DAMPING;
    const alpha = this.alphaVal;
    for (let i = 0; i < n; i++) {
      this.ax[i] -= g * this.x[i];
      this.ay[i] -= g * this.y[i];
      const vx = this.vx[i] * damp + this.ax[i] * alpha;
      const vy = this.vy[i] * damp + this.ay[i] * alpha;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.x[i] += vx;
      this.y[i] += vy;
    }
  }

  // ---------------------------------------------------------------- grid --

  private computeBounds(): void {
    const n = this.count;
    if (n === 0) {
      this.minX = this.minY = this.maxX = this.maxY = 0;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const xi = this.x[i];
      const yi = this.y[i];
      if (xi < minX) minX = xi;
      if (xi > maxX) maxX = xi;
      if (yi < minY) minY = yi;
      if (yi > maxY) maxY = yi;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  private buildGrid(): void {
    const o = this.options;
    const bw = Math.max(this.maxX - this.minX, 1e-6);
    const bh = Math.max(this.maxY - this.minY, 1e-6);
    // size cells so average occupancy stays bounded (~3 nodes/cell); otherwise
    // the 3×3 neighbour scan grows quadratically with node count.
    const targetCells = Math.max(1, Math.ceil(this.count / 3));
    const span = Math.max(bw, bh);
    const cs = Math.max(o.linkDistance * 0.5, span / Math.sqrt(targetCells));
    this.cellSize = cs;
    const cutoff = 2 * o.linkDistance;
    this.near2 = cutoff * cutoff;
    const cols = Math.max(1, Math.ceil(bw / cs));
    const rows = Math.max(1, Math.ceil(bh / cs));
    this.cols = cols;
    this.rows = rows;

    const cells = cols * rows;
    this.cellCount.fill(0, 0, cells);
    for (let i = 0; i < this.count; i++) {
      const cx = Math.min(cols - 1, Math.floor((this.x[i] - this.minX) / cs));
      const cy = Math.min(rows - 1, Math.floor((this.y[i] - this.minY) / cs));
      this.cellCount[cx + cy * cols]++;
    }
    let acc = 0;
    for (let c = 0; c < cells; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c];
    }
    // second pass: scatter node indices into the per-cell ordered run
    this.cursor.set(this.cellStart.subarray(0, cells));
    for (let i = 0; i < this.count; i++) {
      const cx = Math.min(cols - 1, Math.floor((this.x[i] - this.minX) / cs));
      const cy = Math.min(rows - 1, Math.floor((this.y[i] - this.minY) / cs));
      const cell = cx + cy * cols;
      this.order[this.cursor[cell]++] = i;
    }
  }

  private applyRepulsion(i: number): void {
    const xi = this.x[i];
    const yi = this.y[i];
    const cs = this.cellSize;
    const cols = this.cols;
    const rows = this.rows;
    const charge = this.options.charge;
    const near2 = this.near2;

    const ccx = Math.min(cols - 1, Math.max(0, Math.floor((xi - this.minX) / cs)));
    const ccy = Math.min(rows - 1, Math.max(0, Math.floor((yi - this.minY) / cs)));

    // near field: own cell + 8 neighbours, direct pairwise repulsion inside the cutoff
    for (let ny = ccy - 1; ny <= ccy + 1; ny++) {
      if (ny < 0 || ny >= rows) continue;
      for (let nx = ccx - 1; nx <= ccx + 1; nx++) {
        if (nx < 0 || nx >= cols) continue;
        const cell = nx + ny * cols;
        let k = this.cellStart[cell];
        const end = k + this.cellCount[cell];
        while (k < end) {
          const j = this.order[k];
          k++;
          if (j === i) continue;
          const dx = this.x[j] - xi;
          const dy = this.y[j] - yi;
          const d2 = dx * dx + dy * dy;
          if (d2 > near2) continue; // outside the direct cutoff: left to the BH tree
          const soft = d2 + EPS2;
          const invD3 = 1 / (soft * Math.sqrt(soft));
          const f = charge * this.mass[j] * invD3;
          this.ax[i] -= dx * f;
          this.ay[i] -= dy * f;
        }
      }
    }

    // far field: Barnes–Hut aggregation
    this.walkQuadtree(this.qRoot, i, xi, yi, this.options.theta, near2);
  }

  // ------------------------------------------------------- Barnes–Hut --

  private allocNode(): number {
    const node = this.pool++;
    this.qCh0[node] = -1;
    this.qCh1[node] = -1;
    this.qCh2[node] = -1;
    this.qCh3[node] = -1;
    this.qLeaf0[node] = -1;
    this.qLeaf1[node] = -1;
    this.qLeaf2[node] = -1;
    this.qLeaf3[node] = -1;
    this.qLeafN[node] = 0;
    this.qIsLeaf[node] = 1;
    this.qMass[node] = 0;
    this.qComX[node] = 0;
    this.qComY[node] = 0;
    return node;
  }

  private buildQuadtree(): void {
    this.pool = 0;
    const root = this.allocNode();
    this.qRoot = root;
    const side = Math.max(this.maxX - this.minX, this.maxY - this.minY, 1);
    this.qCX[root] = (this.minX + this.maxX) / 2;
    this.qCY[root] = (this.minY + this.maxY) / 2;
    this.qSize[root] = side;
    for (let i = 0; i < this.count; i++) {
      this.insert(root, i, 0);
    }
  }

  private insert(node: number, i: number, depth: number): void {
    const xi = this.x[i];
    const yi = this.y[i];
    const mi = this.mass[i];

    if (this.qIsLeaf[node] === 1 && this.qLeafN[node] < Q_LEAF_CAP) {
      const slot = this.qLeafN[node];
      if (slot === 0) {
        this.qLeaf0[node] = i;
      } else if (slot === 1) {
        this.qLeaf1[node] = i;
      } else if (slot === 2) {
        this.qLeaf2[node] = i;
      } else {
        this.qLeaf3[node] = i;
      }
      this.qLeafN[node] = slot + 1;
      const oldMass = this.qMass[node];
      const newMass = oldMass + mi;
      this.qComX[node] = oldMass === 0 ? xi : (this.qComX[node] * oldMass + xi * mi) / newMass;
      this.qComY[node] = oldMass === 0 ? yi : (this.qComY[node] * oldMass + yi * mi) / newMass;
      this.qMass[node] = newMass;
      return;
    }

    if (this.qIsLeaf[node] === 1 && depth < Q_MAX_DEPTH) {
      // subdivide: move the existing leaf occupants into fresh children
      const p0 = this.qLeaf0[node];
      const p1 = this.qLeaf1[node];
      const p2 = this.qLeaf2[node];
      const p3 = this.qLeaf3[node];
      this.qIsLeaf[node] = 0;
      this.qLeafN[node] = 0;
      const half = this.qSize[node] / 2;
      const cx = this.qCX[node];
      const cy = this.qCY[node];
      const c0 = this.allocNode();
      const c1 = this.allocNode();
      const c2 = this.allocNode();
      const c3 = this.allocNode();
      this.qCh0[node] = c0;
      this.qCh1[node] = c1;
      this.qCh2[node] = c2;
      this.qCh3[node] = c3;
      this.childBounds(c0, cx - half, cy - half, half);
      this.childBounds(c1, cx + half, cy - half, half);
      this.childBounds(c2, cx - half, cy + half, half);
      this.childBounds(c3, cx + half, cy + half, half);
      if (p0 >= 0) this.insert(this.quadrant(node, this.x[p0], this.y[p0]), p0, depth + 1);
      if (p1 >= 0) this.insert(this.quadrant(node, this.x[p1], this.y[p1]), p1, depth + 1);
      if (p2 >= 0) this.insert(this.quadrant(node, this.x[p2], this.y[p2]), p2, depth + 1);
      if (p3 >= 0) this.insert(this.quadrant(node, this.x[p3], this.y[p3]), p3, depth + 1);
      this.insert(this.quadrant(node, xi, yi), i, depth + 1);
      this.recomputeMass(node);
      return;
    }

    // internal node, or depth-guarded leaf: descend into the matching quadrant
    if (this.qIsLeaf[node] === 0) {
      const child = this.quadrant(node, xi, yi);
      this.insert(child, i, depth + 1);
      this.recomputeMass(node);
    }
  }

  private childBounds(node: number, cx: number, cy: number, size: number): void {
    this.qCX[node] = cx;
    this.qCY[node] = cy;
    this.qSize[node] = size;
  }

  private quadrant(node: number, xi: number, yi: number): number {
    const left = xi < this.qCX[node];
    const top = yi < this.qCY[node];
    if (left) return top ? this.qCh0[node] : this.qCh2[node];
    return top ? this.qCh1[node] : this.qCh3[node];
  }

  private recomputeMass(node: number): void {
    let mass = 0;
    let mx = 0;
    let my = 0;
    const k0 = this.qCh0[node];
    const k1 = this.qCh1[node];
    const k2 = this.qCh2[node];
    const k3 = this.qCh3[node];
    if (k0 >= 0) {
      mass += this.qMass[k0];
      mx += this.qComX[k0] * this.qMass[k0];
      my += this.qComY[k0] * this.qMass[k0];
    }
    if (k1 >= 0) {
      mass += this.qMass[k1];
      mx += this.qComX[k1] * this.qMass[k1];
      my += this.qComY[k1] * this.qMass[k1];
    }
    if (k2 >= 0) {
      mass += this.qMass[k2];
      mx += this.qComX[k2] * this.qMass[k2];
      my += this.qComY[k2] * this.qMass[k2];
    }
    if (k3 >= 0) {
      mass += this.qMass[k3];
      mx += this.qComX[k3] * this.qMass[k3];
      my += this.qComY[k3] * this.qMass[k3];
    }
    this.qMass[node] = mass;
    if (mass > 0) {
      this.qComX[node] = mx / mass;
      this.qComY[node] = my / mass;
    }
  }

  private walkQuadtree(
    node: number,
    i: number,
    xi: number,
    yi: number,
    theta: number,
    near2: number,
  ): void {
    if (node < 0) return;
    if (this.qIsLeaf[node] === 1) {
      const n = this.qLeafN[node];
      const charge = this.options.charge;
      for (let s = 0; s < n; s++) {
        const j =
          s === 0
            ? this.qLeaf0[node]
            : s === 1
              ? this.qLeaf1[node]
              : s === 2
                ? this.qLeaf2[node]
                : this.qLeaf3[node];
        if (j === i) continue;
        const dx = this.x[j] - xi;
        const dy = this.y[j] - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 < near2) continue; // already handled by the grid
        const soft = d2 + EPS2;
        const invD3 = 1 / (soft * Math.sqrt(soft));
        const f = charge * this.mass[j] * invD3;
        this.ax[i] -= dx * f;
        this.ay[i] -= dy * f;
      }
      return;
    }

    const dx = this.qComX[node] - xi;
    const dy = this.qComY[node] - yi;
    const d2 = dx * dx + dy * dy;
    const side = this.qSize[node];
    if (d2 > 0 && side * side < theta * theta * d2) {
      // far enough: treat the whole cluster as one centre of mass
      const d = Math.sqrt(d2 + EPS2);
      const f = (this.options.charge * this.qMass[node]) / (d2 + EPS2);
      this.ax[i] -= (dx / d) * f;
      this.ay[i] -= (dy / d) * f;
      return;
    }
    this.walkQuadtree(this.qCh0[node], i, xi, yi, theta, near2);
    this.walkQuadtree(this.qCh1[node], i, xi, yi, theta, near2);
    this.walkQuadtree(this.qCh2[node], i, xi, yi, theta, near2);
    this.walkQuadtree(this.qCh3[node], i, xi, yi, theta, near2);
  }
}

/**
 * Build a deterministic layout for the given graph. Positions are owned by the
 * returned state; the graph itself is never mutated.
 */
export function createLayout(graph: GpuGraph, opts?: Partial<LayoutOptions>): LayoutState {
  return new LayoutImpl(graph, opts);
}
