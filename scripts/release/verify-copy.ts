import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export type CopyStage =
  | 'navigate'
  | 'review-replay'
  | 'approve-replay'
  | 'environment'
  | 'approved-text'
  | 'copy-click'
  | 'write-complete'
  | 'clipboard-read'
  | 'clipboard-compare';
const messages = {
  CLIPBOARD_UNAVAILABLE: 'Clipboard API unavailable in this browser context.',
  ORIGIN_MISMATCH: 'Page origin differs from the approved test origin.',
  TEXT_MISMATCH: 'Approved textarea does not match canonical Markdown.',
  COPY_MISMATCH: 'Clipboard text differs beyond Windows CRLF conversion.',
} as const;
/** Only fixed messages survive; Playwright errors can contain page/source/credential text. */
export function safeCopyError(stage: CopyStage, error: unknown) {
  const e = error instanceof Error ? error : undefined;
  const name = [
    'Error',
    'TimeoutError',
    'TypeError',
    'NotAllowedError',
  ].includes(e?.name ?? '')
    ? e!.name
    : 'OtherError';
  return {
    stage,
    exceptionName: name,
    sanitizedMessage:
      messages[e?.message as keyof typeof messages] ??
      (name === 'TimeoutError'
        ? 'Browser action timed out.'
        : e?.message.includes('strict mode violation')
          ? 'Locator matched multiple elements.'
          : 'Browser operation failed; exception content omitted.'),
  };
}
export function compareClipboard(expected: string, actual: string) {
  // Windows CF_UNICODETEXT uses CRLF. Do not trim, normalize Unicode, change bare CR,
  // collapse whitespace, or otherwise forgive a changed report.
  const canonical = actual.replace(/\r\n/g, '\n');
  const hash = (text: string) =>
    createHash('sha256').update(text).digest('hex');
  return {
    rawExact: actual === expected,
    canonicalExact: canonical === expected,
    windowsCRLFPairs: (actual.match(/\r\n/g) ?? []).length,
    expectedBytes: Buffer.byteLength(expected),
    clipboardBytes: Buffer.byteLength(actual),
    expectedSha256: hash(expected),
    clipboardSha256: hash(actual),
    canonicalClipboardSha256: hash(canonical),
  };
}
/** Use only after authenticated human approval. This helper dispatches no review/inference. */
export async function verifyApprovedCopy(
  page: Page,
  expectedMarkdown: string,
  expectedOrigin: string,
) {
  let stage: CopyStage = 'environment';
  let environment;
  let comparison;
  try {
    environment = await page.evaluate(async () => ({
      origin: location.origin,
      secureContext: isSecureContext,
      writeText: typeof navigator.clipboard?.writeText === 'function',
      readText: typeof navigator.clipboard?.readText === 'function',
      writePermission: await navigator.permissions
        .query({ name: 'clipboard-write' as PermissionName })
        .then((p) => p.state)
        .catch(() => 'unsupported'),
      readPermission: await navigator.permissions
        .query({ name: 'clipboard-read' as PermissionName })
        .then((p) => p.state)
        .catch(() => 'unsupported'),
    }));
    if (environment.origin !== expectedOrigin)
      throw new Error('ORIGIN_MISMATCH');
    if (
      !environment.secureContext ||
      !environment.writeText ||
      !environment.readText
    )
      throw new Error('CLIPBOARD_UNAVAILABLE');
    stage = 'approved-text';
    const panel = page.locator('#ai-review');
    const textarea = panel.getByLabel(/Human-approved Markdown/);
    await expect(textarea).toBeVisible();
    if ((await textarea.inputValue()) !== expectedMarkdown)
      throw new Error('TEXT_MISMATCH');
    await expect(textarea).toHaveAttribute('readonly', '');
    stage = 'copy-click';
    await panel
      .getByRole('button', { name: 'Copy approved AI report' })
      .click();
    stage = 'write-complete';
    await expect(
      panel.getByText('Approved Markdown copied.', { exact: true }),
    ).toBeVisible();
    stage = 'clipboard-read';
    const actual = await page.evaluate(() => navigator.clipboard.readText());
    stage = 'clipboard-compare';
    comparison = compareClipboard(expectedMarkdown, actual);
    if (!comparison.canonicalExact) throw new Error('COPY_MISMATCH');
    return { passed: true as const, environment, comparison };
  } catch (error) {
    return {
      passed: false as const,
      environment,
      comparison,
      error: safeCopyError(stage, error),
    };
  }
}
