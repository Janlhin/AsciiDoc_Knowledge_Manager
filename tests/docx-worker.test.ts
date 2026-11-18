// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import JSZip from "jszip";

// Vitest resolves Node exports by default; production Vite uses mammoth's
// browser entry, which accepts arrayBuffer rather than a Node file/buffer.
vi.mock("mammoth", async () => {
  const browser = await import("mammoth/mammoth.browser.js");
  const mammoth = browser.default;
  return { default: mammoth, convertToHtml: mammoth.convertToHtml };
});

vi.mock("@app/AppContext", () => ({ useApp: vi.fn() }));
vi.mock("@core/i18n", () => ({ useI18n: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("converts the caller payload in the real worker handler without fallback", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Worker contract sentinel</w:t></w:r></w:p></w:body></w:document>`);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  type Response = { id: number; html?: string; error?: string };
  const replies: Response[] = [];
  let bridge: Bridge;
  // Simulate transport only; use the real caller, worker handler and mammoth.
  // No claim of a real browser Worker thread or WebView performance.
  const scope = {
    location: window.location,
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (data: Response) => {
      replies.push(data);
      queueMicrotask(() => bridge.onmessage?.({ data } as MessageEvent));
    },
  };
  class Bridge {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { bridge = this; }
    postMessage(data: unknown) { queueMicrotask(() => scope.onmessage?.({ data } as MessageEvent)); }
    terminate() {}
  }
  vi.stubGlobal("self", scope);
  vi.stubGlobal("Worker", Bridge);
  await import("@features/attachment/docx.worker");
  expect(scope.onmessage).toBeTypeOf("function");
  const { convertDocx } = await import("@features/attachment/DocxPreview");
  const html = await convertDocx(bytes);
  expect(bridge!).toBeDefined();
  expect(replies).toHaveLength(1);
  expect(replies[0].error).toBeUndefined();
  expect(replies[0].html).toContain("Worker contract sentinel");
  expect(html).toBe(replies[0].html);
});
