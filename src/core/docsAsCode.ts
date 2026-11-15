/**
 * T-045 (slice 1): Docs-as-Code reference integrity — xref + include.
 *
 * Pure functions, no I/O: the caller supplies the vault's path list. AsciiDoc
 * has two reference kinds that a wiki resolver gets wrong, and both are exactly
 * what a docs pipeline must catch before publishing:
 *
 *  1. `xref:` is **file-relative** in Asciidoctor (`docs/a.adoc` + `xref:b.adoc`
 *     means `docs/b.adoc`). Resolving it like a wikilink silently validates the
 *     wrong thing.
 *  2. `include::` is file-relative too, and a missing/looping include breaks the
 *     build, not just a link.
 *
 * The app's own preview resolves xref clicks **vault-root-relative** (the
 * markdown pipeline), so a plain target is tried relative-first and then
 * root-relative. That order keeps lint from ever calling "broken" a link the
 * product can actually open, while still honouring AsciiDoc semantics.
 *
 * Antora resource ids (`component:module:page.adoc`, `partial$x.adoc`) cannot be
 * resolved faithfully without parsing `antora.yml`, which this slice does not
 * do. They fall back to a **unique-basename** match; zero or several candidates
 * are reported honestly instead of guessed (see docs/docs-as-code-baseline.adoc).
 */
import type { LinkRef } from "./types";

/** Extensions a path-like target may omit before we try appending one. */
const APPENDABLE = [".adoc", ".md"] as const;
const ANTORA_FAMILY = /^(partial|example|image|attachment)\$(.+)$/i;

export interface DocIndex {
  readonly paths: ReadonlyArray<string>;
  /** lower-cased full path → exact path */
  readonly lower: ReadonlyMap<string, string>;
  /** lower-cased basename → exact paths carrying it */
  readonly byName: ReadonlyMap<string, ReadonlyArray<string>>;
}

export function buildDocIndex(paths: ReadonlyArray<string>): DocIndex {
  const lower = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const path of paths) {
    lower.set(path.toLowerCase(), path);
    const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    const bucket = byName.get(base);
    if (bucket === undefined) byName.set(base, [path]);
    else bucket.push(path);
  }
  return { paths, lower, byName };
}

export interface ParsedXref {
  raw: string;
  /** Path portion with the anchor stripped; "" for a pure anchor / external URL. */
  path: string;
  anchor: string;
  /** Antora resource-id segments, when the target uses them. */
  component?: string;
  module?: string;
  /** Antora family prefix (`partial$x.adoc`), when present. */
  family?: string;
  /** `#anchor` targeted at the same document. */
  anchorOnly: boolean;
  /** http(s) / mailto / data — never a vault reference. */
  external: boolean;
}

/** Real URL schemes only — `component:module:page` is a resource id, not a scheme. */
const EXTERNAL_SCHEME = /^(?:https?|mailto|tel|data|ftp|file|javascript):/i;

function isExternal(target: string): boolean {
  return EXTERNAL_SCHEME.test(target) || target.startsWith("//");
}

/** Split an AsciiDoc target into path / anchor / Antora resource segments. */
export function parseXref(raw: string): ParsedXref {
  const trimmed = raw.trim();
  if (isExternal(trimmed)) {
    return { raw: trimmed, path: "", anchor: "", anchorOnly: false, external: true };
  }
  const hash = trimmed.indexOf("#");
  let pathPart = hash >= 0 ? trimmed.slice(0, hash) : trimmed;
  const anchor = hash >= 0 ? trimmed.slice(hash + 1) : "";

  let component: string | undefined;
  let module: string | undefined;
  let family: string | undefined;

  if (pathPart.includes(":")) {
    const parts = pathPart.split(":");
    component = parts[0] || undefined;
    if (parts.length >= 3) module = parts[1] || undefined;
    pathPart = parts[parts.length - 1];
  }
  const familyMatch = ANTORA_FAMILY.exec(pathPart);
  if (familyMatch !== null) {
    family = familyMatch[1].toLowerCase();
    pathPart = familyMatch[2];
  }

  return {
    raw: trimmed,
    path: pathPart,
    anchor,
    ...(component === undefined ? {} : { component }),
    ...(module === undefined ? {} : { module }),
    ...(family === undefined ? {} : { family }),
    anchorOnly: pathPart === "",
    external: false,
  };
}

export type ResolveVia = "anchor" | "relative" | "root" | "resource";
export type ResolveFailure = "missing" | "ambiguous";

export interface DocResolution {
  status: "resolved" | "broken" | "unresolved";
  /** Vault-relative path of the target when resolved. */
  path?: string;
  via?: ResolveVia;
  failure?: ResolveFailure;
  /** Candidate count when `failure === "ambiguous"`. */
  candidates?: number;
}

