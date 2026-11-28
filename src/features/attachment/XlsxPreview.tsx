import { useEffect, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { workerPool } from "@core/workers/workerPool";
// x-data-spreadsheet's source (`src/index.js`, the package `main`) imports its own
// `.less` stylesheet; `less` is installed as a devDependency so Vite compiles it.
// No explicit CSS import is needed here.

/**
 * Excel preview (ADKM L4) — the one format we make genuinely EDITABLE (the user
 * asked for editable, and x-spreadsheet is a real in-browser grid). SheetJS
 * parses the .xlsx into cell data; x-spreadsheet renders an interactive grid. A
 * "Save" button serializes the grid back to .xlsx via SheetJS and writes it to
 * the vault (vault.modifyBinary) — so edits persist, but the file is ONLY ever
 * written through the explicit Save action, never the markdown autosave path
 * (R102 data-safety boundary preserved).
 *
 * Both SheetJS and x-spreadsheet are lazy-loaded via dynamic import.
 */
type XSpreadsheet = any;

/** x-spreadsheet loadData expects {name, freeze, styles, merges, cols, rows},
 *  with rows an object keyed by row index → { cells: { colIndex: { text } } }. */
function aoaToSheet(name: string, aoa: unknown[][]): any {
  const rows: any = { len: aoa.length + 50 };
  let maxC = 0;
  aoa.forEach((row, r) => {
    const cells: any = {};
    row.forEach((v, c) => {
      if (v !== "" && v != null) cells[c] = { text: String(v) };
      if (c > maxC) maxC = c;
    });
    if (Object.keys(cells).length) rows[r] = { cells };
  });
  return {
    name,
    freeze: "",
    styles: [],
    merges: [],
    cols: { len: maxC + 10 },
    rows,
  };
}

/** Inverse of aoaToSheet: works for both object rows (classic x-spreadsheet)
 *  and array rows (some builds), reading `text` off each cell. */
function sheetToAoa(sheet: any): unknown[][] {
  const rows = sheet?.rows || {};
  const isArray = Array.isArray(rows);
  let maxR = isArray ? rows.length - 1 : -1;
  let maxC = -1;
  const scan = (cells: any) => {
    if (!cells) return;
    for (const ck of Object.keys(cells)) {
      const c = Number(ck);
      if (c > maxC) maxC = c;
    }
  };
  if (!isArray) {
    for (const rk of Object.keys(rows)) {
      if (rk === "len") continue;
      const r = Number(rk);
      scan(rows[rk]?.cells);
      if (r > maxR) maxR = r;
    }
  } else {
    for (let r = 0; r < rows.length; r++) scan(rows[r]?.cells);
  }
  const aoa: unknown[][] = [];
  for (let r = 0; r <= maxR; r++) {
    const line: unknown[] = [];
    const cells = (isArray ? rows[r]?.cells : rows[r]?.cells) || {};
    for (let c = 0; c <= maxC; c++) {
      const cell = cells[c];
      line.push(cell && cell.text != null ? cell.text : "");
    }
    aoa.push(line);
  }
  return aoa;
}

/*
 * T-063: SheetJS parsing runs through the shared WorkerPool (P1-2); only the
 * x-data-spreadsheet grid and the explicit Save serialization stay on the main
 * thread (DOM / user action).
 */
async function parseInWorker(bytes: Uint8Array): Promise<unknown[]> {
  // Transfer the buffer only when the view owns the whole backing store; a
  // view over a larger pooled buffer must stay a structured clone.
  const backing = bytes.buffer;
  const transfer: Transferable[] =
    bytes.byteOffset === 0 && bytes.byteLength === backing.byteLength ? [backing] : [];
  return workerPool.submit<unknown[]>({
    spec: {
      kind: "xlsx",
      url: new URL("./xlsx.worker.ts", import.meta.url),
      create: () => new Worker(new URL("./xlsx.worker.ts", import.meta.url), { type: "module" }),
    },
    payload: { bytes },
    transfer,
    priority: "visible",
    decode: (reply) => {
      if (Array.isArray(reply.sheets)) return reply.sheets as unknown[];
      throw new Error(
        typeof reply.error === "string" && reply.error !== ""
          ? reply.error
          : "XLSX worker returned no sheets",
      );
    },
  });
}

async function parseInPage(bytes: Uint8Array): Promise<unknown[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name: string) =>
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
}

export function isXlsxWorkerActive(): boolean {
  return workerPool.hasActiveKind("xlsx");
}

export async function parseXlsx(bytes: Uint8Array, options: { forceInPage?: boolean } = {}): Promise<unknown[]> {
  if (options.forceInPage) return parseInPage(bytes);
  try {
    return await parseInWorker(bytes);
  } catch {
    return parseInPage(bytes);
  }
}

export function XlsxPreview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<XSpreadsheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let instance: XSpreadsheet | null = null;
    setReady(false);
    setError(null);
    void (async () => {
      try {
        const bytes = await app.vault.readBinary(path);
        const data = await parseXlsx(bytes);
        const el = containerRef.current;
        if (!el) return;
        const Spreadsheet = (await import("x-data-spreadsheet")).default as new (
          el: HTMLElement,
          opts?: any,
        ) => XSpreadsheet;
        instance = new Spreadsheet(el, {
          showToolbar: true,
          showGrid: true,
          mode: "edit",
          view: {
            height: () => el.clientHeight,
            width: () => el.clientWidth,
          },
        });
        instance.loadData(data);
        sheetRef.current = instance;
        // x-spreadsheet reads dimensions once at construction; re-render after
        // layout settles so it fills the (flex) container correctly.
        requestAnimationFrame(() => {
          if (!cancelled) instance?.reRender?.();
        });
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      try {
        instance?.destroy?.();
      } catch {
        /* ignore teardown errors */
      }
      sheetRef.current = null;
    };
  }, [app, path]);

  // re-render the grid on window resize so it keeps filling the container
  useEffect(() => {
    if (!ready) return;
    const onResize = () => sheetRef.current?.reRender?.();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ready]);

  const onSave = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setSavedFlash(false);
    try {
      const instance = sheetRef.current;
      const XLSX = await import("xlsx");
      const data = instance?.getData?.() as any[] | undefined;
      const wb = XLSX.utils.book_new();
      (data ?? []).forEach((sheet) => {
        const aoa = sheetToAoa(sheet);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(
          wb,
          ws,
          (sheet?.name as string) || `Sheet${wb.SheetNames.length + 1}`,
        );
      });
      const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      await app.vault.modifyBinary(path, new Uint8Array(out));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="format-xlsx" data-testid="xlsx-preview">
      <div className="format-xlsx-toolbar">
        <button
          className={"mod-cta" + (savedFlash ? " is-saved" : "")}
          onClick={onSave}
          disabled={!ready || saving}
          data-testid="xlsx-save"
        >
          {savedFlash ? t("attachment.saved") : t("attachment.save")}
        </button>
        <span className="format-xlsx-hint">{t("attachment.xlsxHint")}</span>
      </div>
      <div className="format-xlsx-grid" ref={containerRef} />
    </div>
  );
}
