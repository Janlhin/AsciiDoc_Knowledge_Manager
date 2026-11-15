/**
 * Helpers for the index-backed search mode (T-041, decision: two co-existing
 * semantics). The substring search path is deliberately untouched.
 *
 * FTS5 `snippet()` returns body text wrapped in `<mark>`/`</mark>` sentinels.
 * That text comes from user notes and may itself contain HTML-looking strings,
 * so it must never be injected as HTML. We split it into plain-text parts and
 * let the caller render each part as a React text node (or a <mark> element).
 */

export interface SnippetPart {
  text: string;
  /** true = inside a <mark> pair, i.e. a matched term */
  hit: boolean;
}

/** Split an FTS5 snippet into literal text parts.
 *
 * Only the two exact sentinels are treated as markup. Anything else — including
 * `<script>`, stray `<b>` or an unmatched `</mark>` — stays literal text, so
 * note content cannot become markup. Malformed nesting is tolerated: a second
 * `<mark>` without a close keeps the region highlighted rather than throwing.
 */
export function parseSnippetParts(snippet: string): SnippetPart[] {
  if (snippet === "") return [];
  const parts: SnippetPart[] = [];
  const sentinel = /<mark>|<\/mark>/g;
  let last = 0;
  let hit = false;
  let match: RegExpExecArray | null;

  const push = (text: string, isHit: boolean): void => {
    if (text !== "") parts.push({ text, hit: isHit });
  };

  while ((match = sentinel.exec(snippet)) !== null) {
    push(snippet.slice(last, match.index), hit);
    hit = match[0] === "<mark>";
    last = match.index + match[0].length;
  }
  push(snippet.slice(last), hit);
  return parts;
}

/** FTS5 bm25 ranks are *lower is better*; keep the returned order but guard
 *  against a missing/NaN rank so a malformed hit cannot reorder the list. */
export function orderIndexHits<T extends { rank: number }>(hits: readonly T[]): T[] {
  return [...hits].sort((a, b) => {
    const ra = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
    const rb = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}
