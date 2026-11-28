/**
 * T-063 GPU graph view — layout worker (dedicated thread).
 *
 * Runs the same deterministic kernel as `layout.ts` off the main thread. The
 * client sends graph + options once via `init`, then controls the simulation
 * with `start` / `stop` / `pin` / `unpin`. After every tick the position arrays
 * are handed back as transferables (zero structured-clone copy); fresh arrays
 * are allocated for the next tick.
 *
 * Message protocol:
 *  - in:  `init {nodes, edges, opts}` | `pin {index,x,y}` | `unpin {index}` | `stop` | `start`
 *  - out: `tick {alpha, x, y}` (buffers transferred) | `settled`
 */
import { createLayout } from "./layout";
import type {
  GpuEdge,
  GpuGraph,
  GpuNode,
  LayoutOptions,
  LayoutState,
} from "./types";

/** plain node handed to the worker over the message channel. */
export interface WorkerNodeInit {
  id: string;
  label: string;
  resolved: boolean;
  degree: number;
  groupColor?: string;
}

/** plain edge handed to the worker over the message channel. */
export interface WorkerEdgeInit {
  source: number;
  target: number;
  broken: boolean;
}

export type WorkerInMessage =
  | { type: "init"; nodes: WorkerNodeInit[]; edges: WorkerEdgeInit[]; opts: Partial<LayoutOptions> }
  | { type: "pin"; index: number; x: number; y: number }
  | { type: "unpin"; index: number }
  | { type: "stop" }
  | { type: "start" };

export type WorkerOutMessage =
  | { type: "tick"; alpha: number; x: Float32Array; y: Float32Array }
  | { type: "settled" };

/** frame cadence inside the worker; the main thread is never blocked by a tick. */
const FRAME_MS = 16;

const ctx = self as unknown as {
  postMessage(message: WorkerOutMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null;
};

let layout: LayoutState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let pinnedIndex = -1;
let pinnedX = 0;
let pinnedY = 0;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function tickOnce(): void {
  if (!layout) return;
  layout.step();

  // pinned node stays put: restore position and kill its velocity after integration
  if (pinnedIndex >= 0) {
    layout.x[pinnedIndex] = pinnedX;
    layout.y[pinnedIndex] = pinnedY;
    layout.vx[pinnedIndex] = 0;
    layout.vy[pinnedIndex] = 0;
  }

  const outX = new Float32Array(layout.x);
  const outY = new Float32Array(layout.y);
  ctx.postMessage(
    { type: "tick", alpha: layout.alpha(), x: outX, y: outY },
    [outX.buffer, outY.buffer],
  );

  if (layout.settled()) {
    running = false;
    clearTimer();
    ctx.postMessage({ type: "settled" });
  }
}

function loop(): void {
  if (!running) return;
  tickOnce();
  if (running) timer = setTimeout(loop, FRAME_MS);
}

ctx.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      clearTimer();
      running = false;
      pinnedIndex = -1;
      const nodes: GpuNode[] = msg.nodes.map((nd) => ({
        id: nd.id,
        label: nd.label,
        resolved: nd.resolved,
        degree: nd.degree,
        groupColor: nd.groupColor,
      }));
      const edges: GpuEdge[] = msg.edges.map((ed) => ({
        source: ed.source,
        target: ed.target,
        broken: ed.broken,
      }));
      const graph: GpuGraph = { nodes, edges };
      layout = createLayout(graph, msg.opts);
      break;
    }
    case "pin": {
      pinnedIndex = msg.index;
      pinnedX = msg.x;
      pinnedY = msg.y;
      if (layout) {
        layout.x[msg.index] = msg.x;
        layout.y[msg.index] = msg.y;
        layout.vx[msg.index] = 0;
        layout.vy[msg.index] = 0;
      }
      break;
    }
    case "unpin": {
      pinnedIndex = -1;
      break;
    }
    case "stop": {
      running = false;
      clearTimer();
      break;
    }
    case "start": {
      if (layout && !running) {
        running = true;
        loop();
      }
      break;
    }
  }
};

export {};
