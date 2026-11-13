import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createNodeHandler,
  nodePublicOrigin,
  type NodeFetch,
} from '../node-adapter';
/** Finite explicit origins only: environment Host/Origin are never trusted as configuration. */
export function releaseEntry(factory: () => NodeFetch) {
  const handlers = new Map<string, ReturnType<typeof createNodeHandler>>();
  let app: NodeFetch | undefined;
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const origins = [
        process.env.PRISM_PUBLIC_ORIGIN,
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : undefined,
      ]
        .filter((v): v is string => !!v)
        .map(nodePublicOrigin);
      const origin = origins.find(
        (value) => new URL(value).host === request.headers.host,
      );
      if (!origin) throw new Error('Origin not configured');
      app ??= factory();
      if (!handlers.has(origin))
        handlers.set(origin, createNodeHandler(app, { origin }));
      await handlers.get(origin)!(request, response);
    } catch {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(
          '{"error":{"code":"RELEASE_NOT_CONFIGURED","message":"Release configuration unavailable."}}',
        );
      }
    }
  };
}
