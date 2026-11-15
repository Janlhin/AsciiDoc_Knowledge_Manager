/**
 * T-046: bridge between the app singletons and the pure audit engine.
 *
 * Owns the only impure step — reading every indexable note from disk — then
 * hands plain data to auditVault. Takes core objects as explicit parameters
 * (never imports @app) so the layering stays one-way: app/features -> core.
 * Both the command and the "re-run" button call this one implementation.
 */
import { auditVault, type AuditNoteInput, type AuditReport } from "@core/docAudit";
import { buildAntoraIndex, listComponentVersions, parseAntoraYml, withActiveVersion, type AntoraComponent } from "@core/antora";
import { parseDocument, type MetadataIndex } from "@core/metadata";
import { Store } from "@core/store";
import type { Vault } from "@core/vault";
import type { Workspace } from "@core/workspace";

/** True while a vault-wide scan is in flight (guards double-clicks). */
export const docAuditRunning = new Store<boolean>(false);

export interface AntoraActiveVersion {
  readonly component: string;
  readonly version: string;
}

/** Session-level version pin; null = infer from the current file (T-045 slice 3). */
export const docAuditActiveVersion = new Store<AntoraActiveVersion | null>(null);

export interface DocAuditDeps {
  vault: Vault;
  metadata: MetadataIndex;
  workspace: Workspace;
}

/** Scan the whole vault and publish the report to workspace.docAuditReport.
 *  `active` pins one Antora component version; omit to keep the previous pin,
 *  pass null to return to automatic (current-file) resolution. */
export async function runDocAudit(
  deps: DocAuditDeps,
  active?: AntoraActiveVersion | null,
): Promise<AuditReport> {
  const { vault, metadata, workspace } = deps;
  if (active !== undefined) docAuditActiveVersion.set(active);
  const selected = docAuditActiveVersion.get();
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
    const allPaths = vault.getFiles().map((f) => f.path);
    const descriptors: AntoraComponent[] = [];
    for (const descriptorPath of allPaths.filter((p) => /(^|\/)antora\.ya?ml$/i.test(p))) {
      try {
        const parsed = parseAntoraYml(await vault.read(descriptorPath), descriptorPath);
        if (parsed !== null) descriptors.push(parsed);
      } catch {
        // An unreadable descriptor is skipped, never guessed. The audit then
        // falls back to the slice-1 plain-AsciiDoc rules for this vault.
      }
    }
    const baseAntora = buildAntoraIndex(descriptors, allPaths);
    const antora = selected === null
      ? baseAntora
      : withActiveVersion(baseAntora, selected.component, selected.version);

    const report = auditVault(notes, {
      resolveLink: (target, fromPath) => metadata.resolveLink(target, fromPath),
      antora,
    });
    const withVersions: AuditReport = {
      ...report,
      antoraVersions: listComponentVersions(baseAntora),
    };
    workspace.docAuditReport.set(withVersions);
    return withVersions;
  } finally {
    docAuditRunning.set(false);
  }
}
