/**
 * T-066: bridge between the app singletons and the pure bilingual-align engine.
 *
 * Owns the only impure step — reading every indexable note from disk — then
 * hands plain text to buildBilingualReport. Takes core objects as explicit
 * parameters (never imports @app) so the layering stays one-way:
 * app/features -> core. Mirrors the docAuditRunner shape.
 */
import { buildBilingualReport, type BilingualReport, type DocInput } from "@core/bilingualAlign";
import { Store } from "@core/store";
import type { Vault } from "@core/vault";
import type { Workspace } from "@core/workspace";

/** True while a vault-wide bilingual scan is in flight (guards double-clicks). */
export const bilingualAlignRunning = new Store<boolean>(false);

export interface BilingualAlignDeps {
  vault: Vault;
  workspace: Workspace;
}

/** Scan the whole vault and publish the report to workspace.bilingualAlignReport. */
export async function runBilingualAlign(deps: BilingualAlignDeps): Promise<BilingualReport> {
  const { vault, workspace } = deps;
  if (bilingualAlignRunning.get()) return workspace.bilingualAlignReport.get()!;
  bilingualAlignRunning.set(true);
  try {
    const files = vault.getIndexableFiles();
    const notes: DocInput[] = await Promise.all(
      files.map(async (f) => ({ path: f.path, content: await vault.read(f.path) })),
    );
    const report = buildBilingualReport(notes);
    workspace.bilingualAlignReport.set(report);
    return report;
  } finally {
    bilingualAlignRunning.set(false);
  }
}
