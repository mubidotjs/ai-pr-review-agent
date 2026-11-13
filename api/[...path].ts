import type { IncomingMessage, ServerResponse } from 'node:http';
import { createNodeReviewHandler } from '../src/server/node';

// Build Output API metadata disables eager body helpers and requests streaming.
// The shared Hono route owns exact input bytes. No Vercel SDK is required.
let handler: ReturnType<typeof createNodeReviewHandler> | undefined;
export default async function reviewApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (!handler) {
    try {
      handler = createNodeReviewHandler({
        origin: process.env.PRISM_PUBLIC_ORIGIN ?? '',
      });
    } catch {
      response.writeHead(503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(
        JSON.stringify({
          error: {
            code: 'ORIGIN_NOT_CONFIGURED',
            message: 'API origin is not configured.',
          },
        }),
      );
      return;
    }
  }
  await handler(request, response);
}
