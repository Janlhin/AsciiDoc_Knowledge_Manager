/** Shared types for the WorkerPool (T-063 / Issue #21). */
import type { Tier } from "./tier";

/**
 * Priority classes. Queue order within one class is FIFO; a higher class
 * always jumps ahead of a lower one still waiting for a lane.
 *
 * - `input`       : work the typing/IME path is blocked on (reserved; previews
 *                   currently use `visible`).
 * - `visible`     : active preview / visible-pane conversion.
 * - `background`  : deferred, on-demand work that may yield to the other two.
 */
export type TaskPriority = "input" | "visible" | "background";

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  input: 0,
  visible: 1,
  background: 2,
};

/** A worker module the pool can spawn. Callers build the URL against their
 *  own `import.meta.url` so Vite bundles the worker entry correctly. The
 *  `create` closure keeps the `new Worker(new URL(...))` literal in the
 *  caller module — that is what the bundler's worker-entry static detection
 *  looks for; the pool never constructs the Worker from a bare URL itself. */
export interface WorkerSpec {
  /** stable kind label, e.g. `"docx"` / `"xlsx"` / `"adoc"`. */
  kind: string;
  /** module URL (diagnostics / fallback only). */
  url: URL;
  /** spawn the worker; the literal `new Worker(new URL(...))` lives here. */
  create: () => Worker;
}

/** Four measured segments per task, plus the wall-clock total. */
export interface TaskTimings {
  /** enqueue → lane picked (queue wait). */
  queueMs: number;
  /** main-thread cost of cloning/posting the outgoing message. */
  transferMs: number;
  /** worker-side compute (reported by the worker, else post→reply elapsed). */
  computeMs: number;
  /** main-thread cost of receiving and decoding the reply. */
  returnMs: number;
  /** enqueue → settled. */
  totalMs: number;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "ok"
  | "error"
  | "canceled"
  | "degraded";

export interface TaskRecord {
  id: number;
  kind: string;
  priority: TaskPriority;
  dedupeKey: string | null;
  status: TaskStatus;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  timings: TaskTimings;
}

export interface LaneSnapshot {
  kind: string | null;
  busy: boolean;
  idleForMs: number;
}

export interface PoolStats {
  tier: Tier;
  tierReason: string;
  laneCapacity: number;
  activeWorkers: LaneSnapshot[];
  queueDepth: number;
  queueByPriority: Record<TaskPriority, number>;
  /** recent task records (bounded history), oldest first. */
  tasks: TaskRecord[];
  degraded: boolean;
}
