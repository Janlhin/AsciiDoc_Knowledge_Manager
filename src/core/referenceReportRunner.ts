/**
 * T-070: runner for the independent reference-check panel (D-15 A).
 *
 * Reads the vault, parses any note whose cached metadata is stale, then hands
 * the notes to the pure `buildReferenceReport` engine. The report is published
 * to `workspace.referenceReport`; the panel reads it. This runner does NOT reuse
 * the doc-audit categories — only the shared Antora descriptor loader.
 */
import { buildAntoraIndex } from "./antora";
import { loadAntoraBaseIndex } from "./docAuditRunner";
import { parseDocument, type MetadataIndex } from "./metadata";
import { buildReferenceReport, type ReferenceReport, type ReferenceReportNote } from "./referenceReport";
import { Store } from "./store";
import type { Vault } from "./vault";

/** One-shot running flag so a second command while scanning returns the
 *  in-flight result instead of launching a second vault scan. Session-only. */
export const referenceReportRunning = new Store<boolean>(false);

export interface ReferenceCheckDeps {
  vault: Vault;
  metadata: MetadataIndex;
  workspace: {
    referenceReport: Store<ReferenceReport | null>;
  };
}

/** Scan the whole vault and publish the three-state reference report. */
export async function runReferenceCheck(deps: ReferenceCheckDeps): Promise<ReferenceReport> {
  const { vault, metadata, workspace } = deps;
  if (referenceReportRunning.get()) {
    const current = workspace.referenceReport.get();
    if (current !== null) return current;
  }
  referenceReportRunning.set(true);
  try {
    const files = vault.getIndexableFiles();
    const notes: ReferenceReportNote[] = await Promise.all(
      files.map(async (f) => {
        const content = await vault.read(f.path);
        const cached = metadata.getMetadata(f.path);
        const meta = cached && cached.contentLength === content.length ? cached : parseDocument(f.path, content);
        return { path: f.path, content, meta };
      }),
    );

    const allPaths = vault.getFiles().map((f) => f.path);
    const descriptors = await loadAntoraBaseIndex(vault, allPaths);
    const antora = buildAntoraIndex(descriptors, allPaths);

    const report = buildReferenceReport(notes, {
      resolveByKind: (link, fromPath) => metadata.resolveByKind(link, fromPath),
      // Resolve against every vault path (attachments included); only the
      // scanned *bodies* stay limited to indexable files.
      files: allPaths,
      antora,
    });
    workspace.referenceReport.set(report);
    return report;
  } finally {
    referenceReportRunning.set(false);
  }
}
