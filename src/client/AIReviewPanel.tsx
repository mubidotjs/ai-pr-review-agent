import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgentResult } from '../server/agent/result';

async function api<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `${data?.error?.code ?? 'UNAVAILABLE'}: ${data?.error?.message ?? 'Request refused safely.'}`,
    );
  return data as T;
}
export function AIReviewPanel({ url }: { url: string }) {
  const [code, setCode] = useState(''),
    [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [draft, setDraft] = useState<{
    result: AgentResult;
    digest: string;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]),
    [report, setReport] = useState('');
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const cancel = () => {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setDraft(null);
    setReport('');
    setError(
      'Cancelled. An already dispatched model call may still consume shared quota.',
    );
  };
  async function login(event: FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const abort = new AbortController(),
      own = ++generation.current;
    controller.current = abort;
    setError('');
    setBusy(true);
    try {
      await api('/api/session', { code }, abort.signal);
      if (own === generation.current) setAuthenticated(true);
    } catch (e) {
      if (own === generation.current)
        setError(e instanceof Error ? e.message : 'Access unavailable.');
    } finally {
      setCode('');
      if (own === generation.current) setBusy(false);
    }
  }
  async function run() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const own = ++generation.current;
    setBusy(true);
    setError('');
    setDraft(null);
    setSelected([]);
    setReport('');
    try {
      const value = await api<{ result: AgentResult; digest: string }>(
        '/api/agent',
        { url },
        abort.signal,
      );
      if (own !== generation.current) return;
      setDraft(value);
      setSelected(value.result.findings.map((f) => f.id));
    } catch (e) {
      if (own === generation.current)
        setError(e instanceof Error ? e.message : 'AI review unavailable.');
    } finally {
      if (own === generation.current) setBusy(false);
    }
  }
  async function approve() {
    if (!draft) return;
    controller.current?.abort();
    const abort = new AbortController(),
      own = ++generation.current;
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const approved = await api<{ markdown: string }>(
        '/api/agent/approve',
        {
          actor: 'human',
          confirm: true,
          runId: draft.result.runId,
          digest: draft.digest,
          selectedIndexes: draft.result.findings.flatMap((f, i) =>
            selected.includes(f.id) ? [i] : [],
          ),
        },
        abort.signal,
      );
      if (own === generation.current) setReport(approved.markdown);
    } catch (e) {
      if (own === generation.current)
        setError(e instanceof Error ? e.message : 'Approval expired.');
    } finally {
      if (own === generation.current) setBusy(false);
    }
  }
  return (
    <section
      id="ai-review"
      className="ai-panel"
      aria-labelledby="ai-review-title"
    >
      <h2 id="ai-review-title">
        AI review{' '}
        <span className="badge">
          {authenticated ? 'Access enabled' : 'Access required'}
        </span>
      </h2>
      <p>
        Selected public source windows are sent to Cloudflare Workers AI.
        Separate backend investigation of the PR URL above. Three supported risk
        categories, fresh pinned GitHub evidence, no automatic publication.
        Shared free allowances apply. The offline demo makes no model calls.
      </p>
      {!authenticated ? (
        <form onSubmit={login} className="ai-access">
          <label htmlFor="ai-access-code">Private review access code</label>
          <input
            id="ai-access-code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            required
            maxLength={128}
          />
          <button disabled={busy} type="submit">
            Unlock live reviews
          </button>
        </form>
      ) : (
        <div className="ai-actions">
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={() => void run()}
          >
            Run AI review
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void fetch('/api/session', {
                method: 'DELETE',
                credentials: 'same-origin',
              });
              setAuthenticated(false);
              setDraft(null);
              setReport('');
            }}
          >
            Lock access
          </button>
        </div>
      )}
      {busy ? (
        <div role="status">
          Review request in progress…{' '}
          <button type="button" onClick={cancel}>
            Cancel AI request
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {draft ? (
        <div>
          {draft.result.capture ? (
            <p>
              PR:{' '}
              <a
                href={draft.result.capture.url}
                target="_blank"
                rel="noreferrer"
              >
                {draft.result.capture.url}
              </a>{' '}
              · head {draft.result.capture.headSha.slice(0, 12)}
            </p>
          ) : null}
          <p role="status">
            <strong>
              {draft.result.ai.realInference
                ? 'Native Workers AI response'
                : 'No confirmed real inference'}
            </strong>{' '}
            · {draft.result.status} · {draft.result.budget.githubRequests}/12
            GitHub requests · {draft.result.budget.modelCalls}/
            {draft.result.workflow === 'single-inference' ? 1 : 16} model
            {draft.result.workflow === 'single-inference'
              ? ' inference'
              : ' decisions'}
          </p>
          <p>
            {draft.result.coverage
              ? `${draft.result.coverage.total} total files; ${draft.result.coverage.inventoried} inventoried; ${draft.result.coverage.inspected} with ${draft.result.workflow === 'single-inference' ? 'prepared source' : 'observed'} windows; ${draft.result.coverage.semanticChecksCompleted} checked for supported predicates. Other files remain unreviewed.`
              : 'Coverage unknown.'}{' '}
            This is not a security clearance.
          </p>
          {draft.result.contextCoverage ? (
            <p>
              {draft.result.contextCoverage.providedLines} supplied source
              lines; {draft.result.contextCoverage.providedAddedLines} supplied
              added lines; {draft.result.contextCoverage.omittedKnownAddedLines}{' '}
              known parsed added lines omitted. Dispatch:{' '}
              {draft.result.contextCoverage.dispatch}. Supplied context does not
              attest model comprehension.
            </p>
          ) : null}
          {draft.result.findings.map((f) => (
            <article key={f.id} className="ai-finding">
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(f.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, f.id]
                        : ids.filter((id) => id !== f.id),
                    )
                  }
                />{' '}
                <strong>
                  {f.severity.toUpperCase()} · {f.title}
                </strong>
              </label>
              <p>{f.explanation}</p>
              <p>{f.recommendation}</p>
              <pre>{f.evidence}</pre>
              <a href={f.sourceUrl} target="_blank" rel="noreferrer">
                {f.path}:{f.line} · pinned source
              </a>
            </article>
          ))}
          {!draft.result.findings.length ? (
            <p>
              No supported AI findings. Unreviewed code and zero findings do not
              establish safety.
            </p>
          ) : (
            <button
              type="button"
              disabled={busy || !selected.length || !!report}
              onClick={() => void approve()}
            >
              I reviewed these findings — approve for manual copy
            </button>
          )}
          {!!draft.result.rejected.length && (
            <p>
              Refusals: {draft.result.rejected.map((r) => r.code).join(', ')}
            </p>
          )}
          {report ? (
            <div className="report-preview">
              <label htmlFor="approved-ai-report">
                Human-approved Markdown · nothing has been published
              </label>
              <textarea
                id="approved-ai-report"
                readOnly
                rows={12}
                value={report}
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(report)
                    .catch(() =>
                      setError('Select and copy the report manually.'),
                    );
                }}
              >
                Copy approved AI report
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
