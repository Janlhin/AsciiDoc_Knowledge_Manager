/** AsciiDoc 解析器：章节树走 Asciidoctor AST，行内引用在块内容上扫描（ADR-0001 的分层策略） */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { basename, extname } from "node:path";
import type { Heading, ParsedDoc, RawLink } from "../../shared/types.ts";

const ASCIIDOCTOR = "file:///C:/Users/Janlhin/.workbuddy/binaries/node/versions/26.13.0-1/node_modules/asciidoctor/index.js";

/** Asciidoctor.js 的最小类型面（我们只用块级遍历与源码定位） */
interface AsciidoctorBlock {
  getContext?(): string;
  getLevel?(): number;
  getTitle?(): string;
  getSourceLocation?(): { getLineNumber?(): number } | undefined;
  getBlocks?(): AsciidoctorBlock[];
}
interface AsciidoctorDocument {
  getBlocks(): AsciidoctorBlock[];
}
interface AsciidoctorModule {
  loadFile(path: string, options?: Record<string, unknown>): Promise<AsciidoctorDocument>;
}

/** 通过 Function 构造动态导入，规避 TS 对运行时 file:// 路径的模块解析 */
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<AsciidoctorModule>;

let ad: AsciidoctorModule | null = null;
async function asciidoctor(): Promise<AsciidoctorModule> {
  if (!ad) ad = await dynamicImport(ASCIIDOCTOR);
  return ad;
}

const XREF = /xref:([^\[\s]+)\[([^\]]*)\]/g;
const LINK = /(?<!x)link:([^\[\s]+)\[([^\]]*)\]/g;
const INCLUDE = /^include::([^\[]+)\[([^\]]*)\]/;
/** AsciiDoc 简写交叉引用：<<target>> 或 <<target,text>> */
const SHORT_XREF = /<<([^<>\n]+)>>/g;
const ATTR_LINE = /^:([A-Za-z0-9_-]+):\s*(.*)$/;
const DOC_TITLE = /^=\s+(.+)$/;
/** 块分隔符：listing / literal / comment / block 等，块内不扫引用 */
const DELIM = /^(\/{4}|-{4,}|\.{4,}|\+{4,}|_{4,}|\*{4,}|={4,})$/;

/** 解析文档头：标题与属性表 */
function parseHeader(content: string): { title: string; attrs: Record<string, string> } {
  const lines = content.split(/\r?\n/);
  const attrs: Record<string, string> = {};
  let title = "";

  for (const line of lines) {
    if (!title) {
      const t = DOC_TITLE.exec(line);
      if (t) {
        title = t[1].trim();
        continue;
      }
    }
    const a = ATTR_LINE.exec(line);
    if (a) {
      attrs[a[1].toLowerCase()] = a[2].trim();
      continue;
    }
    // 遇到正文（非空且非属性）即结束文档头
    if (line.trim() !== "" && !line.startsWith("//") && title) break;
  }
  return { title, attrs };
}

/** 属性替换：{name} → value，递归至稳定，带深度上限 */
function substitute(input: string, attrs: Record<string, string>): string {
  let cur = input;
  let prev = "";
  let guard = 0;
  while (cur !== prev && guard < 10) {
    prev = cur;
    cur = cur.replace(/\{([A-Za-z0-9_-]+)\}/g, (m, k: string) => attrs[k.toLowerCase()] ?? m);
    guard++;
  }
  return cur;
}

/** 静默 logger：文档自身的语法告警不应污染服务日志 */
const QUIET_LOGGER = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

