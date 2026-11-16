/** 文档渲染：AsciiDoc 走 Asciidoctor.js，Markdown 走 markdown-it */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import type { Workspace } from "./workspace.ts";

const ASCIIDOCTOR = "file:///C:/Users/me/.workbuddy/binaries/node/versions/26.13.0-1/node_modules/asciidoctor/index.js";

interface AsciidoctorDoc {
  convert(options?: Record<string, unknown>): Promise<string> | string;
}
interface AsciidoctorModule {
  loadFile(path: string, options?: Record<string, unknown>): Promise<AsciidoctorDoc>;
}

const dynamicImport = new Function("s", "return import(s)") as (s: string) => Promise<AsciidoctorModule>;

let ad: AsciidoctorModule | null = null;
async function asciidoctor(): Promise<AsciidoctorModule> {
  if (!ad) ad = await dynamicImport(ASCIIDOCTOR);
  return ad;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/** 把 [[wikilink]] 预处理为标准链接，渲染后再还原为可拦截的属性 */
function preprocessWiki(content: string): string {
  return content.replace(
    /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g,
    (_m, target: string, anchor?: string, alias?: string) => {
      const label = (alias || target).trim();
      const href = `wikilink:${encodeURIComponent(target.trim())}${anchor ?? ""}`;
      return `[${label}](${href})`;
    },
  );
}

/** 渲染后把 wikilink: 协议还原为 data 属性，避免浏览器导航 */
function postprocess(html: string): string {
  return html.replace(/href="wikilink:([^"]*)"/g, (_m, rest: string) => `href="#" data-wikilink="${rest}"`);
}

export async function renderDocument(ws: Workspace, id: string): Promise<string> {
  const abs = join(ws.root, id);
  const node = ws.node(id);
  const format = node?.format ?? (id.toLowerCase().endsWith(".adoc") ? "asciidoc" : "markdown");

  if (format === "asciidoc") {
    const mod = await asciidoctor();
    const doc = await mod.loadFile(abs, {
      safe: "unsafe",
      base_dir: ws.root,
      standalone: false,
      logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
      attributes: { "showtitle": true, "icons": "font" },
    });
    let html = await doc.convert();
    html = String(html);
    // 内部 xref 生成的是 .adoc 链接，标出来供前端拦截
    html = html.replace(/href="([^"]*\.adoc)(#[^"]*)?"/g, (_m, p: string, h?: string) => `href="#" data-doc="${p}${h ?? ""}"`);
    return html;
  }

  const raw = readFileSync(abs, "utf8");
  return postprocess(md.render(preprocessWiki(raw)));
}

/** 读取原始源码 */
export function readSource(ws: Workspace, id: string): string {
  return readFileSync(join(ws.root, id), "utf8");
}
