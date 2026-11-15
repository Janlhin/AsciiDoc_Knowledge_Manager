/**
 * T-046: bridge between the app singletons and the pure audit engine.
 *
 * Owns the only impure step — reading every indexable note from disk — then
 * hands plain data to auditVault. Takes core objects as explicit parameters
 * (never imports @app) so the layering stays one-way: app/features -> core.
 * Both the command and the "re-run" button call this one implementation.
 */
import { auditVault, type AuditNoteInput, type AuditReport } from "@core/docAudit";
import { parseDocument, type MetadataIndex } from "@core/metadata";
import { Store } from "@core/store";
import type { Vault } from "@core/vault";
import type { Workspace } from "@core/workspace";

/** True while a vault-wide scan is in flight (guards double-clicks). */
export const docAuditRunning = new Store<boolean>(false);

export interface DocAuditDeps {
  vault: Vault;
  metadata: MetadataIndex;
  workspace: Workspace;
}

/** Scan the whole vault and publish the report to workspace.docAuditReport. */
export async function runDocAudit(deps: DocAuditDeps): Promise<AuditReport> {
  const { vault, metadata, workspace } = deps;
  if (docAuditRunning.get()) return workspace.docAuditReport.get()!;
  docAuditRunning.set(true);
  try {
    const files = vault.getIndexableFiles();
    const notes: AuditNoteInput[] = await Promise.all(
      files.map(async (f) => {
        const content = await vault.read(f.path);
        const meta = metadata.getMetadata(f.path);
        return {
          path: f.path,
          content,
          // Metadata may lag a just-saved file; parse fresh so the audit is
          // never a no-op merely because indexing has not caught up.
          meta: meta && meta.contentLength === content.length
            ? meta
            : parseDocument(f.path, content),
        };
      }),
    );
    const report = auditVault(notes, {
      resolveLink: (target, fromPath) => metadata.resolveLink(target, fromPath),
    });
    workspace.docAuditReport.set(report);
    return report;
  } finally {
    docAuditRunning.set(false);
  }
}
