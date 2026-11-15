/**
 * ADKM L4 verification — exercises the core conversion logic the preview
 * components depend on, using the REAL libraries and minimal generated files.
 * Run: node scripts/verify-format-libs.ts
 */
import JSZip from "jszip";
import mammoth from "mammoth";
import { createRequire } from "node:module";

// xlsx ships an ESM-flavoured .d.ts but is a CommonJS package at runtime.
// createRequire gives us the real module.exports AND keeps the full types.
const requireCjs = createRequire(import.meta.url);
const XLSX = requireCjs("xlsx") as typeof import("xlsx");

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let failures = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${msg}`);
  if (!cond) failures++;
};

// ---- DOCX: generate a minimal docx, confirm mammoth converts it ----
async function testDocx(): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Hello DOCX title</w:t></w:r></w:p>
<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:body></w:document>`,
  );
  const buf = await zip.generateAsync({ type: "arraybuffer" });
  // Browser build (used by the app) accepts {arrayBuffer}; the Node build used
  // here accepts {buffer}. The conversion logic is identical — validate parsing.
  const u8 = new Uint8Array(buf);
  const res = await mammoth.convertToHtml({ buffer: Buffer.from(u8) });
  ok(
    res.value.includes("Hello DOCX title") && res.value.includes("Second paragraph"),
    `mammoth converts docx → HTML (found both paragraphs)`,
  );
}

// ---- XLSX: round-trip aoaToSheet / sheetToAoa logic used by XlsxPreview ----
/** One cell of the grid — only the display text is modelled. */
interface Cell {
  text: string;
}

/** Cells of a single row, keyed by column index. */
type SheetCells = Record<number, Cell>;

/** A single row: the cell map. */
interface SheetRow {
  cells: SheetCells;
}

/**
 * The rows bag of the grid. `len` is the pre-allocated row count; numeric
 * keys hold the actual rows. The string index signature is what lets us read
 * a row back out by the (string) key we got from Object.keys().
 */
interface SheetRows {
  len: number;
  [key: string]: number | SheetRow | undefined;
}

/** The minimal sheet shape the preview component consumes. */
interface GridSheet {
  name: string;
  freeze: string;
  styles: unknown[];
  merges: unknown[];
  cols: { len: number };
  rows: SheetRows;
}

/** Narrows a `SheetRows` entry to an actual row (vs. the `len` counter). */
function isRow(value: number | SheetRow | undefined): value is SheetRow {
  return typeof value === "object" && value !== null;
}

function aoaToSheet(name: string, aoa: string[][]): GridSheet {
  const rows: SheetRows = { len: aoa.length + 50 };
  let maxC = 0;
  aoa.forEach((row, r) => {
    const cells: SheetCells = {};
    row.forEach((v, c) => {
      if (v !== "" && v != null) cells[c] = { text: String(v) };
      if (c > maxC) maxC = c;
    });
    if (Object.keys(cells).length) rows[r] = { cells };
  });
  return { name, freeze: "", styles: [], merges: [], cols: { len: maxC + 10 }, rows };
}

function sheetToAoa(sheet: GridSheet | undefined): string[][] {
  const rows = sheet?.rows;
  if (!rows) return [];

  let maxR = -1;
  let maxC = -1;

  const scan = (cells: SheetCells | undefined): void => {
    if (!cells) return;
    for (const ck of Object.keys(cells)) {
      const c = Number(ck);
      if (c > maxC) maxC = c;
    }
  };

  for (const rk of Object.keys(rows)) {
    if (rk === "len") continue;
    const row = rows[rk];
    if (isRow(row)) scan(row.cells);
    const r = Number(rk);
    if (r > maxR) maxR = r;
  }

  const aoa: string[][] = [];
  for (let r = 0; r <= maxR; r++) {
    const line: string[] = [];
    const row = rows[r];
    const cells = (isRow(row) ? row.cells : undefined) ?? {};
    for (let c = 0; c <= maxC; c++) {
      const cell = cells[c];
      line.push(cell && cell.text != null ? cell.text : "");
    }
    aoa.push(line);
  }
  return aoa;
}

