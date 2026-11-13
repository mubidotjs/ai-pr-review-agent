import { getRequestListener, RequestError } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LIMITS } from '../shared/types';

export const SNAPSHOT_MEDIA_TYPE = 'application/vnd.prism.review-input.v1';
export const STREAM_CHUNK_BYTES = 64 * 1024;
export type NodeFetch = (request: Request) => Response | Promise<Response>;
const safeHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const failure = (code: string, status: number) =>
  Response.json(
    { error: { code, message: 'Request could not complete safely.' } },
    { status, headers: { ...safeHeaders, Connection: 'close' } },
  );

export function nodePublicOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      ))
  )
    throw new Error(
      'An exact HTTPS public origin or loopback HTTP origin is required.',
    );
  return url.origin;
}

// A pull-driven, byte-exact guard around a response stream. No concatenation,
// decoding, JSON conversion, tee, or read-ahead of the full response occurs.
function guardedSnapshot(
  body: ReadableStream<Uint8Array>,
  expected: number | undefined,
  signal: AbortSignal,
  outgoing: ServerResponse,
) {
  const reader = body.getReader();
  let pending: Uint8Array | undefined,
    offset = 0,
    total = 0,
    stopped = false;
  let destination: ReadableStreamDefaultController<Uint8Array>;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    pending = undefined;
    signal.removeEventListener('abort', stop);
    // Never turn a partial binary frame into a successful EOF or append JSON.
    outgoing.destroy();
    void reader.cancel().catch(() => {});
    try {
      destination.close();
    } catch {
      /* Already cancelled. */
    }
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        destination = controller;
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
      },
      async pull(controller) {
        if (stopped) return;
        try {
          if (!pending || offset === pending.byteLength) {
            const chunk = await reader.read();
            if (stopped) return;
            if (chunk.done) {
              if (expected !== undefined && total !== expected) {
                stop();
                return;
              }
              stopped = true;
              pending = undefined;
              signal.removeEventListener('abort', stop);
              reader.releaseLock();
              controller.close();
              return;
            }
            if (!(chunk.value instanceof Uint8Array)) {
              stop();
              return;
            }
            total += chunk.value.byteLength;
            if (
              total > LIMITS.snapshotBytes ||
              (expected !== undefined && total > expected)
            ) {
              stop();
              return;
            }
            pending = chunk.value;
            offset = 0;
          }
          const end = Math.min(offset + STREAM_CHUNK_BYTES, pending.byteLength);
          controller.enqueue(pending.subarray(offset, end));
          offset = end;
        } catch {
          stop();
        }
      },
      async cancel() {
        stopped = true;
        pending = undefined;
        signal.removeEventListener('abort', stop);
        await reader.cancel().catch(() => {});
      },
    },
    { highWaterMark: 0 },
  );
}

export interface NodeAdapterOptions {
  origin: string;
  /** Test-only shorter deadlines; production always uses the shared 30s limit. */
  deadlineMs?: number;
}

