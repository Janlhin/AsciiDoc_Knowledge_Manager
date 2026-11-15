/** Markdown 解析器：提取标题、[[wikilink]] 与 [text](path) 引用 */
import { basename, extname } from "node:path";
import type { Heading, ParsedDoc, RawLink } from "../../shared/types.ts";

const WIKILINK = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(\|([^\[\]]*))?\]\]/g;
const MDLINK = /(?<!!)\[([^\]]*)\]\(([^)\s]+?)(?:#[^)]*)?\)/g;
const FENCE = /^\s*(```|~~~)/;

export function parseMarkdown(id: string, content: string): ParsedDoc {
  const lines = content.split(/\r?\n/);
  const links: RawLink[] = [];
  const headings: Heading[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h && !inFence) {
      headings.push({ level: h[1].length, text: h[2].trim(), line: i + 1 });
    }

    if (inFence) continue;

    for (const m of line.matchAll(WIKILINK)) {
      const target = m[1].trim();
      // 排除空目标与纯占位符
      if (!target || /^[\s`]+$/.test(target)) continue;
      links.push({
        raw: m[0],
        target,
        kind: "wikilink",
        line: i + 1,
        reftext: m[4] || target,
      });
    }

    for (const m of line.matchAll(MDLINK)) {
      const href = m[2];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      links.push({
        raw: m[0],
        target: safeDecode(href),
        kind: "markdown-link",
        line: i + 1,
        reftext: m[1],
      });
    }
  }

  const title = headings.find((h) => h.level === 1)?.text ?? basename(id, extname(id));
  return { title, headings, links };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
