// @vitest-environment jsdom
/**
 * Q-005: Kindle preview component — success, chapter paging, parser routing,
 * resource disposal and error feedback. The parser itself is mocked; the real
 * library's availability is checked by scripts/verify-format-libs.ts and the
 * chapter-HTML reduction by tests/mobi.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

let root: Root;
let host: HTMLDivElement;
let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let Component: typeof import("@features/attachment/MobiPreview").MobiPreview;
let bookDestroy: ReturnType<typeof vi.fn>;
let initMobi: ReturnType<typeof vi.fn>;
let initKf8: ReturnType<typeof vi.fn>;
let failNext: boolean;

const CHAPTERS: Record<string, string> = {
  c1: "<h1>Chapter One</h1><p>Alpha text.</p><script>alert(1)</script>",
  c2: "<h1>Chapter Two</h1><p>Beta text.</p>",
};

beforeEach(async () => {
  vi.resetModules();
  failNext = false;
  bookDestroy = vi.fn();
  const book = {
    getSpine: () => [{ id: "c1" }, { id: "c2" }],
    getMetadata: () => ({ title: "Mock Book", author: ["Ada"] }),
    loadChapter: (id: string) => ({ html: CHAPTERS[id] ?? "" }),
    destroy: bookDestroy,
  };
  initMobi = vi.fn(async () => {
    if (failNext) throw new Error("bad MOBI");
    return book;
  });
  initKf8 = vi.fn(async () => book);
  vi.doMock("@app/AppContext", () => ({
    useApp: () => ({ vault: { readBinary: async () => new Uint8Array([1, 2, 3]) } }),
  }));
  vi.doMock("@core/i18n", () => ({
    useI18n: () => (key: string, vars?: Record<string, string>) =>
      vars ? `${key}:${Object.values(vars).join("/")}` : key,
  }));
  vi.doMock("@lingo-reader/mobi-parser", () => ({
    initMobiFile: initMobi,
    initKf8File: initKf8,
  }));
  const react = await import("react");
  act = react.act;
  createElement = react.createElement;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  Component = (await import("@features/attachment/MobiPreview")).MobiPreview;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.doUnmock("@lingo-reader/mobi-parser");
  vi.doUnmock("@app/AppContext");
  vi.doUnmock("@core/i18n");
});

async function show(path: string) {
  await act(async () => { root.render(createElement(Component, { path })); });
}

describe("MobiPreview", () => {
  it("renders safe chapter text and metadata after loading", async () => {
    await show("book.mobi");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="mobi-preview"]')).not.toBeNull());
    expect(host.textContent).toContain("Mock Book");
    expect(host.textContent).toContain("Chapter One");
    expect(host.textContent).toContain("Alpha text.");
    expect(host.textContent).not.toContain("alert(1)");
    expect(initMobi).toHaveBeenCalledTimes(1);
    expect(initKf8).not.toHaveBeenCalled();
  });

  it("pages chapters on demand", async () => {
    await show("book.mobi");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="mobi-next"]')).not.toBeNull());
    expect(host.querySelector('[data-testid="mobi-position"]')?.textContent).toContain("1/2");
    await act(async () => {
      (host.querySelector('[data-testid="mobi-next"]') as HTMLButtonElement).click();
    });
    expect(host.textContent).toContain("Chapter Two");
    expect(host.querySelector('[data-testid="mobi-position"]')?.textContent).toContain("2/2");
  });

  it("routes .azw3 to the KF8 parser", async () => {
    await show("book.azw3");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="mobi-preview"]')).not.toBeNull());
    expect(initKf8).toHaveBeenCalledTimes(1);
    expect(initMobi).not.toHaveBeenCalled();
  });

  it("releases the parser's resources on unmount", async () => {
    await show("book.mobi");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="mobi-preview"]')).not.toBeNull());
    await act(async () => root.unmount());
    expect(bookDestroy).toHaveBeenCalled();
    root = (await import("react-dom/client")).createRoot(document.createElement("div"));
  });

  it("shows the standard error placeholder when parsing fails", async () => {
    failNext = true;
    await show("broken.mobi");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="format-error"]')).not.toBeNull());
    expect(host.textContent).toContain("attachment.loadFailed");
  });
});
