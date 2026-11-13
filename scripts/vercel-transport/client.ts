import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DELAY_MS, PREFIX, TAIL } from './harness';

export type ClientCase =
  | 'maximum'
  | 'ingestion'
  | 'delayed'
  | 'error'
  | 'abort'
  | 'unauthorized'
  | 'real-route-absent';
export interface ProbeOptions {
  url: string;
  scenario: ClientCase;
  expected?: { bytes: number; sha256: string };
  secret?: string;
  path?: string;
  /** Transfer deadline only; never changes the Node/application deadline. */
  transferSeconds?: number;
  transport:
    | { kind: 'vercel'; cli: string; scope: string; cwd: string }
    | { kind: 'loopback' };
}
export const transferSecondsFor = (scenario: ClientCase) =>
  scenario === 'maximum' ? 120 : scenario === 'abort' ? 3 : 35;

export function probeCommand(options: ProbeOptions) {
  const seconds =
    options.transferSeconds ?? transferSecondsFor(options.scenario);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)
    throw new Error('Transfer timeout must be bounded by 120 seconds.');
  const url = new URL(options.url);
  if (
    options.url !== url.origin ||
    (options.transport.kind === 'vercel'
      ? url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')
      : url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
  )
    throw new Error('Unexpected transport destination.');
  if (options.secret !== undefined && !/^[a-f0-9]{64}$/.test(options.secret))
    throw new Error('Invalid operator secret.');
  const path = options.path ?? '/api/transport-probe';
  if (!['/api/transport-probe', '/api/review'].includes(path))
    throw new Error('Unexpected probe route.');
  const config =
    [
      'request = "POST"',
      'data = ""',
      'include',
      'no-buffer',
      'silent',
      'show-error',
      'suppress-connect-headers',
      `max-time = ${seconds}`,
      'retry = 0',
      'header = "Accept-Encoding: identity"',
      'header = "Expect:"',
      `header = "X-Prism-Case: ${options.scenario}"`,
      ...(options.secret
        ? [`header = "X-Prism-Probe: ${options.secret}"`]
        : []),
    ].join('\n') + '\n';
  return {
    executable: options.transport.kind === 'vercel' ? process.execPath : 'curl',
    args:
      options.transport.kind === 'vercel'
        ? [
            options.transport.cli,
            'curl',
            path,
            '--deployment',
            options.url,
            '--scope',
            options.transport.scope,
            '--',
            '--config',
            '-',
          ]
        : [options.url + path, '--config', '-'],
    cwd:
      options.transport.kind === 'vercel' ? options.transport.cwd : undefined,
    config,
    transferSeconds: seconds,
    // Separate bounded CLI startup/protection overhead; not a server allowance.
    watchdogMs: (seconds + 25) * 1000,
  };
}

const permitted = new Set([
  'content-type',
  'content-encoding',
  'cache-control',
  'x-content-type-options',
  'referrer-policy',
  'transfer-encoding',
  'x-prism-snapshot-bytes',
  'x-prism-case',
  'x-prism-delay-ms',
  'x-prism-deadline-ms',
  'x-vercel-id',
  'x-vercel-error',
]);