export function createNodeHandler(
  fetchApp: NodeFetch,
  options: NodeAdapterOptions,
) {
  const origin = nodePublicOrigin(options.origin),
    host = new URL(origin).host;
  const deadlineMs = options.deadlineMs ?? LIMITS.durationMs;
  if (!(deadlineMs > 0 && deadlineMs <= LIMITS.durationMs))
    throw new Error('Invalid transport deadline');
  let activeReview = false; // Instance-local only; never advertised as global admission control.
  return async (
    incoming: IncomingMessage,
    outgoing: ServerResponse,
  ): Promise<void> => {
    const review = incoming.url?.split('?')[0] === '/api/review';
    const reject = async (response: Response) => {
      outgoing.writeHead(response.status, {
        ...Object.fromEntries(response.headers),
        Connection: 'close',
      });
      outgoing.end(await response.text()); // Fixed, small adapter errors only.
    };
    if (incoming.headers.host?.toLowerCase() !== host.toLowerCase())
      return reject(failure('HOST_REJECTED', 400));
    // Vercel helpers must be disabled. Never reconstruct a consumed/parsed body
    // because original-byte accounting and fatal UTF-8 validation would be lost.
    if (Object.hasOwn(incoming, 'body') || incoming.readableDidRead)
      return reject(failure('RAW_BODY_REQUIRED', 400));
    if (review && Number(incoming.headers['content-length']) > LIMITS.bodyBytes)
      return reject(failure('BYTE_LIMIT', 413));
    if (review && activeReview) return reject(failure('BUSY', 429));
    if (review) activeReview = true;
    const lifetime = new AbortController();
    let timedOut = false,
      released = false;
    const timer = setTimeout(() => {
      timedOut = true;
      lifetime.abort();
      if (outgoing.headersSent) outgoing.destroy();
    }, deadlineMs);
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      if (review) activeReview = false;
      lifetime.abort();
      outgoing.off('close', release);
      outgoing.off('finish', release);
    };
    outgoing.once('close', release);
    outgoing.once('finish', release);
    const listener = getRequestListener(
      async (request) => {
        const signal = AbortSignal.any([request.signal, lifetime.signal]);
        let abort: () => void = () => {};
        const interrupted = new Promise<Response>((resolve) => {
          abort = () =>
            resolve(
              failure(
                timedOut ? 'TIME_LIMIT' : 'CANCELLED',
                timedOut ? 504 : 499,
              ),
            );
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
        try {
          const path = new URL(request.url);
          const init: RequestInit & { duplex?: 'half' } = {
            method: request.method,
            headers: request.headers,
            signal,
          };
          if (!['GET', 'HEAD'].includes(request.method)) {
            init.body = request.body;
            init.duplex = 'half';
          }
          const canonical = new Request(
            origin + path.pathname + path.search,
            init,
          );
          const response = await Promise.race([
            Promise.resolve()
              .then(() => fetchApp(canonical))
              .catch(() => failure('INTERNAL_ERROR', 500)),
            interrupted,
          ]);
          const headers = new Headers(response.headers);
          for (const [key, value] of Object.entries(safeHeaders))
            headers.set(key, value);
          // Close rejected/unread input instead of relying on an unbounded drain.
          if (response.status >= 400) headers.set('Connection', 'close');
          if (
            response.headers.get('Content-Type') !== SNAPSHOT_MEDIA_TYPE ||
            !response.body
          )
            return new Response(response.body, {
              status: response.status,
              headers,
            });
          const length = headers.get('Content-Length');
          const expected =
            length !== null && /^\d+$/.test(length)
              ? Number(length)
              : undefined;
          if (
            length !== null &&
            (!Number.isSafeInteger(expected) ||
              expected! > LIMITS.snapshotBytes)
          ) {
            await response.body.cancel();
            return failure('SNAPSHOT_BYTE_LIMIT', 413);
          }
          headers.delete('Content-Length');
          // Explicit HTTP/1 chunked transport skips the adapter's coalescing path.
          // Vercel's front proxy/streaming exemption remains a platform acceptance gate.
          headers.set('Transfer-Encoding', 'chunked');
          if (expected !== undefined)
            headers.set('X-Prism-Snapshot-Bytes', String(expected));
          return new Response(
            guardedSnapshot(response.body, expected, signal, outgoing),
            { status: response.status, headers },
          );
        } catch {
          return failure('INVALID_REQUEST', 400);
        } finally {
          signal.removeEventListener('abort', abort);
        }
      },
      {
        overrideGlobalObjects: false,
        autoCleanupIncoming: false,
        errorHandler: (error) =>
          failure(
            error instanceof RequestError
              ? 'INVALID_REQUEST'
              : 'INTERNAL_ERROR',
            error instanceof RequestError ? 400 : 500,
          ),
      },
    );
    try {
      await listener(incoming, outgoing);
    } catch {
      if (!outgoing.headersSent) await reject(failure('INTERNAL_ERROR', 500));
      else outgoing.destroy();
    } finally {
      if (outgoing.writableFinished || outgoing.destroyed) release();
      else
        await new Promise<void>((resolve) => {
          const finished = () => {
            outgoing.off('finish', finished);
            outgoing.off('close', finished);
            release();
            resolve();
          };
          outgoing.once('finish', finished);
          outgoing.once('close', finished);
        });
    }
  };
}