/** 从 Asciidoctor AST 抽取章节（含源码行号）；失败返回空数组 */
async function extractHeadings(absPath: string, root: string, content: string): Promise<Heading[]> {
  try {
    const mod = await asciidoctor();
    const doc = await mod.loadFile(absPath, {
      safe: "unsafe",
      sourcemap: true,
      base_dir: root,
      logger: QUIET_LOGGER,
    });
    const out: Heading[] = [];
    const walk = (node: any): void => {
      for (const b of node.getBlocks?.() ?? []) {
        if (b.getContext?.() === "section") {
          out.push({
            level: b.getLevel?.() ?? 1,
            text: b.getTitle?.() ?? "",
            line: b.getSourceLocation?.()?.getLineNumber?.() ?? 0,
          });
        }
        walk(b);
      }
    };
    walk(doc);
    return out;
  } catch {
    // 降级：正则抽标题
    const out: Heading[] = [];
    content.split(/\r?\n/).forEach((l, i) => {
      const m = /^(={2,6})\s+(.+)$/.exec(l);
      if (m) out.push({ level: m[1].length - 1, text: m[2].trim(), line: i + 1 });
    });
    return out;
  }
}

/** 扫描行内引用：跳过 listing/literal 块与行注释 */
function scanLinks(content: string, attrs: Record<string, string>): RawLink[] {
  const lines = content.split(/\r?\n/);
  const links: RawLink[] = [];
  let inBlock = false;
  let blockChar = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const d = DELIM.exec(line);
    if (d) {
      const ch = d[1][0];
      if (!inBlock) {
        inBlock = true;
        blockChar = ch;
      } else if (blockChar === ch) {
        inBlock = false;
        blockChar = "";
      }
      continue;
    }
    if (inBlock) continue;
    if (/^\/\//.test(line)) continue;

    for (const m of line.matchAll(XREF)) {
      const target = substitute(m[1], attrs);
      links.push({
        raw: m[0],
        target,
        kind: "xref",
        line: i + 1,
        reftext: m[2],
        unresolvedAttr: /\{[A-Za-z0-9_-]+\}/.test(target),
      });
    }

    for (const m of line.matchAll(LINK)) {
      if (/^https?:/i.test(m[1])) continue;
      const target = substitute(m[1], attrs);
      links.push({
        raw: m[0],
        target,
        kind: "link-macro",
        line: i + 1,
        reftext: m[2],
        unresolvedAttr: /\{[A-Za-z0-9_-]+\}/.test(target),
      });
    }

    const inc = INCLUDE.exec(line);
    if (inc) {
      const target = substitute(inc[1], attrs);
      links.push({
        raw: line.trim(),
        target,
        kind: "include",
        line: i + 1,
        reftext: "",
        unresolvedAttr: /\{[A-Za-z0-9_-]+\}/.test(target),
      });
    }

    for (const m of line.matchAll(SHORT_XREF)) {
      // <<file.adoc#anchor,text>> —— 只取逗号前的目标部分
      const inner = m[1];
      const commaAt = inner.indexOf(",");
      const targetPart = (commaAt >= 0 ? inner.slice(0, commaAt) : inner).trim();
      const reftext = commaAt >= 0 ? inner.slice(commaAt + 1).trim() : "";
      // 纯锚点（不含路径分隔符、不含已知扩展名）视为文档内引用，不建跨文档边
      const looksCrossDoc = /[\/\\]/.test(targetPart) || /\.(adoc|md|html?)$/i.test(targetPart.split("#")[0]);
      if (!looksCrossDoc) continue;
      const resolved = substitute(targetPart, attrs);
      links.push({
        raw: m[0],
        target: resolved,
        kind: "xref-short",
        line: i + 1,
        reftext,
        unresolvedAttr: /\{[A-Za-z0-9_-]+\}/.test(resolved),
      });
    }
  }
  return links;
}

export async function parseAsciiDoc(
  id: string,
  absPath: string,
  root: string,
  preloaded?: string,
): Promise<ParsedDoc> {
  const content = preloaded ?? readFileSync(absPath, "utf8");
  const { title, attrs } = parseHeader(content);
  const headings = await extractHeadings(absPath, root, content);
  const links = scanLinks(content, attrs);

  return {
    title: title || basename(id, extname(id)),
    headings,
    links,
  };
}
