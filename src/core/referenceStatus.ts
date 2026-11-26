/**
 * T-070: pure three-state reference classification (charter §5.1, D-14 A).
 *
 * No I/O, no app singletons, no Tauri — the caller supplies what the resolvers
 * already produced (a resolved vault path, or the docsAsCode `DocResolution`),
 * and this module maps it onto the three charter states. Keeping the decision
 * here means the "binary null" ambiguity (null used to mean both "file missing"
 * and "cannot decide") has exactly one place to be resolved, and it is unit
 * testable off the Tauri runtime.
 *
 * Charter §5.1 conditions (this round):
 *  - resolved   — targetDocId non-empty (the file is in the index). Anchor
 *    (subpath) existence is NOT checked this round (D-20 B): an existing file
 *    reached via `foo.adoc#missing` counts as resolved.
 *  - broken     — path resolution completed but the target file is not in the
 *    index (deleted / never existed), including a missing `include::` target.
 *  - unresolved — grammar-level undecidable: undefined `{attr}`, dynamic /
 *    non-path target, include path rejected / escaped the vault root,
 *    conditional-block evaluation failure.
 */
import type { DocResolution } from "./docsAsCode";
import type { LinkRefStatus } from "./types";

/** Why a reference is not resolved — drives the panel's issue wording. */
export type RefStatusReason =
  | "missing"
  | "ambiguous"
  | "attribute"
  | "rejected"
  | "dynamic";

export interface StatusClassifyResult {
  status: LinkRefStatus;
  reason: RefStatusReason;
}

/** A still-unsubstituted attribute placeholder, e.g. `xref:{undefined-attr}[]`.
 *  The adoc parser leaves `{name}` verbatim when the attribute is not defined,
 *  so its presence in the resolved target is the "attribute undefined" signal. */
const UNRESOLVED_ATTR_RE = /\{[A-Za-z0-9_-]+\}/;

export function hasUnresolvedAttribute(target: string): boolean {
  return UNRESOLVED_ATTR_RE.test(target);
}

/**
 * Does `rel` (as written by an `include::`) escape the vault root when joined
 * to `fromPath`'s folder? A leading `/` is vault-root-relative and never
 * escapes; `..` segments that pop above the root are rejected by Asciidoctor's
 * jail, so the reference cannot be judged against a real file.
 */
export function includeEscapesVaultRoot(fromPath: string, rel: string): boolean {
  const trimmed = rel.trim();
  if (trimmed.startsWith("/")) return false;
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  let depth = 0;
  for (const seg of [...dir.split("/"), ...trimmed.split("/")]) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

/**
 * Map a resolver result onto the charter three states.
 *
 * `docResolution` (AsciiDoc xref / include) wins when present: its own status
 * already distinguishes broken (missing) from unresolved (ambiguous resource id).
 * Otherwise a Markdown wikilink / markdown link is judged off `resolvedPath`:
 * non-null = resolved; null = unresolved only when an attribute placeholder
 * survived substitution, otherwise broken (the target was a plain path that
 * simply has no file).
 */
export function classifyReferenceStatus(args: {
  target: string;
  resolvedPath: string | null;
  docResolution?: DocResolution | null;
  includeEscapesRoot?: boolean;
}): StatusClassifyResult {
  const { target, resolvedPath, docResolution, includeEscapesRoot = false } = args;

  if (includeEscapesRoot) return { status: "unresolved", reason: "rejected" };
  if (hasUnresolvedAttribute(target)) return { status: "unresolved", reason: "attribute" };

  if (docResolution !== undefined && docResolution !== null) {
    if (docResolution.status === "resolved") return { status: "resolved", reason: "missing" };
    if (docResolution.status === "unresolved") {
      return { status: "unresolved", reason: docResolution.reason === "versions" ? "dynamic" : "ambiguous" };
    }
    return { status: "broken", reason: "missing" };
  }

  if (resolvedPath !== null) return { status: "resolved", reason: "missing" };
  return { status: "broken", reason: "missing" };
}
