/**
 * P1-1: DOCX conversion worker.
 *
 * mammoth parses OOXML with JSZip and builds a DOM-free semantic HTML string.
 * That parse is CPU-bound and belongs off the renderer thread. The caller keeps
 * rendering (dangerouslySetInnerHTML) on the main thread.
 */
import type { DocxConversionRequest } from "./docxWorkerProtocol";

interface ConversionResponse {
  id: number;
  html?: string;
  error?: string;
}

interface MammothModule {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

let modulePromise: Promise<MammothModule> | null = null;

function loadMammoth(): Promise<MammothModule> {
  if (!modulePromise) {
    modulePromise = import("mammoth")
      .then((m) => m as unknown as MammothModule)
      .catch((err: unknown) => {
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}

const ctx = self as unknown as {
  postMessage(message: ConversionResponse): void;
  onmessage: ((event: MessageEvent<DocxConversionRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const { id, arrayBuffer } = event.data;
  void (async () => {
    try {
      const mammoth = await loadMammoth();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      ctx.postMessage({ id, html: result.value });
    } catch (err) {
      ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};

export {};
