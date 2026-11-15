/**
 * T-047: bridge between the app singletons and the pure proofreading module.
 *
 * Owns the impure steps — resolve the active note, read it, run the T-046 rules
 * for deterministic findings — then hands plain data to the prompt builder and
 * publishes a one-shot panel request. Takes core objects as parameters (never
 * imports @app) so the layering stays one-way: app/features -> core.
 *
 * The same entry point serves the command palette and the AI panel button, so
 * the two can never drift.
 */
import { auditNote, type AuditIssue } from "@core/docAudit";
import { parseDocument, type MetadataIndex } from "@core/metadata";
import { requestSettingsSection } from "@core/settingsNav";
import type { Vault } from "@core/vault";
import type { Workspace } from "@core/workspace";
import { buildProofreadPrompt, PROOFREAD_MAX_CHARS } from "./proofread";
import { requestLlmTurn } from "./request";
import { activeLlmProviderId, isProviderUsable, llmProviders, resolveActiveProvider } from "./store";

/** Notes above this size are not read for a model at all (panel uses the same guard). */
export const PROOFREAD_MAX_SOURCE = 2_000_000;

export type ProofreadStart =
  | { status: "started"; path: string; findings: number; truncated: boolean }
  | { status: "no-note" }
  | { status: "empty-note"; path: string }
  | { status: "too-large"; path: string; length: number }
  | { status: "no-provider" };

export interface ProofreadDeps {
  vault: Vault;
  metadata: MetadataIndex;
  workspace: Workspace;
  locale: "en" | "zh";
}

/** Send one proofreading turn to the AI panel. */
export async function startProofread(deps: ProofreadDeps): Promise<ProofreadStart> {
  const { vault, metadata, workspace, locale } = deps;

  // Prefer the focused editor tab; fall back to the last note when a singleton
  // view (graph / audit) holds focus, so the one-shot action still has a target.
  const path = workspace.getActiveFile() ?? workspace.lastActiveFile.get();
  if (path === null) return { status: "no-note" };

  const knownLength = metadata.getMetadata(path)?.contentLength ?? 0;
  if (knownLength > PROOFREAD_MAX_SOURCE) {
    return { status: "too-large", path, length: knownLength };
  }

  const cached = vault.readCached(path);
  let content: string;
  if (cached !== undefined) {
    content = cached;
  } else {
    try {
      content = await vault.read(path);
    } catch {
      // Deleted / moved since the tab was opened.
      return { status: "no-note" };
    }
  }
  if (content.length > PROOFREAD_MAX_SOURCE) {
    return { status: "too-large", path, length: content.length };
  }
  if (content === "") return { status: "empty-note", path };

  const provider = resolveActiveProvider(llmProviders.get(), activeLlmProviderId.get());
  if (provider === null || !isProviderUsable(provider)) {
    // Land the user on the fix instead of a dead-end notice.
    requestSettingsSection("ai");
    workspace.openModal("settings");
    return { status: "no-provider" };
  }

  const meta = metadata.getMetadata(path);
  const fresh = meta !== undefined && meta.contentLength === content.length
    ? meta
    : parseDocument(path, content);
  let findings: AuditIssue[] = [];
  try {
    findings = auditNote(
      { path, content, meta: fresh },
      {
        resolveLink: (target, fromPath) => metadata.resolveLink(target, fromPath),
        // T-045: xref / include checks need the vault's path list; without it
        // those two categories are silently skipped (see AuditEnv.files).
        files: vault.getIndexableFiles().map((f) => f.path),
      },
    );
  } catch {
    // A parser edge case must not block the AI turn; findings are only context.
    findings = [];
  }

  const prompt = buildProofreadPrompt({ path, content, findings, locale });
  requestLlmTurn({
    display: prompt.display,
    messages: prompt.messages,
    proofread: { path, content, truncated: content.length > PROOFREAD_MAX_CHARS },
  });
  workspace.setRightPanel("ai");
  return { status: "started", path, findings: findings.length, truncated: prompt.truncated };
}
