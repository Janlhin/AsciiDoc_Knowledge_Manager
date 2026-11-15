/**
 * One-shot turn request for the AI panel (T-047).
 *
 * The panel owns the only streaming UI; productized actions (proofreading, and
 * anything later) must not grow a second copy of it. So an action *composes* a
 * request and drops it here, and the panel — mounted or not yet mounted — picks
 * it up once and runs it through the very same stream path as a typed message.
 *
 * Session-only: a request that arrives while the app is closing is not worth
 * persisting, and replaying a stale note body on next launch would be a privacy
 * leak, not a feature.
 */
import { Store } from "../store";
import type { ChatMessage } from "./types";

export interface LlmTurnRequest {
  /** Monotonic id so the panel can react to a repeated identical request. */
  id: number;
  /** Bubble text shown as the user message (already localized by the builder). */
  display: string;
  /** Full request payload: system prompts + user content. */
  messages: ChatMessage[];
  /** Present when the reply should be parsed into jumpable findings. */
  proofread?: { path: string; content: string; truncated: boolean };
}

export const pendingLlmTurn = new Store<LlmTurnRequest | null>(null);

let seq = 0;

/** Publish a request; the panel consumes it (single consumer). */
export function requestLlmTurn(request: Omit<LlmTurnRequest, "id">): LlmTurnRequest {
  const next: LlmTurnRequest = { ...request, id: ++seq };
  pendingLlmTurn.set(next);
  return next;
}

/** Read the pending request and clear it in one step. */
export function consumeLlmTurn(): LlmTurnRequest | null {
  const pending = pendingLlmTurn.get();
  if (pending !== null) pendingLlmTurn.set(null);
  return pending;
}
