/**
 * ADKM L4 verification — exercises the core conversion logic the preview
 * components depend on, using the REAL libraries and minimal generated files.
 * Run: node scripts/verify-format-libs.mjs
 */
import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${msg}`);
  if (!cond) failures++;
};

// ---- DOCX: generate a minimal docx, confirm mammoth converts it ----
async function testDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Hello DOCX title</w:t></w:r></w:p>
<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:body></w:document>`);
  const buf = await zip.generateAsync({ type: "arraybuffer" });
  // Browser build (used by the app) accepts {arrayBuffer}; the Node build used
  // here accepts {buffer}. The conversion logic is identical — validate parsing.
  const u8 = new Uint8Array(buf);
  const res = await mammoth.convertToHtml({ buffer: Buffer.from(u8) });
  ok(res.value.includes("Hello DOCX title") && res.value.includes("Second paragraph"),
    `mammoth converts docx → HTML (found both paragraphs)`);
}

// ---- XLSX: round-trip aoaToSheet / sheetToAoa logic used by XlsxPreview ----
function aoaToSheet(name, aoa) {
  const rows = { len: aoa.length + 50 };
  let maxC = 0;
  aoa.forEach((row, r) => {
    const cells = {};
    row.forEach((v, c) => {
      if (v !== "" && v != null) cells[c] = { text: String(v) };
      if (c > maxC) maxC = c;
    });
    if (Object.keys(cells).length) rows[r] = { cells };
  });
  return { name, freeze: "", styles: [], merges: [], cols: { len: maxC + 10 }, rows };
}
function sheetToAoa(sheet) {
  const rows = sheet?.rows || {};
  const isArray = Array.isArray(rows);
  let maxR = isArray ? rows.length - 1 : -1;
  let maxC = -1;
  const scan = (cells) => { if (!cells) return; for (const ck of Object.keys(cells)) { const c = Number(ck); if (c > maxC) maxC = c; } };
  if (!isArray) {
    for (const rk of Object.keys(rows)) {
      if (rk === "len") continue;
      const r = Number(rk); scan(rows[rk]?.cells); if (r > maxR) maxR = r;
    }
  } else { for (let r = 0; r < rows.length; r++) scan(rows[r]?.cells); }
  const aoa = [];
  for (let r = 0; r <= maxR; r++) {
    const line = [];
    const cells = (isArray ? rows[r]?.cells : rows[r]?.cells) || {};
    for (let c = 0; c <= maxC; c++) { const cell = cells[c]; line.push(cell && cell.text != null ? cell.text : ""); }
    aoa.push(line);
  }
  return aoa;
}
function testXlsx() {
  const src = [["A1", "B1"], ["A2", "B2"]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(src), "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const wb2 = XLSX.read(out, { type: "array" });
  const data = wb2.SheetNames.map((name) =>
    aoaToSheet(name, XLSX.utils.sheet_to_json(wb2.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false })));
  const back = sheetToAoa(data[0]);
  ok(JSON.stringify(back) === JSON.stringify([["A1", "B1"], ["A2", "B2"]]),
    `xlsx parse → grid → save-back round-trip preserves cells`);
}

// ---- PPTX: generate a minimal pptx with text + image, confirm slide extraction ----
function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function slideNumber(file) { const m = /slide(\d+)\.xml$/.exec(file); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; }
async function testPptx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide heading</a:t></a:r></a:p>
<a:p><a:r><a:t>Bullet one</a:t></a:r></a:p></p:txBody></p:sp>
<p:pic><p:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:pic>
</p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`);
  zip.file("ppt/media/image1.png", PNG_B64, { base64: true });
  const bytes = await zip.generateAsync({ type: "uint8array" });

  // mirror PptxPreview logic
  const z = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => slideNumber(a) - slideNumber(b));
  let foundText = false, foundImage = false;
  for (const sf of slideFiles) {
    const xml = await z.file(sf).async("string");
    const texts = [];
    let m; const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
    while ((m = tRe.exec(xml))) texts.push(decodeXml(m[1]));
    foundText = texts.join("\n").includes("Slide heading") && texts.join("\n").includes("Bullet one");
    const relsXml = await z.file(sf.replace(/slides\/slide(\d+)\.xml$/, "slides/_rels/slide$1.xml.rels")).async("string");
    const embedToTarget = {}; const relRe = /<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
    while ((m = relRe.exec(relsXml))) embedToTarget[m[1]] = m[2];
    const blipRe = /r:embed="(rId\d+)"/g; let target = null;
    while ((m = blipRe.exec(xml))) { if (embedToTarget[m[1]]) { target = embedToTarget[m[1]]; break; } }
    const mediaPath = ("ppt/slides/" + target).replace(/ppt\/slides\/\.\.\//, "ppt/");
    const f = z.file(mediaPath);
    if (f) { const b64 = await f.async("base64"); foundImage = b64 === PNG_B64; }
  }
  ok(foundText, `pptx slide text extracted (heading + bullet)`);
  ok(foundImage, `pptx slide image resolved via rels → media path`);
}

(async () => {
  try {
    await testDocx();
    testXlsx();
    await testPptx();
  } catch (e) {
    console.error("EXCEPTION:", e);
    failures++;
  }
  console.log(failures === 0 ? "\nALL GOOD" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
