/**
 * P1-3: AsciiDoc conversion worker.
 *
 * `@asciidoctor/core` is a WASM/JS converter; on a large .adoc file it occupies
 * the renderer thread for the whole conversion. This worker owns the module and
 * converts source strings off-thread. Link localisation and sanitisation stay on
 * the caller side (they are cheap string passes over the returned fragment).
 */
interface ConversionRequest {
  id: number;
  source: string;
}

interface ConversionResponse {
  id: number;
  html?: string;
  error?: string;
}

interface AdocModule {
  convert(source: string, options?: Record<string, unknown>): Promise<string> | string;
}

let modulePromise: Promise<AdocModule> | null = null;

function loadAsciidoctor(): Promise<AdocModule> {
  if (!modulePromise) {
    modulePromise = import("@asciidoctor/core")
      .then((m) => m as unknown as AdocModule)
      .catch((err: unknown) => {
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}

const ctx = self as unknown as {
  postMessage(message: ConversionResponse): void;
  onmessage: ((event: MessageEvent<ConversionRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const { id, source } = event.data;
  void (async () => {
    try {
      const mod = await loadAsciidoctor();
      const raw = await mod.convert(source, {
        standalone: false,
        // secure disables include:: and file-reading attributes
        safe: "secure",
        attributes: {
          showtitle: true,
          outfilesuffix: ".adoc",
          icons: "font",
          sectanchors: false,
        },
      });
      ctx.postMessage({ id, html: String(raw) });
    } catch (err) {
      ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};

export {};
