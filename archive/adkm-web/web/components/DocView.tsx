import { useMemo } from "react";
import type { RenderResult } from "../../shared/types.ts";
import type { Resolver } from "../resolve.ts";

export function DocView({
  doc,
  resolver,
  onOpen,
  onGotoLine,
}: {
  doc: RenderResult;
  resolver: Resolver;
  onOpen: (id: string) => void;
  onGotoLine?: (line: number) => void;
}) {
  const badge = doc.format === "asciidoc" ? "adoc" : doc.format === "markdown" ? "md" : "asset";

  const outline = useMemo(() => doc.headingsSummary ?? [], [doc]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>): void {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;

    const docAttr = a.getAttribute("data-doc");
    const wikiAttr = a.getAttribute("data-wikilink");
    const href = a.getAttribute("href") ?? "";

    if (wikiAttr) {
      e.preventDefault();
      const id = resolver.byName(decodeURIComponent(wikiAttr));
      if (id) onOpen(id);
      return;
    }
    if (docAttr) {
      e.preventDefault();
      const id = resolver.byPath(doc.id, decodeURIComponent(docAttr));
      if (id) onOpen(id);
      return;
    }
    if (href.startsWith("http")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noreferrer");
      return;
    }
    if (href.startsWith("#")) {
      e.preventDefault();
      return;
    }
    // 剩余的本地相对链接（图片等）
    if (href && !href.startsWith("data:")) {
      e.preventDefault();
      const id = resolver.byPath(doc.id, href);
      if (id) onOpen(id);
    }
  }

  return (
    <div className="doc">
      <div className="doc-body">
        <div className="doc-head">
          <h1 className="doc-title">{doc.title}</h1>
          <div className="doc-path">
            {doc.id}
            <span className={`doc-badge ${badge}`}>{badge}</span>
          </div>
        </div>
        <div className="prose" onClick={handleClick} dangerouslySetInnerHTML={{ __html: doc.html }} />
      </div>

      <aside className="doc-side">
        <div className="side-sec">
          <h4>出链 ({doc.outgoing.length})</h4>
          {doc.outgoing.length === 0 && <div className="empty">无</div>}
          {doc.outgoing.map((r, i) => (
            <button
              key={`o${i}`}
              className={`link-row${r.status !== "resolved" ? " broken" : ""}`}
              onClick={() => r.status === "resolved" && onOpen(r.other)}
              title={r.other}
            >
              <span className="ln">L{r.line}</span> {r.otherTitle || r.other}
            </button>
          ))}
        </div>

        <div className="side-sec">
          <h4>反向链接 ({doc.incoming.length})</h4>
          {doc.incoming.length === 0 && <div className="empty">无</div>}
          {doc.incoming.map((r, i) => (
            <button
              key={`i${i}`}
              className="link-row"
              onClick={() => onOpen(r.other)}
              title={r.other}
            >
              <span className="ln">L{r.line}</span> {r.otherTitle || r.other}
            </button>
          ))}
        </div>

        {outline.length > 0 && (
          <div className="side-sec">
            <h4>大纲 ({outline.length})</h4>
            {outline.map((h, i) => (
              <div
                key={i}
                className="outline-row"
                style={{ paddingLeft: 7 + (h.level - 1) * 10 }}
                onClick={() => onGotoLine?.(h.line)}
                title={`第 ${h.line} 行`}
              >
                {h.text}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
