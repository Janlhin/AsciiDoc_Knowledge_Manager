/**
 * T-070: three-state reference check results, as a main-area singleton view
 * (D-15 A). The report itself is computed by the tools:reference-check command
 * (which owns the vault + metadata singletons) and stored on
 * workspace.referenceReport. This component only renders + filters + jumps, so
 * it stays a pure consumer. It does NOT reuse the doc-audit categories.
 */
import { useMemo, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { runReferenceCheck } from "@core/referenceReportRunner";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import type { ReferenceEntry, RefFormat } from "@core/referenceReport";
import "./refcheck.scss";

type StatusFilter = "all" | "broken" | "unresolved";
type FormatFilter = "all" | RefFormat;

function shortPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function RefCheckView() {
  const app = useApp();
  const t = useI18n();
  const report = useStore(app.workspace.referenceReport);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");

  const flagged = useMemo(
    () => (report ? report.entries.filter((e) => e.status !== "resolved") : []),
    [report],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<"broken" | "unresolved", number> = { broken: 0, unresolved: 0 };
    for (const e of flagged) {
      if (e.status !== "resolved") counts[e.status] += 1;
    }
    return counts;
  }, [flagged]);

  const formatCounts = useMemo(() => {
    const counts: Record<RefFormat, number> = { md: 0, adoc: 0, txt: 0 };
    for (const e of flagged) counts[formatOf(e.path)] += 1;
    return counts;
  }, [flagged]);

  const issues = useMemo(() => {
    return flagged.filter(
      (e) =>
        (statusFilter === "all" || e.status === statusFilter) &&
        (formatFilter === "all" || formatOf(e.path) === formatFilter),
    );
  }, [flagged, statusFilter, formatFilter]);

  const jump = (it: ReferenceEntry) => {
    app.workspace.openFile(it.path);
    app.workspace.revealTarget.set({ path: it.path, from: it.from, to: it.to });
  };

  const statusChip = (value: Exclude<StatusFilter, "all">, label: string, n: number) => (
    <button
      role="tab"
      aria-selected={statusFilter === value}
      className={`refcheck-chip${statusFilter === value ? " is-active" : ""}${n === 0 ? " is-zero" : ""}`}
      onClick={() => setStatusFilter(value)}
    >
      {label} <span className="refcheck-chip-n">{n}</span>
    </button>
  );

  const formatChip = (value: RefFormat, label: string, n: number) => (
    <button
      role="tab"
      aria-selected={formatFilter === value}
      className={`refcheck-chip${formatFilter === value ? " is-active" : ""}${n === 0 ? " is-zero" : ""}`}
      onClick={() => setFormatFilter(value)}
    >
      {label} <span className="refcheck-chip-n">{n}</span>
    </button>
  );

  return (
    <div className="refcheck-view markdown-reading-view" data-testid="refcheck-view">
      <header className="refcheck-header">
        <div className="refcheck-heading">
          <h2>{t("refcheck.title")}</h2>
          {report && <span className="refcheck-subtitle">{t("refcheck.subtitle", { n: report.filesScanned })}</span>}
        </div>
        <button className="refcheck-run" data-testid="refcheck-run" onClick={() => void runReferenceCheck(app)}>
          <Icon name="list" size={14} />
          <span>{t(report ? "refcheck.rerun" : "refcheck.run")}</span>
        </button>
      </header>

      {report && (
        <div className="refcheck-filters" role="tablist">
          <button
            role="tab"
            aria-selected={statusFilter === "all"}
            className={`refcheck-chip${statusFilter === "all" ? " is-active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            {t("refcheck.all")} <span className="refcheck-chip-n">{flagged.length}</span>
          </button>
          {statusChip("broken", t("refcheck.status.broken"), statusCounts.broken)}
          {statusChip("unresolved", t("refcheck.status.unresolved"), statusCounts.unresolved)}
          <span className="refcheck-filter-sep" />
          {formatChip("md", t("refcheck.format.md"), formatCounts.md)}
          {formatChip("adoc", t("refcheck.format.adoc"), formatCounts.adoc)}
          {formatChip("txt", t("refcheck.format.txt"), formatCounts.txt)}
        </div>
      )}

      <div className="refcheck-body" data-testid="refcheck-results">
        {!report ? (
          <div className="refcheck-empty">{t("refcheck.notrun")}</div>
        ) : issues.length === 0 ? (
          <div className="refcheck-empty refcheck-ok" data-testid="refcheck-clean">
            <Icon name="file-text" size={22} />
            {t("refcheck.empty")}
          </div>
        ) : (
          <ul className="refcheck-list">
            {issues.map((it, i) => (
              <li key={`${it.path}:${it.from}:${i}`} className={`refcheck-item refcheck-${it.status}`}>
                <button className="refcheck-jump" onClick={() => jump(it)}
                  data-testid="refcheck-entry" title={t("refcheck.jump", { n: it.sourceLine })}>
                  <span className={`refcheck-dot ${it.status}`} />
                  <span className="refcheck-item-head">
                    <span className="refcheck-path" title={it.path}>{shortPath(it.path)}</span>
                    <span className="refcheck-line">:{it.sourceLine}</span>
                    <span className={`refcheck-status ${it.status}`}>{t(`refcheck.status.${it.status}` as Parameters<typeof t>[0])}</span>
                    <span className="refcheck-target">{it.target}</span>
                  </span>
                  <span className="refcheck-msg">{t(`refcheck.reason.${it.reason}` as Parameters<typeof t>[0])}</span>
                  {it.excerpt && <span className="refcheck-excerpt">{it.excerpt}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatOf(path: string): RefFormat {
  if (path.endsWith(".adoc")) return "adoc";
  if (path.endsWith(".txt")) return "txt";
  return "md";
}
