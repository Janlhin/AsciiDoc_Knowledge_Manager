/**
 * T-063 (#20) — message protocol shared by the pool client (main thread) and
 * the pool workers. Pure types only; no runtime imports so both sides stay
 * independent in the bundle.
 *
 * Sync model: the main thread owns the canonical state. Workers are force
 * proposers: they read a position snapshot, accumulate forces for their shard
 * nodes, and post force slices back. The main thread sums the forces and runs
 * the integration pass, so there is a single source of truth for positions
 * and velocity.
 *
 * Two transports:
 *  - SAB (`sab: true`): snapshot positions and force scratch live in
 *    `SharedArrayBuffer`s; workers get views, completion arrives via postMessage
 *    (the main thread never calls `Atomics.wait`).
 *  - transferable (`sab: false`): snapshot clones out with `step`, force slices
 *    come back transferred; worker-side buffers are ping-pong reused.
 */
import type { LayoutOptions } from "../types";

/** Client → worker: one-time graph + plan handoff. */
export interface PoolInitMessage {
  type: "init";
  workerId: number;
  shardCount: number;
  /** node → shard index. */
  shardOf: Int32Array;
  shardStart: Int32Array;
  shardNodes: Int32Array;
  edgeStart: Int32Array;
  edgeByShard: Int32Array;
  es: Int32Array;
  et: Int32Array;
  mass: Float32Array;
  opts: Partial<LayoutOptions>;
  hops: number;
  /** initial seeded positions; ignored on the SAB path (already written into the SABs). */
  x: Float32Array;
  y: Float32Array;
  sab: boolean;
  /** shared snapshot positions (SAB path only). */
  sabX?: ArrayBuffer;
  sabY?: ArrayBuffer;
  /** shared force scratch (SAB path only). */
  sabFx?: ArrayBuffer;
  sabFy?: ArrayBuffer;
}

/** Per-shard far-field summary exchanged before the far-field pass. */
export interface ShardSummarySync {
  comX: Float32Array;
  comY: Float32Array;
  mass: Float32Array;
}

/** Client → worker: advance one tick. `wakeSet` narrows integration to a local neighbourhood. */
export interface PoolStepMessage {
  type: "step";
  epoch: number;
  wakeSet?: Int32Array;
  summaries?: ShardSummarySync;
  /** transferable-path snapshot clone (SAB path shares the buffers directly). */
  snapshotX?: Float32Array;
  snapshotY?: Float32Array;
}

export interface PoolPinMessage {
  type: "pin";
  index: number;
  x: number;
  y: number;
}

export type PoolInMessage =
  | PoolInitMessage
  | PoolStepMessage
  | PoolPinMessage
  | { type: "unpin"; index: number }
  | { type: "freeze" }
  | { type: "thaw" }
  | { type: "destroy" };

/** Worker → client: ready after `init`. */
export interface PoolReadyMessage {
  type: "ready";
  workerId: number;
}

/** Worker → client: force slice for the worker's owned nodes this tick. */
export interface PoolTickMessage {
  type: "tick";
  workerId: number;
  epoch: number;
  /** force accumulator for owned nodes, aligned to `shardNodes[workerId]`. */
  fx: Float32Array;
  fy: Float32Array;
  /**
   * Flat remote-end spring deltas: `remoteIndex[k]` is the other-shard node,
   * `remoteFx[k]` / `remoteFy[k]` the matching force. Three parallel typed
   * arrays avoid per-edge object allocation and structured-clone churn.
   */
  remoteIndex: Uint32Array;
  remoteFx: Float32Array;
  remoteFy: Float32Array;
  stageMs: {
    buildGridMs: number;
    repulsionMs: number;
    springsMs: number;
  };
}

export type PoolOutMessage =
  | PoolReadyMessage
  | PoolTickMessage
  | { type: "settled"; workerId: number }
  | { type: "error"; workerId: number; message: string };
