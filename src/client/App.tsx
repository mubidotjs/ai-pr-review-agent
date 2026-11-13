import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { Review, ReviewInputSnapshot } from '../shared/types';
import demo from './demo-input.json';
import {
  BrowserReviewError,
  ReviewRunner,
  type ResultReply,
} from './review-runner';
import { DiffViewer, FindingCard, Icon } from './components';

const initialDemo = demo as ReviewInputSnapshot;
export default function App() {
  const [url, setUrl] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [jump, setJump] = useState<{ id: number; line?: number }>({ id: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [severity, setSeverity] = useState('all');
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [runner] = useState(() => new ReviewRunner());
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
    runner.cancel();
  }, [runner]);
  const applyResult = useCallback((result: ResultReply) => {
    setReview(result.review);
    setMarkdown(result.markdown);
    setSelectedPath(result.review.files[0]?.path ?? '');
    setSeverity('all');
    const rate = result.review.rateLimit;
    if (rate.remaining === 0 || rate.retryAt)
      setRetryAt(rate.retryAt ?? rate.resetAt ?? null);
  }, []);
  useEffect(() => {
    const own = ++generation.current;
    const service = runner;
    void service
      .run(initialDemo)
      .then((result) => {
        if (own === generation.current) {
          applyResult(result);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (own === generation.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Browser analysis unavailable.',
          );
          setLoading(false);
        }
      });
    return () => {
      invalidate();
    };
  }, [applyResult, invalidate, runner]);
  const file =
    review?.files.find((f) => f.path === selectedPath) ?? review?.files[0];
  async function begin(input: string | ReviewInputSnapshot) {
    const own = ++generation.current;
    setLoading(true);
    setError('');
    setCopied(false);
    setReportOpen(false);
    setReview(null);
    setMarkdown('');
    try {
      const result = await runner.run(input);
      if (own === generation.current) applyResult(result);
    } catch (cause) {
      if (own !== generation.current) return;
      if (cause instanceof BrowserReviewError && cause.retryAt)
        setRetryAt(cause.retryAt);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Browser analysis unavailable.',
      );
    } finally {
      if (own === generation.current) setLoading(false);
    }
  }
  function loadDemo() {
    void begin(initialDemo);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (retryAt && Date.now() < retryAt * 1000) {
      setError(
        `GitHub cooldown active until ${new Date(retryAt * 1000).toLocaleString()}. Retry manually afterwards.`,
      );
      return;
    }
    void begin(url);
  }
  function cancel() {
    generation.current++;
    runner.cancel();
    setLoading(false);
    setError('Review cancelled. No automatic retry will run.');
  }
  async function copy() {
    if (!review) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      setReportOpen(true);
      setCopied(false);
    }
  }
  const visibleFindings =
    review?.findings.filter(
      (f) => severity === 'all' || f.severity === severity,
    ) ?? [];
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#main" aria-label="PRISM home">
            <span className="brand-mark">◈</span>PRISM
            <span className="brand-divider" />{' '}
            <span className="brand-caption">PR review workspace</span>
          </a>
          <div className="header-right">
            <span className="local-badge">
              <span />
              Local MVP
            </span>
            <span className="header-version">v0.2</span>
            <a
              href="https://github.com/mubidotjs/ai-pr-review-agent"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Project on GitHub"
            >
              <Icon name="external" />
            </a>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="intro">
          <div>
            <div className="eyebrow">EVIDENCE FIRST. HUMAN REVIEW ALWAYS.</div>
            <h1>
              A second look.
              <br className="mobile-break" /> A clearer review.
            </h1>
            <p>
              Inspect the changes. Surface actionable risks. Know what’s still
              unknown.
            </p>
          </div>
          <div className="trust-note">
            <Icon name="shield" size={22} />
            <span>
              Read-only GitHub access
              <br />
              <strong>Your review stays in this session.</strong>
            </span>
          </div>
        </section>
        <section className="ingest-card" aria-label="Load a pull request">
          <form onSubmit={submit}>
            <label htmlFor="pr-url">Public pull request URL</label>
            <div className="input-row">
              <div className="url-field">
                <Icon name="branch" />
                <input
                  id="pr-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/pull/123"
                  required
                  maxLength={2048}
                  disabled={loading}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <button
                className="primary-button"
                disabled={loading}
                type="submit"
              >
                {loading ? 'Investigating…' : 'Review pull request'}
                {loading ? <span className="spinner" /> : <Icon name="arrow" />}
              </button>
              {loading ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={cancel}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
          <div className="input-hint">
            <span>
              Public repositories only · No sign-in · No automatic comments
            </span>
            <button type="button" className="text-button" onClick={loadDemo}>
              Explore synthetic demo <span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>
        <div className="ai-banner">
          <div>
            <span className="ai-symbol">✳</span>
            <strong>AI is disabled</strong>
            <span>
              Reviews use three deterministic rules. No model calls, no
              generated AI claims.
            </span>
          </div>
          <span className="outline-tag">DETERMINISTIC MODE</span>
        </div>
        <div role="status" className="sr-only">
          {loading
            ? 'Loading pull request and validating evidence.'
            : copied
              ? 'Markdown report copied.'
              : ''}
        </div>
        {error ? (
          <div className="error-banner" role="alert">
            <strong>Review unavailable</strong>
            <p>{error}</p>
            {retryAt ? (
              <p>
                Cooldown: {new Date(retryAt * 1000).toLocaleString()}. No
                automatic retries.
              </p>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <section className="loading-panel">
            <span className="spinner" />
            <h2>Building an evidence-grounded review</h2>
            <p>
              Fetching a bounded snapshot, mapping changed lines, and checking
              pinned source.
            </p>
            <p>Up to 12 GitHub requests · 30-second wall-time budget</p>
          </section>
        ) : null}
        {review ? (
          <>
            <section className="pr-summary">
              <div className="pr-title-row">
                <div className="pr-identity">
                  <div className="repo-path">
                    <Icon name="branch" />
                    <span>
                      {review.pr.owner} / <strong>{review.pr.repo}</strong>
                    </span>
                    <span className="pr-number">#{review.pr.number}</span>
                    {review.synthetic ? (
                      <span className="demo-badge">SYNTHETIC DEMO</span>
                    ) : null}
                  </div>
                  <h2>{review.pr.title}</h2>
                  <div className="pr-byline">
                    <span className="pr-state">{review.pr.state}</span>
                    <span>by {review.pr.author}</span>
                    <span className="mono">
                      {review.pr.baseSha.slice(0, 7)} →{' '}
                      {review.pr.headSha.slice(0, 7)}
                    </span>
                    {!review.synthetic ? (
                      <a
                        href={review.pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View PR <Icon name="external" size={12} />
                      </a>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary-button report-button"
                  onClick={copy}
                >
                  <Icon name={copied ? 'check' : 'copy'} />
                  {copied ? 'Copied Markdown' : 'Copy Markdown'}
                </button>
              </div>
              <div className="stats-grid">
                <div>
                  <span className="stat-value">
                    {review.coverage.total}
                    <small>files changed</small>
                  </span>
                  <span className="stat-caption">
                    +{review.pr.additions} / −{review.pr.deletions} lines
                  </span>
                </div>
                <div>
                  <span className="stat-value">
                    {review.findings.length}
                    <small>rule findings</small>
                  </span>
                  <span className="stat-caption">Human review required</span>
                </div>
                <div>
                  <span className="stat-value">
                    {review.coverage.analyzed}
                    <small>files analyzed</small>
                  </span>
                  <span className="stat-caption">
                    {review.coverage.inventoried} inventoried ·{' '}
                    {review.coverage.skipped} skipped ·{' '}
                    {review.coverage.uninventoried} uninventoried
                  </span>
                </div>
                <div>
                  <span className="coverage-status">
                    <span />
                    {review.status === 'partial'
                      ? 'Partial coverage'
                      : 'Available rules completed'}
                  </span>
                  <span className="stat-caption">
                    {review.snapshotVerified
                      ? 'Pinned snapshot verified'
                      : 'Snapshot verification incomplete'}
                  </span>
                </div>
              </div>
              <details className="description">
                <summary>PR description & review limitations</summary>
                <p className="plain-description">
                  {review.pr.description || 'No description provided.'}
                </p>
                {review.notices.map((notice, i) => (
                  <p key={i}>{notice}</p>
                ))}
                <p>
                  Analyzed means the available rules completed. It is not a
                  comprehensive code or security review.
                </p>
              </details>
            </section>
            <div className="workspace-heading">
              <h3>Review workspace</h3>
              <span>
                <span className="status-dot analyzed" />
                Evidence linked to added lines
              </span>
            </div>
            <div className="workspace">
              <aside className="file-sidebar">
                <div className="sidebar-title">
                  <h3>Changed files</h3>
                  <span>{review.coverage.inventoried}</span>
                </div>
                <nav aria-label="Changed files">
                  {review.files.map((f) => {
                    const count = review.findings.filter(
                      (finding) => finding.path === f.path,
                    ).length;
                    return (
                      <button
                        type="button"
                        className={`file-button${f.path === file?.path ? ' active' : ''}`}
                        key={f.path}
                        onClick={() => {
                          setSelectedPath(f.path);
                          setJump((j) => ({ id: j.id + 1 }));
                        }}
                        aria-pressed={f.path === file?.path}
                      >
                        <Icon name="file" size={16} />
                        <span>
                          <span className="file-basename">
                            {f.path.split('/').at(-1)}
                          </span>
                          <span className="file-directory">
                            {f.path.includes('/')
                              ? f.path.slice(0, f.path.lastIndexOf('/'))
                              : '/'}
                          </span>
                        </span>
                        {count ? (
                          <span className="file-finding-count">{count}</span>
                        ) : (
                          <span className={`file-status ${f.reviewStatus}`}>
                            {f.reviewStatus === 'analyzed' ? '✓' : '—'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
                <div className="sidebar-note">
                  <Icon name="shield" size={17} />
                  <p>
                    Unreviewed files have
                    <br />
                    <strong>no safety assessment.</strong>
                  </p>
                </div>
              </aside>
              <div className="diff-column">
                {file ? (
                  <DiffViewer
                    key={`${file.path}:${jump.id}`}
                    focusLine={jump.line}
                    file={file}
                    findings={review.findings}
                    synthetic={review.synthetic}
                  />
                ) : (
                  <div className="empty-state">
                    No files could be inventoried. See review limitations.
                  </div>
                )}
                <div className="evidence-note">
                  <Icon name="check" size={16} />
                  <p>
                    Findings require exact added-line evidence and source pinned
                    to the head commit. Unchanged code is never presented as a
                    modified line.
                  </p>
                </div>
              </div>
              <aside className="findings-panel" aria-label="Review findings">
                <div className="sidebar-title">
                  <h3>Findings</h3>
                  <span>{review.findings.length}</span>
                </div>
                <label className="filter-label" htmlFor="severity">
                  Filter by severity
                  <select
                    id="severity"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                  >
                    <option value="all">All severities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                {(['high', 'medium', 'low'] as const).map((level) => {
                  const group = visibleFindings.filter(
                    (f) => f.severity === level,
                  );
                  return group.length ? (
                    <section key={level} className="severity-group">
                      <h3>
                        {level} <span>{group.length}</span>
                      </h3>
                      {group.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          selected={file?.path === finding.path}
                          onSelect={() => {
                            setSelectedPath(finding.path);
                            setJump((j) => ({
                              id: j.id + 1,
                              line: finding.line,
                            }));
                            requestAnimationFrame(() =>
                              document
                                .getElementById(`line-${finding.line}`)
                                ?.scrollIntoView({
                                  block: 'nearest',
                                  behavior: 'smooth',
                                }),
                            );
                          }}
                          synthetic={review.synthetic}
                        />
                      ))}
                    </section>
                  ) : null;
                })}
                {!visibleFindings.length ? (
                  <div className="empty-state">
                    <Icon name="shield" size={26} />
                    <h4>No findings from these rules</h4>
                    <p>
                      This does not establish safety. Review skipped and
                      uninventoried files manually.
                    </p>
                  </div>
                ) : null}
              </aside>
            </div>
            <div className="review-disclaimer">
              <Icon name="shield" />
              <p>
                <strong>Evidence helps. Judgment decides.</strong> Browser
                Worker findings have no server attestation. This limited review
                is not a security clearance. Zero findings does not mean the
                code is safe.
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => setReportOpen(!reportOpen)}
              >
                {reportOpen ? 'Hide report' : 'View Markdown'}
              </button>
            </div>
            {reportOpen ? (
              <section className="report-preview">
                <label htmlFor="markdown-report">
                  Markdown report · select and copy if clipboard access is
                  unavailable
                </label>
                <textarea
                  id="markdown-report"
                  readOnly
                  value={markdown}
                  rows={15}
                />
              </section>
            ) : null}
            <div className="budget-note">
              {review.synthetic
                ? 'Demo uses no API requests.'
                : `${review.budget.requests}/12 GitHub requests · ${(review.budget.bytes / 1024).toFixed(1)} KiB received · ${(review.budget.durationMs / 1000).toFixed(1)} s ingestion.`}{' '}
              Unauthenticated GitHub access shares 60 requests/hour per
              originating IP.
              {review.rateLimit.remaining !== undefined
                ? ` Last reported remaining: ${review.rateLimit.remaining}.`
                : ''}
            </div>
          </>
        ) : null}
        <footer>
          <span className="footer-brand">◈ PRISM</span>
          <span>AI PR Review Agent · Built by mubidotjs</span>
          <span>Read only. Human controlled.</span>
        </footer>
      </main>
    </>
  );
}
