/**
 * T-067 (ADKM L3, D-17 / D-041): click-to-navigate for AsciiDoc xref macros in
 * source mode.
 *
 * Reuses the existing vault resolution + navigation APIs:
 * - `metadata.resolveMarkdownLink` / `resolveLink` map the target to a vault path
 *   (same routing the index/backlinks use for adoc links);
 * - `workspace.openFile` opens the tab; `workspace.requestReveal` scrolls to the
 *   subpath span. Anchor fallback is a plain-text regex scan (`findAnchorOffset`)
 *   — there is no AsciiDoc syntax tree on the editor side, and this does not
 *   pretend otherwise.
 *
 * A target that does not resolve degrades visibly: no navigation, no note
 * creation, a transient notice pill. External schemes are left to the default
 * webview behaviour (handler bails without preventDefault).
 */
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t } from "@core/i18n";
import { findAnchorOffset, findXrefAt } from "./asciidocLanguage";

/** xref macro + `<<…>>` short ref (link: macro is highlighted but not a click target here). */
const XREF_DECO_RE = /xref:[^\[\s]+\[[^\]]*\]|<<[^<>\n]+>>/g;

export type AdocXrefOutcome = "opened" | "unresolved" | "external" | "empty";

async function safeRead(app: GeodeApp, path: string): Promise<string | null> {
  try {
    return await app.vault.read(path);
  } catch (err) {
    console.error(`[editor] adoc xref: failed to read "${path}"`, err);
    return null;
  }
}

/** Resolve an adoc target to a vault path, mirroring the index's kind routing. */
function resolveTarget(app: GeodeApp, target: string, fromPath: string): string | null {
  return app.metadata.resolveMarkdownLink(target, fromPath) ?? app.metadata.resolveLink(target, fromPath);
}

function showUnresolvedNotice(target: string): void {
  document.querySelector("[data-testid='adoc-xref-notice']")?.remove();
  const el = document.createElement("div");
  // reuses the shared `.link-update-notice` pill styling (explorer.scss)
  el.className = "link-update-notice";
  el.textContent = t("editor.xrefUnresolved", { target });
  el.setAttribute("data-testid", "adoc-xref-notice");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4000);
}

/**
 * Follow one resolved adoc xref reference. Never throws: resolution / read
 * failures fall back to "open the file without reveal" or the unresolved pill.
 */
export async function openAdocXref(
  app: GeodeApp,
  ref: { target: string; subpath: string; external: boolean },
  fromPath: string,
): Promise<AdocXrefOutcome> {
  if (ref.external) return "external";
  if (!ref.target && !ref.subpath) return "empty";

  // Intra-document anchor (`<<#anchor>>` / `xref:#anchor[]`): stay in this file.
  if (!ref.target) {
    const span = app.metadata.resolveSubpath(fromPath, ref.subpath);
    if (span) {
      app.workspace.requestReveal(fromPath, span.from, span.to);
      return "opened";
    }
    const content = await safeRead(app, fromPath);
    const off = content !== null ? findAnchorOffset(content, ref.subpath) : null;
    if (off !== null) app.workspace.requestReveal(fromPath, off, off);
    return "opened";
  }

  const resolved = resolveTarget(app, ref.target, fromPath);
  if (!resolved) {
    showUnresolvedNotice(ref.target);
    return "unresolved";
  }

  app.workspace.openFile(resolved);
  if (ref.subpath) {
    const span = app.metadata.resolveSubpath(resolved, ref.subpath);
    if (span) {
      app.workspace.requestReveal(resolved, span.from, span.to);
      return "opened";
    }
    const content = await safeRead(app, resolved);
    const off = content !== null ? findAnchorOffset(content, ref.subpath) : null;
    if (off !== null) app.workspace.requestReveal(resolved, off, off);
  }
  return "opened";
}

/**
 * Decorate adoc xref refs as clickable marks. Resolved targets use the
 * wikilink accent class; unresolved ones fall back to the unresolved color.
 * Attributes carry the resolved target / subpath for the click handler.
 */
function adocXrefDecorations(app: GeodeApp, getPath: () => string): Extension {
  const matcher = new MatchDecorator({
    regexp: XREF_DECO_RE,
    decoration: (m) => {
      const ref = findXrefAt(m[0], 0, Math.floor(m[0].length / 2));
      if (!ref) return null;
      if (ref.external) {
        return Decoration.mark({
          class: "cm-wikilink",
          attributes: { "data-adoc-xref": "1", "data-external": "1" },
        });
      }
      const resolved = ref.target ? resolveTarget(app, ref.target, getPath()) : getPath();
      return Decoration.mark({
        class: resolved ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
        attributes: {
          "data-adoc-xref": "1",
          "data-link-target": ref.target,
          ...(ref.subpath ? { "data-link-subpath": ref.subpath } : {}),
        },
      });
    },
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Ctrl/Cmd+Click an adoc xref mark → follow it (or show the unresolved pill). */
function adocXrefClickHandler(app: GeodeApp, getPath: () => string): Extension {
  return EditorView.domEventHandlers({
    mousedown: (event) => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
      const el =
        event.target instanceof HTMLElement ? event.target.closest("[data-adoc-xref]") : null;
      if (!el) return false;
      const external = el.getAttribute("data-external") === "1";
      // External schemes: leave the event alone so the webview's default
      // navigation can handle it (no in-app resolution).
      if (external) return false;
      const target = el.getAttribute("data-link-target") ?? "";
      const subpath = el.getAttribute("data-link-subpath") ?? "";
      event.preventDefault();
      void openAdocXref(app, { target, subpath, external }, getPath());
      return true;
    },
  });
}

/** Adoc-only editor slice: xref marks + click-to-navigate. Included only for `.adoc`. */
export function adocXrefExtensions(app: GeodeApp, getPath: () => string): Extension[] {
  return [adocXrefDecorations(app, getPath), adocXrefClickHandler(app, getPath)];
}