function testXlsx(): void {
  const src: string[][] = [
    ["A1", "B1"],
    ["A2", "B2"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(src), "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const wb2 = XLSX.read(out, { type: "array" });
  const data = wb2.SheetNames.map((name) =>
    aoaToSheet(
      name,
      XLSX.utils.sheet_to_json(wb2.Sheets[name], {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      }) as string[][],
    ),
  );
  const back = sheetToAoa(data[0]);
  ok(
    JSON.stringify(back) === JSON.stringify([["A1", "B1"], ["A2", "B2"]]),
    `xlsx parse → grid → save-back round-trip preserves cells`,
  );
}

// ---- PPTX: generate a minimal pptx with text + image, confirm slide extraction ----
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function slideNumber(file: string): number {
  const m = /slide(\d+)\.xml$/.exec(file);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

async function testPptx(): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide heading</a:t></a:r></a:p>
<a:p><a:r><a:t>Bullet one</a:t></a:r></a:p></p:txBody></p:sp>
<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>
</p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`,
  );
  zip.file("ppt/media/image1.png", PNG_B64, { base64: true });
  const bytes = await zip.generateAsync({ type: "uint8array" });

  // mirror PptxPreview logic
  const z = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(z.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  let foundText = false;
  let foundImage = false;
  for (const sf of slideFiles) {
    const slideObj = z.file(sf);
    if (!slideObj) continue;
    const xml = await slideObj.async("string");
    const texts: string[] = [];
    let m: RegExpExecArray | null;
    const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
    while ((m = tRe.exec(xml)) !== null) texts.push(decodeXml(m[1]));
    foundText =
      texts.join("\n").includes("Slide heading") && texts.join("\n").includes("Bullet one");

    const relsObj = z.file(sf.replace(/slides\/slide(\d+)\.xml$/, "slides/_rels/slide$1.xml.rels"));
    const relsXml = relsObj ? await relsObj.async("string") : "";
    const embedToTarget: Record<string, string> = {};
    const relRe = /<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
    while ((m = relRe.exec(relsXml)) !== null) embedToTarget[m[1]] = m[2];

    const blipRe = /r:embed="(rId\d+)"/g;
    let target: string | null = null;
    while ((m = blipRe.exec(xml)) !== null) {
      if (embedToTarget[m[1]]) {
        target = embedToTarget[m[1]];
        break;
      }
    }
    const mediaPath = target
      ? ("ppt/slides/" + target).replace(/ppt\/slides\/\.\.\//, "ppt/")
      : "";
    const f = mediaPath ? z.file(mediaPath) : null;
    if (f) {
      const b64 = await f.async("base64");
      foundImage = b64 === PNG_B64;
    }
  }
  ok(foundText, `pptx slide text extracted (heading + bullet)`);
  ok(foundImage, `pptx slide image resolved via rels → media path`);
}

/**
 * ADKM L4 extension — archive layer for the new READ-ONLY ebook formats.
 * Mirrors the component logic (jszip unpack + numeric page ordering); the XML
 * → text-block parsing itself is covered by tests/ebook-formats.test.ts under
 * jsdom, because Node has no DOMParser.
 */
async function testEbookArchives(): Promise<void> {
  const comic = new JSZip();
  for (const name of ["page10.png", "page2.png", "page1.png", "readme.txt"]) {
    comic.file(name, PNG_B64, { base64: true });
  }
  const comicBytes = await comic.generateAsync({ type: "uint8array" });
  const cz = await JSZip.loadAsync(comicBytes);
  const pages = Object.values(cz.files)
    .filter((f) => !f.dir && /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  ok(pages.length === 3, "CBZ filters non-image entries");
  ok(pages[0] === "page1.png" && pages[2] === "page10.png", "CBZ pages sort numerically");

  const fbz = new JSZip();
  fbz.file("novel.fb2",
    '<?xml version="1.0"?><FictionBook><description><title-info>' +
    '<book-title>Zipped Book</book-title></title-info></description>' +
    "<body><p>Hello</p></body></FictionBook>");
  const fbzBytes = await fbz.generateAsync({ type: "uint8array" });
  const fz = await JSZip.loadAsync(fbzBytes);
  const entry = Object.values(fz.files)
    .find((f) => !f.dir && f.name.toLowerCase().endsWith(".fb2"));
  ok(entry !== undefined, "FBZ exposes its inner .fb2 document");
  if (entry) {
    const xml = await entry.async("string");
    ok(xml.includes("Zipped Book") && xml.includes("<body>"), "FBZ inner XML is readable");
  }
}

/** Q-005: the approved Kindle dependency must be importable in the Node side too. */
async function testMobiParser(): Promise<void> {
  const mod = await import("@lingo-reader/mobi-parser");
  ok(typeof mod.initMobiFile === "function", "mobi-parser exports initMobiFile");
  ok(typeof mod.initKf8File === "function", "mobi-parser exports initKf8File");
}

(async () => {
  try {
    await testDocx();
    testXlsx();
    await testPptx();
    await testEbookArchives();
    await testMobiParser();
  } catch (e) {
    console.error("EXCEPTION:", e);
    failures++;
  }
  console.log(failures === 0 ? "\nALL GOOD" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