// No deployment, login, model calls, payload persistence or retries on import/run.
export async function probe(options: ProbeOptions) {
  const command = probeCommand(options),
    began = performance.now();
  const hash = createHash('sha256');
  let bytes = 0,
    firstByteMs: number | undefined,
    lastByteMs = 0;
  let headerBuffer = Buffer.alloc(0),
    haveHeaders = false,
    status = 0;
  let small = Buffer.alloc(0),
    clientError: string | undefined;
  const headers: Record<string, string> = {};
  return new Promise<{
    scenario: ClientCase;
    pass: boolean;
    classification: string;
    status: number;
    exitCode: number | null;
    bytes: number;
    sha256: string;
    firstByteMs?: number;
    lastByteMs: number;
    elapsedMs: number;
    transferTimeoutSeconds: number;
    headers: Record<string, string>;
    eof: boolean;
    exactIntegrity?: boolean;
  }>((resolvePromise) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    });
    const stop = (code: string) => {
      clientError = code;
      child.kill();
    };
    const watchdog = setTimeout(
      () => stop('CLIENT_WATCHDOG'),
      command.watchdogMs,
    );
    const body = (data: Buffer) => {
      if (!data.length) return;
      firstByteMs ??= Math.round(performance.now() - began);
      lastByteMs = Math.round(performance.now() - began);
      bytes += data.length;
      hash.update(data);
      if (small.length < 2048)
        small = Buffer.concat([small, data.subarray(0, 2048 - small.length)]);
      if (bytes > 12582912) stop('RESPONSE_TOO_LARGE');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (haveHeaders) return body(chunk);
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const end = headerBuffer.indexOf('\r\n\r\n');
      if (end < 0) {
        if (headerBuffer.length > 16384) stop('INVALID_RESPONSE_HEADERS');
        return;
      }
      if (end > 16384) return stop('INVALID_RESPONSE_HEADERS');
      const lines = headerBuffer
        .subarray(0, end)
        .toString('latin1')
        .split('\r\n');
      status = Number(lines[0].match(/^HTTP\/\S+ (\d+)/)?.[1] ?? 0);
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        const name = line.slice(0, colon).toLowerCase();
        if (colon > 0 && permitted.has(name))
          headers[name] = line.slice(colon + 1).trim();
      }
      haveHeaders = true;
      body(headerBuffer.subarray(end + 4));
      headerBuffer = Buffer.alloc(0);
    });
    // Never retain stderr, which can contain CLI authentication diagnostics.
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (/curl: option .* is unknown/.test(text))
        clientError = 'CLIENT_OPTION_REJECTED';
      else if (
        /No existing credentials|not authenticated|login required/i.test(text)
      )
        clientError = 'CLI_AUTH_UNAVAILABLE';
    });
    child.once('error', () => {
      clientError = 'CLIENT_PROCESS_FAILED';
    });
    child.once('close', (exitCode) => {
      clearTimeout(watchdog);
      const digest = hash.digest('hex'),
        expected = options.expected;
      const success =
        status === 200 &&
        exitCode === 0 &&
        headers['cache-control'] === 'no-store';
      const integrity = expected
        ? bytes === expected.bytes && digest === expected.sha256
        : undefined;
      let pass = false;
      if (expected) pass = success && integrity === true;
      else if (options.scenario === 'delayed')
        pass =
          success &&
          small.toString() === PREFIX + TAIL &&
          firstByteMs !== undefined &&
          firstByteMs < DELAY_MS &&
          lastByteMs - firstByteMs >= DELAY_MS - 100;
      else if (options.scenario === 'error')
        pass =
          status === 200 &&
          exitCode !== 28 &&
          bytes === 4 &&
          digest ===
            createHash('sha256')
              .update(new Uint8Array([0, 0, 4, 0]))
              .digest('hex') &&
          bytes < Number(headers['x-prism-snapshot-bytes']);
      else if (options.scenario === 'abort')
        pass =
          status === 200 && exitCode === 28 && bytes > 0 && bytes < 40 * 65536;
      else if (options.scenario === 'unauthorized')
        pass = status === 401 && bytes === 0;
      else if (options.scenario === 'real-route-absent') pass = status === 404;
      const platformError = headers['x-vercel-error'];
      const classification = pass
        ? options.scenario === 'error'
          ? 'EXPECTED_INCOMPLETE_FRAME'
          : options.scenario === 'abort'
            ? 'EXPECTED_CLIENT_ABORT'
            : 'PASS'
        : (clientError ??
          (exitCode === 28
            ? 'CLIENT_TIMEOUT'
            : platformError &&
                /^(FUNCTION_INVOCATION_TIMEOUT|FUNCTION_INVOCATION_FAILED|FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE)$/.test(
                  platformError,
                )
              ? 'PLATFORM_TERMINATION'
              : status >= 400
                ? 'HTTP_ERROR'
                : exitCode !== 0
                  ? 'CONNECTION_OR_PROCESS_TERMINATED'
                  : expected && bytes !== expected.bytes
                    ? 'INCOMPLETE_TRANSFER'
                    : expected && !integrity
                      ? 'RESPONSE_CORRUPTION'
                      : 'UNEXPECTED_RESPONSE'));
      resolvePromise({
        scenario: options.scenario,
        pass: pass && !clientError,
        classification,
        status,
        exitCode,
        bytes,
        sha256: digest,
        firstByteMs,
        lastByteMs,
        elapsedMs: Math.round(performance.now() - began),
        transferTimeoutSeconds: command.transferSeconds,
        headers,
        eof: exitCode === 0,
        ...(expected ? { exactIntegrity: integrity } : {}),
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(command.config);
  });
}