/** POSIX-style join/normalise; `..` beyond the root is clamped. */
export function joinVaultPath(dir: string, rel: string): string {
  const out: string[] = [];
  for (const seg of `${dir}/${rel}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

/** Exact lookup, optionally retrying with a document extension appended. */
function lookupPath(candidate: string, index: DocIndex): string | null {
  const hit = index.lower.get(candidate.toLowerCase());
  if (hit !== undefined) return hit;
  if (/\.[A-Za-z0-9]+$/.test(candidate)) return null;
  for (const ext of APPENDABLE) {
    const withExt = index.lower.get(`${candidate}${ext}`.toLowerCase());
    if (withExt !== undefined) return withExt;
  }
  return null;
}

function lookupUniqueName(name: string, index: DocIndex): DocResolution {
  const bucket = index.byName.get(name.toLowerCase()) ?? [];
  if (bucket.length === 1) return { status: "resolved", path: bucket[0], via: "resource" };
  if (bucket.length === 0) {
    // `partial$intro.adoc` may legitimately live at `.../partials/intro.adoc`.
    const alt = index.lower.get(name.toLowerCase());
    if (alt !== undefined) return { status: "resolved", path: alt, via: "resource" };
    return { status: "broken", failure: "missing" };
  }
  return { status: "unresolved", failure: "ambiguous", candidates: bucket.length };
}

/**
 * Resolve `xref:` / `<<path#anchor>>`. Order: anchor → resource id → relative →
 * root-relative (app compatibility). Explicitly relative targets (`./`, `../`)
 * never fall back to the root, because that would validate a file the author
 * did not mean.
 */
export function resolveXref(raw: string, fromPath: string, index: DocIndex): DocResolution {
  const target = parseXref(raw);
  if (target.external) return { status: "resolved", via: "anchor" };
  if (target.anchorOnly) return { status: "resolved", via: "anchor" };
  if (target.component !== undefined || target.family !== undefined) {
    return lookupUniqueName(target.path, index);
  }

  const explicitRelative = target.path.startsWith("./") || target.path.startsWith("../");
  const rootRelative = target.path.startsWith("/");
  const candidates = rootRelative
    ? [target.path.slice(1)]
    : [
        joinVaultPath(dirOf(fromPath), target.path),
        ...(explicitRelative ? [] : [target.path.replace(/^\//, "")]),
      ];

  for (const candidate of candidates) {
    const hit = lookupPath(candidate, index);
    if (hit !== null) {
      return { status: "resolved", path: hit, via: candidate === candidates[0] && !rootRelative ? "relative" : "root" };
    }
  }
  return { status: "broken", failure: "missing" };
}

/**
 * Resolve `include::path[]`. Asciidoctor resolves includes relative to the
 * including file (or the vault root for a leading `/`); there is no
 * basename fallback, because guessing here would hide a real build break.
 */
export function resolveInclude(raw: string, fromPath: string, index: DocIndex): DocResolution {
  const target = parseXref(raw);
  if (target.external) return { status: "resolved", via: "anchor" };
  if (target.anchorOnly) return { status: "broken", failure: "missing" };
  if (target.component !== undefined || target.family !== undefined) {
    return lookupUniqueName(target.path, index);
  }
  const candidate = target.path.startsWith("/")
    ? target.path.slice(1)
    : joinVaultPath(dirOf(fromPath), target.path);
  const hit = lookupPath(candidate, index);
  if (hit !== null) {
    return { status: "resolved", path: hit, via: target.path.startsWith("/") ? "root" : "relative" };
  }
  return { status: "broken", failure: "missing" };
}

export interface IncludeEdge {
  /** Including file (vault-relative). */
  from: string;
  /** Included file (vault-relative), only when the target resolved. */
  to: string;
  /** Raw target as written. */
  target: string;
  /** Character offset of the include line. */
  at: number;
}

/** Include edges of one or more notes; unresolved includes produce no edge. */
export function includeEdges(
  notes: ReadonlyArray<{ path: string; links?: ReadonlyArray<LinkRef> }>,
  index: DocIndex,
): IncludeEdge[] {
  const out: IncludeEdge[] = [];
  for (const note of notes) {
    for (const link of note.links ?? []) {
      if (link.syntax !== "include") continue;
      const resolution = resolveInclude(link.target, note.path, index);
      if (resolution.status !== "resolved" || resolution.path === undefined) continue;
      out.push({ from: note.path, to: resolution.path, target: link.target, at: link.from });
    }
  }
  return out;
}

/** Rotate a cycle so the comparison key does not depend on the entry node. */
function canonicalCycle(cycle: ReadonlyArray<string>): string {
  let best = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[best]) best = i;
  }
  return [...cycle.slice(best), ...cycle.slice(0, best)].join("\u0000");
}

/**
 * Every include cycle reachable from the graph, reported once each. A cycle is
 * returned as the ordered path list **without** repeating the entry node
 * (`[a, b]` means a → b → a).
 */
export function findIncludeCycles(edges: ReadonlyArray<IncludeEdge>): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const bucket = adjacency.get(edge.from);
    if (bucket === undefined) adjacency.set(edge.from, [edge.to]);
    else if (!bucket.includes(edge.to)) bucket.push(edge.to);
  }

  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const mark = state.get(next) ?? 0;
      if (mark === 1) {
        const start = stack.indexOf(next);
        const cycle = stack.slice(start);
        const key = canonicalCycle(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (mark === 0) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of adjacency.keys()) {
    if ((state.get(node) ?? 0) === 0) visit(node);
  }
  return cycles;
}
