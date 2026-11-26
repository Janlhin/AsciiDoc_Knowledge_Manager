/**
 * T-066: bilingual alignment results, as a main-area singleton view.
 *
 * The report itself is computed by the tools:bilingual-align command (which
 * owns the vault singleton) and stored on workspace.bilingualAlignReport. This
 * component only renders the side-by-side section tree and jumps, so it stays
 * a pure consumer. Jumping reuses the existing openFile + revealTarget
 * one-shot mechanism — no second navigation path is invented here.
 */
import { useMemo } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { runBilingualAlign } from "@core/bilingualAlignRunner";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import type { PairReport, StructureRow, DocDigest } from "@core/bilingualAlign";
import "./bilingualalign.scss";

function shortPath(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Heading button on one side of the pair. Click opens the file and reveals
 *  the heading offset via the shared revealTarget one-shot store. */
function SideHeading(props: {
  digest: DocDigest;
  heading: DocDigest["headings"][number] | null;
  side: "base" | "translation";
  status: StructureRow["status"];
  onJump: (path: string, from: number) => void;
  t: ReturnType<typeof useI18n>;
}) {
  const { digest, heading, side, status, onJump, t } = props;
  if (heading === null) {
    const missing = status === "missing-left" && side === "base"
      || status === "missing-right" && side === "translation";
    return (
      <div className={`biling-cell biling-cell-empty${missing ? " is-missing" : ""}`}
        data-testid="biling-missing-slot">
        {missing ? <span className="biling-missing-label">
          {side === "translation" ? t("bilingualalign.missing") : t("bilingualalign.extra")}
        </span> : null}
      </div>
    );
  }
  return (
    <button
      className="biling-cell biling-cell-head"
      style={{ paddingLeft: `${8 + (heading.level - 1) * 14}px` }}
      onClick={() => onJump(digest.path, heading.from)}
      data-testid="biling-heading"
      title={t("bilingualalign.jump", { n: heading.line })}
    >
      <span className="biling-head-text">{heading.text}</span>
      <span className="biling-head-line">:{heading.line}</span>
    </button>
  );
}

function VersionBadge({ report, t }: { report: PairReport; t: ReturnType<typeof useI18n> }) {
  const v = report.version;
  if (v.status === "match") {
    return <span className="biling-badge ok" data-testid="biling-version-ok">{v.base}</span>;
  }
  if (v.status === "mismatch") {
    return <span className="biling-badge bad" data-testid="biling-version-bad">
      {v.base} ≠ {v.translation}
    </span>;
  }
  return <span className="biling-badge muted" data-testid="biling-version-unknown">—</span>;
}

function PairCard({ report, onJump, t }: {
  report: PairReport;
  onJump: (path: string, from: number) => void;
  t: ReturnType<typeof useI18n>;
}) {
  const issueCount = report.issues.length;
  return (
    <article className="biling-pair" data-testid="biling-pair">
      <header className="biling-pair-head">
        <div className="biling-pair-files">
          <span className="biling-file" title={report.base.path}>{shortPath(report.base.path)}</span>
          <Icon name="arrow-right" size={12} />
          <span className="biling-file" title={report.translation.path}>{shortPath(report.translation.path)}</span>
          {report.auxiliary && <span className="biling-tag">{t("bilingualalign.auxiliary")}</span>}
        </div>
        <div className="biling-pair-meta">
          <VersionBadge report={report} t={t} />
          <span className="biling-badge muted" data-testid="biling-lines">
            {t("bilingualalign.lines")}: {report.lines.base} / {report.lines.translation}
            {report.lines.status === "deviation" && ` (${report.lines.diff > 0 ? "+" : ""}${report.lines.diff})`}
          </span>
          {issueCount > 0
            ? <span className="biling-badge bad" data-testid="biling-issues">{t("bilingualalign.issueCount", { n: issueCount })}</span>
            : <span className="biling-badge ok" data-testid="biling-issues-0">{t("bilingualalign.clean")}</span>}
        </div>
      </header>

      {report.issues.length > 0 && (
        <ul className="biling-issue-list">
          {report.issues.map((issue, i) => (
            <li key={i} className={`biling-issue sev-${issue.severity}`}>{issue.message}</li>
          ))}
        </ul>
      )}

      <div className="biling-columns" role="table">
        <div className="biling-col-head">
          <span>{t("bilingualalign.base")}</span>
          <span>{t("bilingualalign.translation")}</span>
        </div>
        {report.structure.map((row, i) => (
          <div className={`biling-row status-${row.status}`} key={i} role="row">
            <SideHeading digest={report.base} heading={row.left} side="base"
              status={row.status} onJump={onJump} t={t} />
            <SideHeading digest={report.translation} heading={row.right} side="translation"
              status={row.status} onJump={onJump} t={t} />
          </div>
        ))}
      </div>
    </article>
  );
}

export function BilingualAlignView() {
  const app = useApp();
  const t = useI18n();
  const report = useStore(app.workspace.bilingualAlignReport);

  const pairs = useMemo(() => report?.pairs ?? [], [report]);

  const jump = (path: string, from: number) => {
    app.workspace.openFile(path);
    app.workspace.revealTarget.set({ path, from, to: from + 1 });
  };

  return (
    <div className="biling-view markdown-reading-view" data-testid="biling-view">
      <header className="biling-header">
        <div className="biling-heading">
          <h2>{t("bilingualalign.title")}</h2>
          {report && <span className="biling-subtitle">{t("bilingualalign.subtitle", { n: pairs.length })}</span>}
        </div>
        <button className="biling-run" data-testid="biling-run" onClick={() => void runBilingualAlign(app)}>
          <Icon name="list-tree" size={14} />
          <span>{t(report ? "bilingualalign.rerun" : "bilingualalign.run")}</span>
        </button>
      </header>

      <div className="biling-body" data-testid="biling-results">
        {!report ? (
          <div className="biling-empty">{t("bilingualalign.notrun")}</div>
        ) : pairs.length === 0 ? (
          <div className="biling-empty" data-testid="biling-empty">{t("bilingualalign.empty")}</div>
        ) : (
          pairs.map((pair) => <PairCard key={`${pair.base.path}::${pair.translation.path}`} report={pair} onJump={jump} t={t} />)
        )}
      </div>
    </div>
  );
}
