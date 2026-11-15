// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

let root: Root;
let host: HTMLDivElement;
let reads: Map<string, ReturnType<typeof deferred<Uint8Array>>>;
let readOrder: ReturnType<typeof deferred<Uint8Array>>[];
let importGate: ReturnType<typeof deferred<void>>;
let importStarted: boolean;
let displayGate: ReturnType<typeof deferred<void>>;
let factory: ReturnType<typeof vi.fn>;
let renderTo: ReturnType<typeof vi.fn>;
let bookDestroy: ReturnType<typeof vi.fn<() => void>>;
let renditionDestroy: ReturnType<typeof vi.fn<() => void>>;
let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
let StrictMode: typeof import("react").StrictMode;
let Component: typeof import("@features/attachment/EpubPreview").EpubPreview;
let mounted: boolean;
let openingFailureListeners: Set<(error: Error) => void>;

beforeEach(async () => {
  vi.resetModules();
  reads = new Map();
  readOrder = [];
  openingFailureListeners = new Set();
  importGate = deferred<void>(); displayGate = deferred<void>(); importStarted = false;
  renditionDestroy = vi.fn();
  const rendition = { display: vi.fn(() => displayGate.promise), destroy: renditionDestroy };
  renderTo = vi.fn(() => rendition);
  // Match installed epub.js ownership: Book.destroy() destroys its rendition.
  bookDestroy = vi.fn(() => renditionDestroy());
  factory = vi.fn(() => ({
    renderTo,
    destroy: bookDestroy,
    on: (event: string, listener: (error: Error) => void) => {
      if (event === "openFailed") openingFailureListeners.add(listener);
    },
    off: (event: string, listener: (error: Error) => void) => {
      if (event === "openFailed") openingFailureListeners.delete(listener);
    },
  }));
  const app = { vault: {
    readBinary: (path: string) => {
      const read = deferred<Uint8Array>();
      reads.set(path, read);
      readOrder.push(read);
      return read.promise;
    },
  } };
  vi.doMock("@app/AppContext", () => ({ useApp: () => app }));
  vi.doMock("@core/i18n", () => ({ useI18n: () => (key: string) => key }));
  vi.doMock("epubjs", async () => {
    importStarted = true; await importGate.promise; return { default: factory };
  });
  const react = await import("react"); act = react.act; createElement = react.createElement;
  StrictMode = react.StrictMode;
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  Component = (await import("@features/attachment/EpubPreview")).EpubPreview;
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host); mounted = true;
});

async function show(path = "old.epub") {
  await act(async () => { root.render(createElement(Component, { path })); });
  expect(reads.has(path)).toBe(true);
}

async function releaseRead(path = "old.epub") {
  await act(async () => { reads.get(path)!.resolve(new Uint8Array([1, 2])); });
}

async function load() {
  await show(); await releaseRead();
  await vi.waitFor(() => expect(importStarted).toBe(true));
  await act(async () => { importGate.resolve(); });
  await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
}

async function unmount() {
  if (mounted) { await act(async () => root.unmount()); mounted = false; }
}

afterEach(async () => {
  await unmount(); host.remove(); vi.doUnmock("epubjs");
  vi.doUnmock("@app/AppContext"); vi.doUnmock("@core/i18n");
});

describe("EPUB preview effect ownership", () => {
  it("shows an opening error even when display never settles", async () => {
    await load();
    await act(async () => {
      for (const listener of [...openingFailureListeners]) listener(new Error("Cannot load book"));
    });
    expect(host.querySelector('[data-testid="format-error"]')).not.toBeNull();
    expect(bookDestroy).toHaveBeenCalledTimes(1);
    expect(openingFailureListeners.size).toBe(0);
    await unmount();
    expect(bookDestroy).toHaveBeenCalledTimes(1);
  });

  it("detaches the opening-failure listener and ignores a late callback after unmount", async () => {
    await load();
    const lateListeners = [...openingFailureListeners];
    expect(lateListeners).toHaveLength(1);
    await unmount();
    expect(openingFailureListeners.size).toBe(0);
    await act(async () => { lateListeners[0](new Error("late opening error")); });
    expect(host.textContent).toBe("");
    expect(bookDestroy).toHaveBeenCalledTimes(1);
  });

  it("does not create a book after unmount during file reading", async () => {
    await show(); await unmount(); importGate.resolve(); await releaseRead();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(factory).not.toHaveBeenCalled();
  });

  it("does not render stale work into a replacement preview", async () => {
    await show(); await releaseRead();
    await vi.waitFor(() => expect(importStarted).toBe(true));
    await show("new.epub");
    await act(async () => { importGate.resolve(); });
    expect(factory).not.toHaveBeenCalled();
    await releaseRead("new.epub");
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    expect(renderTo.mock.calls[0][0]).toBe(host.querySelector(".epub-viewer"));
  });

  it("does not create a book after unmount during module loading", async () => {
    await show();
    await releaseRead();
    await vi.waitFor(() => expect(importStarted).toBe(true));
    await unmount();
    await act(async () => { importGate.resolve(); });
    expect(factory).not.toHaveBeenCalled();
  });

  it("ignores StrictMode's discarded effect and loads the active one", async () => {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Component, { path: "old.epub" })));
    });
    expect(readOrder).toHaveLength(2);
    importGate.resolve();
    await act(async () => { readOrder[0].resolve(new Uint8Array([1])); });
    expect(factory).not.toHaveBeenCalled();
    await releaseRead();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    await unmount();
    expect(bookDestroy).toHaveBeenCalledTimes(1);
    expect(renditionDestroy).toHaveBeenCalledTimes(1);
  });

  it("releases the book and its rendition once on normal close", async () => {
    await load(); await act(async () => { displayGate.resolve(); }); await unmount();
    expect(bookDestroy).toHaveBeenCalledTimes(1);
    expect(renditionDestroy).toHaveBeenCalledTimes(1);
  });

  it("does not skip book cleanup when its rendition cleanup throws", async () => {
    await load(); renditionDestroy.mockImplementation(() => { throw new Error("synthetic teardown"); });
    await unmount(); expect(bookDestroy).toHaveBeenCalledTimes(1);
  });

  it("releases resources when display fails and does not repeat cleanup", async () => {
    await load(); await act(async () => { displayGate.reject(new Error("synthetic display")); });
    expect(host.querySelector('[data-testid="format-error"]')).not.toBeNull();
    expect(bookDestroy).toHaveBeenCalledTimes(1);
    expect(renditionDestroy).toHaveBeenCalledTimes(1);
    await unmount(); expect(bookDestroy).toHaveBeenCalledTimes(1);
  });

  it("releases the book if render setup throws", async () => {
    renderTo.mockImplementation(() => { throw new Error("synthetic render setup"); });
    await load();
    expect(host.querySelector('[data-testid="format-error"]')).not.toBeNull();
    expect(bookDestroy).toHaveBeenCalledTimes(1);
    await unmount();
    expect(bookDestroy).toHaveBeenCalledTimes(1);
  });

  it("ignores a display rejection that arrives after unmount", async () => {
    await load(); await unmount();
    await act(async () => { displayGate.reject(new Error("late failure")); });
    expect(host.textContent).toBe(""); expect(bookDestroy).toHaveBeenCalledTimes(1);
  });
});
