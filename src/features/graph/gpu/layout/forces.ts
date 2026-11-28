/**
 * T-063 (#20) — pure force helpers shared by the pool workers.
 *
 * The formulas mirror `layout.ts` so the pooled kernel stays on the same force
 * model as the single-thread reference. No allocation, no DOM, no state: each
 * helper takes scalars and returns a small delta object.
 */

/** squared softening distance so coincident nodes do not explode. */
export const EPS2 = 1;
/** spring stiffness along an edge. */
export const SPRING_K = 0.1;

/** Repulsion delta on node `i` from one neighbour `j`; `null` when too far for the near field. */
export function repelPair(
  charge: number,
  massJ: number,
  xi: number,
  yi: number,
  xj: number,
  yj: number,
): { fx: number; fy: number } {
  const dx = xj - xi;
  const dy = yj - yi;
  const soft = dx * dx + dy * dy + EPS2;
  const invD3 = 1 / (soft * Math.sqrt(soft));
  const f = charge * massJ * invD3;
  return { fx: -dx * f, fy: -dy * f };
}

/**
 * Spring force on the source endpoint of an edge. The matching force on the
 * target is the negation; callers split it to both ends.
 */
export function springPair(
  linkDistance: number,
  xs: number,
  ys: number,
  xt: number,
  yt: number,
): { fx: number; fy: number } {
  let dx = xt - xs;
  let dy = yt - ys;
  let d2 = dx * dx + dy * dy;
  if (d2 < EPS2) {
    // coincident ends: deterministic nudge by endpoint order, no randomness.
    dx = 1e-3;
    dy = 1e-3;
    d2 = EPS2;
  }
  const d = Math.sqrt(d2);
  const f = SPRING_K * (d - linkDistance);
  return { fx: (dx / d) * f, fy: (dy / d) * f };
}
