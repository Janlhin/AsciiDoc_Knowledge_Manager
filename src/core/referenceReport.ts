/**
 * T-070: vault-wide three-state reference report (charter §5.1, D-14 A / D-15 A).
 *
 * Pure rule engine, no I/O, no app singletons: the runner reads the notes and
 * injects the resolvers (mirrors `docAudit.ts`). This engine deliberately does
 * NOT reuse the doc-audit category semantics — it reports the three charter
 * states directly, one entry per source location, for the independent
 * "reference check" panel.
 *
 * Scope this round (D-20 B): anchor (subpath) existence is NOT judged; a link
 * to an existing file with a missing anchor counts as `resolved`. `.txt` files
 * only appear as targets — their own bodies are never scanned for references.
 */
import {
  buildDocIndex,
  resolveInclude,
  resolveXref,
  type DocIndex,
} from "./docsAsCode";
import type { AntoraIndex } from "./antora";
import { extensionOf } from "./parsers/indexable";
import {
  classifyReferenceStatus,
  includeEscapesVaultRoot,
  type RefStatusReason,
} from "./referenceStatus";
import type { LinkRef, LinkRefStatus, NoteMetadata } from "./types";

/** Document formats the panel can filter by. txt never produces outgoing links. */
export type RefFormat = "md" | "adoc" | "txt";

export interface ReferenceEntry {
  /** Source vault-relative path. */
  path: string;
  /** 1-based source line (recorded at parse time). */
  sourceLine: number;
  /** Raw target as written in the source. */
  target: string;
  alias?: string;
  kind: LinkRef["kind"];
  syntax?: LinkRef["syntax"];
  status: LinkRefStatus;
  reason: RefStatusReason;
  /** 0-based char offset in the original content (jump target). */
  from: number;
  to: number;
  /** Trimmed, truncated source line for the panel. */
  excerpt?: string;
}

export interface ReferenceReportNote {
  path: string;
  content: string;
  meta: Pick<NoteMetadata, "links" | "frontmatter">;
}

export interface ReferenceReportEnv {
  /** Resolve a LinkRef by its kind (wikilink vs markdown), bound to the index. */
  resolveByKind: (link: LinkRef, fromPath: string) => string | null;
  /** Every vault path (indexable files). Required for the adoc xref / include
   *  rules; without it adoc references fall back to the Markdown resolver. */
  files?: ReadonlyArray<string>;
  antora?: AntoraIndex;
}

export interface ReferenceReport {
  entries: ReferenceEntry[];
  filesScanned: number;
  byStatus: Record<LinkRefStatus, number>;
  byFormat: Record<RefFormat, number>;
}

const EXTERNAL_SCHEME = /^(?:https?|mailto|tel|ftp|data|file|javascript):/i;

function isExternalOrAnchor(target: string): boolean {
  return EXTERNAL_SCHEME.test(target) || target.startsWith("#") || target.startsWith("//");
}

function formatOf(path: string): RefFormat {
  const ext = extensionOf(path);
  return ext === "adoc" ? "adoc" : ext === "txt" ? "txt" : "md";
}

/** 1-based line number of a char offset; fallback for hydrated metadata that
 *  predates T-070 (new parses carry `sourceLine` already). */
function lineOfOffset(content: string, offset: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(offset, content.length));
  for (let i = 0; i < end; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function excerptAt(content: string, from: number): string {
  const start = content.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  let end = content.indexOf("\n", from);
  if (end < 0) end = content.length;
  return content.slice(start, end).trim().slice(0, 120);
}

const EMPTY_STATUS: Record<LinkRefStatus, number> = { resolved: 0, broken: 0, unresolved: 0 };
const EMPTY_FORMAT: Record<RefFormat, number> = { md: 0, adoc: 0, txt: 0 };

/** Build the vault-wide three-state reference report. Pure. */
export function buildReferenceReport(
  notes: readonly ReferenceReportNote[],
  env: ReferenceReportEnv,
): ReferenceReport {
  const index: DocIndex | null = env.files !== undefined ? buildDocIndex(env.files) : null;
  const entries: ReferenceEntry[] = [];
  const seen = new Set<string>();
  const byStatus = { ...EMPTY_STATUS };
  const byFormat = { ...EMPTY_FORMAT };

  for (const note of notes) {
    const { path, content, meta } = note;
    for (const link of meta.links) {
      const raw = link.target.trim();
      if (!raw || isExternalOrAnchor(raw)) continue;

      // One record per source location: the same offset reached through two
      // parse paths must not appear twice. Different offsets (a wikilink and a
      // markdown link on their own lines) are two legitimate locations.
      const dedupeKey = `${path}\u0000${link.from}\u0000${link.to}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const syntax = link.syntax;
      const isInclude = syntax === "include";
      const docResolution =
        index !== null && (syntax === "include" || syntax === "xref" || syntax === "xref-short" || syntax === "link-macro")
          ? (isInclude ? resolveInclude(raw, path, index, env.antora) : resolveXref(raw, path, index, env.antora))
          : null;

      const resolvedPath =
        docResolution === null ? env.resolveByKind(link, path) : docResolution.path ?? null;

      const escapesRoot = isInclude ? includeEscapesVaultRoot(path, raw) : false;
      const { status, reason } = classifyReferenceStatus({
        target: raw,
        resolvedPath,
        docResolution,
        includeEscapesRoot: escapesRoot,
      });

      seenStatus(byStatus, status);
      seenFormat(byFormat, formatOf(path));

      entries.push({
        path,
        sourceLine: link.sourceLine ?? lineOfOffset(content, link.from),
        target: raw,
        alias: link.alias || undefined,
        kind: link.kind,
        syntax,
        status,
        reason,
        from: link.from,
        to: link.to,
        excerpt: excerptAt(content, link.from),
      });
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path) || a.sourceLine - b.sourceLine || a.from - b.from);
  return { entries, filesScanned: notes.length, byStatus, byFormat };
}

function seenStatus(counts: Record<LinkRefStatus, number>, status: LinkRefStatus): void {
  counts[status] += 1;
}

function seenFormat(counts: Record<RefFormat, number>, format: RefFormat): void {
  counts[format] += 1;
}
