import type { NoteMetadata } from "../types";

/**
 * Plain-text (`.txt`) metadata — deliberately structureless.
 *
 * A `.txt` file has no heading hierarchy, no wikilink/macro references, no tags,
 * no block markers, no footnotes and no frontmatter. The indexer still stores its
 * raw body for full-text search (`indexer.toIndexedNote`), and its display title
 * stays the basename — exactly like every other indexed file. This parser must
 * NEVER guess a title from the first line or invent a heading level: doing so
 * would populate the outline pane and graph with structure the author did not
 * write (T-068, 章程 §4.1).
 */
export function parsePlainText(path: string, content: string): NoteMetadata {
  return {
    path,
    links: [],
    tags: [],
    headings: [],
    blocks: [],
    footnotes: [],
    footnoteRefs: [],
    aliases: [],
    contentLength: content.length,
  };
}
