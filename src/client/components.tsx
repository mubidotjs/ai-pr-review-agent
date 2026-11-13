import type { Finding, ReviewFile } from '../shared/types';

export function Icon({
  name,
  size = 18,
}: {
  name: 'branch' | 'arrow' | 'file' | 'copy' | 'check' | 'shield' | 'external';
  size?: number;
}) {
  const paths = {
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="6" r="2" />
        <path d="M6 7v10M18 8c0 7-12 3-12 9" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    file: (
      <>
        <path d="M13 3H5v18h14V9z" />
        <path d="M13 3v6h6M8 13h8M8 17h5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7m0-7L10 14M10 5H4v15h15v-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function DiffViewer({
  file,
  findings,
  synthetic,
}: {
  file: ReviewFile;
  findings: Finding[];
  synthetic?: boolean;
}) {
  const marked = new Set(
    findings.filter((f) => f.path === file.path).map((f) => f.line),
  );
  return (
    <section className="diff-panel" aria-label="File diff">
      <div className="panel-heading">
        <div>
          <Icon name="file" />
          <span className="mono">{file.path}</span>
        </div>
        <span className="change-count">
          <b>+{file.additions}</b> <i>−{file.deletions}</i>
          {!synthetic && file.githubUrl ? (
            <a
              className="file-github-link"
              href={file.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub file view"
            >
              <Icon name="external" size={13} />
            </a>
          ) : null}
        </span>
      </div>
      <div className="file-state">
        <span className={`status-dot ${file.reviewStatus}`} />
        {file.reviewStatus === 'analyzed'
          ? 'Available rules completed'
          : (file.reason ?? 'Unreviewed')}
        <span>{file.status}</span>
      </div>
      {file.rows.length ? (
        <div
          className="diff-scroll"
          tabIndex={0}
          aria-label="Scrollable code diff"
        >
          <table className="diff-table">
            <caption className="sr-only">
              Unified diff with old and new line numbers. Only added lines can
              support findings.
            </caption>
            <thead className="sr-only">
              <tr>
                <th>Old line</th>
                <th>New line</th>
                <th>Change</th>
                <th>Code</th>
              </tr>
            </thead>
            <tbody>
              {file.rows.map((row, index) => (
                <tr
                  key={index}
                  id={row.newLine ? `line-${row.newLine}` : undefined}
                  className={`${row.kind}${row.kind === 'add' && row.newLine && marked.has(row.newLine) ? ' marked' : ''}`}
                >
                  <td className="line-number">{row.oldLine}</td>
                  <td className="line-number">{row.newLine}</td>
                  <td className="diff-sign">
                    {row.kind === 'add'
                      ? '+'
                      : row.kind === 'delete'
                        ? '−'
                        : ''}
                  </td>
                  <td>
                    <code>{row.text || ' '}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="unavailable">
          <Icon name="file" size={28} />
          <strong>Diff unavailable for analysis</strong>
          <p>{file.reason}</p>
          <p>This file has no safety assessment.</p>
        </div>
      )}
      <div className="diff-footer">
        <span className="legend-add" /> Added <span className="legend-delete" />{' '}
        Removed <span className="legend-finding" /> Finding on an added line{' '}
        {synthetic ? (
          <span className="synthetic-label">Synthetic source</span>
        ) : null}
      </div>
    </section>
  );
}
export function FindingCard({
  finding,
  selected,
  onSelect,
  synthetic,
}: {
  finding: Finding;
  selected: boolean;
  onSelect: () => void;
  synthetic?: boolean;
}) {
  return (
    <article className={`finding-card${selected ? ' selected' : ''}`}>
      <div className="finding-label">
        <span className={`severity ${finding.severity}`}>
          {finding.severity}
        </span>
        <span>
          {finding.source === 'deterministic'
            ? 'Deterministic rule'
            : 'AI suggestion'}
        </span>
      </div>
      <h4>
        <button type="button" onClick={onSelect}>
          {finding.title}
        </button>
      </h4>
      <button
        className="source-coordinate mono"
        type="button"
        onClick={onSelect}
      >
        {finding.path}:{finding.line}
      </button>
      <p>{finding.explanation}</p>
      <div className="recommendation">
        <Icon name="arrow" size={15} />
        <p>{finding.recommendation}</p>
      </div>
      <details>
        <summary>View exact evidence</summary>
        <pre>{finding.evidence}</pre>
      </details>
      {synthetic ? (
        <span className="synthetic-label">
          Illustrative source · fictional PR
        </span>
      ) : (
        <a
          className="source-link"
          href={finding.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Pinned GitHub source <Icon name="external" size={13} />
        </a>
      )}
    </article>
  );
}
