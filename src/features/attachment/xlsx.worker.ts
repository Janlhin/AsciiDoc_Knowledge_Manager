/**
 * P1-2: XLSX parsing worker.
 *
 * SheetJS `read()` + `sheet_to_json()` turn OOXML into plain cell arrays; that
 * is CPU-bound and can be large. The grid itself (x-data-spreadsheet) must stay
 * on the main thread because it owns DOM. This worker returns only serialisable
 * sheet objects, built with the same shape as the caller's aoaToSheet helper.
 */
interface ParseRequest {
  id: number;
  bytes: Uint8Array;
}

interface ParseResponse {
  id: number;
  sheets?: unknown[];
  error?: string;
  computeMs?: number;
}

interface SheetData {
  name: string;
  freeze: string;
  styles: unknown[];
  merges: unknown[];
  cols: { len: number };
  rows: Record<string, unknown> & { len: number };
}

function aoaToSheet(name: string, aoa: unknown[][]): SheetData {
  const rows: SheetData["rows"] = { len: aoa.length + 50 };
  let maxC = 0;
  aoa.forEach((row, r) => {
    const cells: Record<string, { text: string }> = {};
    row.forEach((v, c) => {
      if (v !== "" && v != null) cells[c] = { text: String(v) };
      if (c > maxC) maxC = c;
    });
    if (Object.keys(cells).length) rows[r] = { cells };
  });
  return { name, freeze: "", styles: [], merges: [], cols: { len: maxC + 10 }, rows };
}

let modulePromise: Promise<typeof import("xlsx")> | null = null;
function loadXlsx() {
  if (!modulePromise) {
    modulePromise = import("xlsx").catch((err: unknown) => {
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

const ctx = self as unknown as {
  postMessage(message: ParseResponse): void;
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const { id, bytes } = event.data;
  void (async () => {
    const t0 = performance.now();
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(bytes, { type: "array" });
      const sheets = wb.SheetNames.map((name) =>
        aoaToSheet(
          name,
          XLSX.utils.sheet_to_json(wb.Sheets[name], {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false,
          }) as unknown[][],
        ),
      );
      ctx.postMessage({ id, sheets, computeMs: performance.now() - t0 });
    } catch (err) {
      ctx.postMessage({
        id,
        error: err instanceof Error ? err.message : String(err),
        computeMs: performance.now() - t0,
      });
    }
  })();
};

export {};
