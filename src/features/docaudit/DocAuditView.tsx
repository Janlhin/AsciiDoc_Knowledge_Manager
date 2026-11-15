/**
 * T-046: document convention audit results, as a main-area singleton view.
 *
 * The report itself is computed by the tools:doc-audit command (which owns the
 * vault + metadata singletons) and stored on workspace.docAuditReport. This
 * component only renders + filters + jumps, so it stays a pure consumer.
 */
import { useMemo, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { runDocAudit, docAuditActiveVersion } from "@core/docAuditRunner";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import {
  AUDIT_CATEGORIES, AUDIT_RULE_DOCS, SEVERITY_ORDER,
  type AuditCategory, type AuditIssue, type AuditSeverity,
} from "@core/docAudit";
import "./docaudit.scss";

function shortPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function DocAuditView() {
  const app = useApp();
  const t = useI18n();
  const report = useStore(app.workspace.docAuditReport);
  const pinned = useStore(docAuditActiveVersion);
  const versions = report?.antoraVersions ?? [];
  const [filter, setFilter] = useState<AuditCategory | "all">("all");

  const issues = useMemo(() => {
    if (!report) return [];
    const list = report.issues.filter((it) => filter === "all" || it.category === filter);
    return [...list].sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) || a.line - b.line);
  }, [report, filter]);

  const jump = (it: AuditIssue) => {
    app.workspace.openFile(it.path);
    app.workspace.revealTarget.set({ path: it.path, from: it.from, to: it.from + 1 });
  };

  const countBadge = (sev: AuditSeverity, n: number) =>
    n > 0 ? <span className={`docaudit-badge sev-${sev}`}>{n}</span> : null;

  return (
    <div className="docaudit-view markdown-reading-view" data-testid="doc-audit-view">
      <header className="docaudit-header">
        <div className="docaudit-heading">
          <h2>{t("docaudit.title")}</h2>
          {report && <span className="docaudit-subtitle">{t("docaudit.subtitle", { n: report.filesScanned })}</span>}
        </div>
        <div className="docaudit-sev-summary">
          {report && <>
            {countBadge("error", report.bySeverity.error)}
            {countBadge("warning", report.bySeverity.warning)}
            {countBadge("info", report.bySeverity.info)}
          </>}
        </div>
        {versions.length > 0 && (
          <div className="docaudit-version" data-testid="doc-audit-version-wrap">
            <label htmlFor="docaudit-version-select">{t("docaudit.antoraVersion")}</label>
            <select
              id="docaudit-version-select"
              data-testid="doc-audit-version"
              value={pinned ? `${pinned.component}\u0000${pinned.version}` : ""}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "") { void runDocAudit(app, null); return; }
                const [component, version] = value.split("\u0000");
                void runDocAudit(app, { component, version });
              }}
            >
              <option value="">{t("docaudit.antoraAuto")}</option>
              {versions.map((v) => {
                const value = `${v.component}\u0000${v.version}`;
                return (
                  <option key={value} value={value} data-testid="doc-audit-version-option">
                    {v.component} {v.version || t("docaudit.antoraUnversioned")} ({v.files})
                  </option>
                );
              })}
            </select>
          </div>
        )}
        <button className="docaudit-run" data-testid="doc-audit-run" onClick={() => void runDocAudit(app)}>
          <Icon name="list" size={14} />
          <span>{t(report ? "docaudit.rerun" : "docaudit.run")}</span>
        </button>
      </header>

      {report && (
        <div className="docaudit-filters" role="tablist">
          <button role="tab" aria-selected={filter === "all"}
            className={`docaudit-chip${filter === "all" ? " is-active" : ""}`}
            onClick={() => setFilter("all")}>
            {t("docaudit.all")} <span className="docaudit-chip-n">{report.issues.length}</span>
          </button>
          {AUDIT_CATEGORIES.map((cat) => {
            const n = report.byCategory[cat];
            const rule = AUDIT_RULE_DOCS.find((r) => r.category === cat);
            return (
              <button key={cat} role="tab" aria-selected={filter === cat}
                title={rule?.criteria}
                className={`docaudit-chip${filter === cat ? " is-active" : ""}${n === 0 ? " is-zero" : ""}`}
                onClick={() => setFilter(cat)}>
                {t(`docaudit.cat.${cat}` as Parameters<typeof t>[0])} <span className="docaudit-chip-n">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="docaudit-body" data-testid="doc-audit-results">
        {!report ? (
          <div className="docaudit-empty">{t("docaudit.notrun")}</div>
        ) : issues.length === 0 ? (
          <div className="docaudit-empty docaudit-ok" data-testid="doc-audit-clean">
            <Icon name="file-text" size={22} />
            {t("docaudit.empty")}
          </div>
        ) : (
          <ul className="docaudit-list">
            {issues.map((it, i) => (
              <li key={`${it.path}:${it.from}:${i}`} className={`docaudit-item sev-${it.severity}`}>
                <button className="docaudit-jump" onClick={() => jump(it)}
                  data-testid="doc-audit-issue" title={t("docaudit.jump", { n: it.line })}>
                  <span className={`docaudit-dot sev-${it.severity}`} />
                  <span className="docaudit-item-head">
                    <span className="docaudit-path" title={it.path}>{shortPath(it.path)}</span>
                    <span className="docaudit-line">:{it.line}</span>
                    <span className="docaudit-sev">{t(`docaudit.sev.${it.severity}` as Parameters<typeof t>[0])}</span>
                    <span className="docaudit-cat">{t(`docaudit.cat.${it.category}` as Parameters<typeof t>[0])}</span>
                  </span>
                  <span className="docaudit-msg">{it.message}</span>
                  {it.excerpt && <span className="docaudit-excerpt">{it.excerpt}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
