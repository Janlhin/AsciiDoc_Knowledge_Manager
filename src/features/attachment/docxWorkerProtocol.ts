/** Shared wire contract for DOCX conversions; keep both ends type-checked. */
export interface DocxConversionRequest {
  id: number;
  arrayBuffer: ArrayBuffer;
}
