import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createNodeHandler,
  SNAPSHOT_MEDIA_TYPE,
} from '../../src/server/node-adapter';

export const PROBE_PATH = '/api/transport-probe';
export const DELAY_MS = 8000;
export const PREFIX = 'PRISM_PREFIX\n';
export const TAIL = 'PRISM_TAIL\n';
export type ProbeCase = 'delayed' | 'ingestion' | 'maximum' | 'error' | 'abort';
export type SafeEvent = {
  case: ProbeCase;
  event:
    | 'start'
    | 'tail-produced'
    | 'complete'
    | 'cancelled'
    | 'request-aborted'
    | 'controlled-error';
  bytes: number;
  elapsedMs: number;
  node: string;
};
export interface HarnessOptions {
  origin: string;
  secret: string;
  expiresAt: number;
  directory: string;
  event?: (event: SafeEvent) => void;
}

export function createTransportHandler(options: HarnessOptions) {
  if (
    !/^[a-f0-9]{64}$/.test(options.secret) ||
    !Number.isSafeInteger(options.expiresAt)
  )
    throw new Error('Invalid probe configuration');
  const expected = Buffer.from(options.secret);
  const used = new Set<ProbeCase>(); // Advisory per-instance replay control, not a distributed quota.
  const handler = createNodeHandler(
    async (request) => {
      if (
        request.method !== 'POST' ||
        new URL(request.url).pathname !== PROBE_PATH ||
        new URL(request.url).search
      )
        return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
      const name = request.headers.get('x-prism-case');
      if (
        !['delayed', 'ingestion', 'maximum', 'error', 'abort'].includes(
          name ?? '',
        )
      )
        return Response.json(
          { error: { code: 'INVALID_CASE' } },
          { status: 400 },
        );
      const scenario = name as ProbeCase;
      if (used.has(scenario))
        return Response.json(
          { error: { code: 'ALREADY_USED' } },
          { status: 409 },
        );
      if (request.body) {
        const reader = request.body.getReader();
        const item = await reader.read();
        await reader.cancel();
        if (!item.done)
          return Response.json(
            { error: { code: 'EMPTY_BODY_REQUIRED' } },
            { status: 400 },
          );
      }
      used.add(scenario);
      const started = performance.now();
      let bytes = 0,
        ended = false;
      const emit = (event: SafeEvent['event']) =>
        options.event?.({
          case: scenario,
          event,
          bytes,
          elapsedMs: Math.round(performance.now() - started),
          node: process.version,
        });
      const aborted = () => {
        if (!ended) emit('request-aborted');
      };
      request.signal.addEventListener('abort', aborted, { once: true });
      const finish = (event: 'complete' | 'cancelled') => {
        if (ended) return;
        ended = true;
        request.signal.removeEventListener('abort', aborted);
        emit(event);
      };
      emit('start');
      let source: ReadableStream<Uint8Array>, length: number;
      if (scenario === 'ingestion' || scenario === 'maximum') {
        length = scenario === 'ingestion' ? 4752446 : 12582912;
        source = Readable.toWeb(
          createReadStream(resolve(options.directory, `${scenario}.bin`), {
            highWaterMark: 65536,
          }),
        ) as ReadableStream<Uint8Array>;
      } else {
        let pulls = 0,
          stopped = false,
          timer: ReturnType<typeof setTimeout> | undefined,
          wake: (() => void) | undefined;
        const wait = (ms: number) =>
          new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, ms);
          });
        length =
          scenario === 'delayed'
            ? Buffer.byteLength(PREFIX + TAIL)
            : scenario === 'error'
              ? 1028
              : 40 * 65536;
        source = new ReadableStream(
          {
            async pull(controller) {
              if (scenario === 'delayed') {
                if (pulls++ === 0)
                  controller.enqueue(new TextEncoder().encode(PREFIX));
                else {
                  await wait(DELAY_MS);
                  if (!stopped) {
                    emit('tail-produced');
                    controller.enqueue(new TextEncoder().encode(TAIL));
                    controller.close();
                  }
                }
              } else if (scenario === 'error') {
                if (pulls++ === 0)
                  controller.enqueue(new Uint8Array([0, 0, 4, 0]));
                else {
                  await wait(100);
                  if (!stopped) {
                    emit('controlled-error');
                    controller.error(new Error('CONTROLLED_SYNTHETIC_ERROR'));
                  }
                }
              } else {
                await wait(250);
                if (!stopped) {
                  controller.enqueue(new Uint8Array(65536).fill(65));
                  if (++pulls === 40) controller.close();
                }
              }
            },
            cancel() {
              stopped = true;
              clearTimeout(timer);
              wake?.();
            },
          },
          { highWaterMark: 0 },
        );
      }
      const reader = source.getReader();
      const measured = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const item = await reader.read();
              if (ended) return;
              if (item.done) {
                finish('complete');
                controller.close();
              } else {
                bytes += item.value.byteLength;
                controller.enqueue(item.value);
              }
            } catch {
              controller.error(new Error('CONTROLLED_STREAM_FAILURE'));
            }
          },
          async cancel() {
            finish('cancelled');
            await reader.cancel().catch(() => {});
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(measured, {
        headers: {
          'Content-Type': SNAPSHOT_MEDIA_TYPE,
          'Content-Length': String(length),
          'X-Prism-Case': scenario,
          'X-Prism-Delay-Ms': String(DELAY_MS),
          'X-Prism-Deadline-Ms': '30000',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    },
    { origin: options.origin },
  ); // Uses the unchanged default 30s M4 lifetime.
  return async (request: IncomingMessage, response: ServerResponse) => {
    const supplied = request.headers['x-prism-probe'];
    const authorized =
      typeof supplied === 'string' &&
      /^[a-f0-9]{64}$/.test(supplied) &&
      supplied.length === expected.length &&
      timingSafeEqual(Buffer.from(supplied), expected);
    if (!authorized || Date.now() >= options.expiresAt) {
      response.writeHead(401, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'close',
      });
      response.end();
      return;
    }
    if (
      request.headers['content-length'] !== '0' ||
      request.headers['transfer-encoding']
    ) {
      response.writeHead(400, {
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      response.end();
      return;
    }
    await handler(request, response);
  };
}

let deployedHandler: ReturnType<typeof createTransportHandler> | undefined;
export default async function probe(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const configuredSecret = process.env.PRISM_TRANSPORT_SECRET ?? '';
  const configuredExpiry = Number(process.env.PRISM_PROBE_EXPIRES);
  const configurationError = !/^[a-f0-9]{64}$/.test(configuredSecret)
    ? 'SECRET_NOT_CONFIGURED'
    : !Number.isSafeInteger(configuredExpiry)
      ? 'EXPIRY_NOT_CONFIGURED'
      : !process.env.VERCEL_URL
        ? 'SYSTEM_ORIGIN_NOT_CONFIGURED'
        : undefined;
  if (configurationError) {
    response.writeHead(503, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Prism-Probe-Error': configurationError,
      Connection: 'close',
    });
    response.end();
    return;
  }
  try {
    deployedHandler ??= createTransportHandler({
      origin: `https://${process.env.VERCEL_URL ?? ''}`,
      secret: configuredSecret,
      expiresAt: configuredExpiry,
      directory: fileURLToPath(new URL('.', import.meta.url)),
      event: (metadata) =>
        console.log(JSON.stringify({ prismTransport: metadata })),
    });
    await deployedHandler(request, response);
  } catch {
    if (!response.headersSent) {
      response.writeHead(503, {
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      response.end();
    } else response.destroy();
  }
}
