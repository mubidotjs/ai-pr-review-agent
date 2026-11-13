import { createServer } from 'node:http';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './index';
import { createNodeHandler } from './node-adapter';

const port = Number(process.env.PORT ?? 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid loopback port');
// Static middleware is kept outside the API app's not-found handler.
const api = createApp(undefined, 'node');
const site = new Hono();
site.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  await next();
});
site.use('*', serveStatic({ root: './dist/node/client' }));
const handler = createNodeHandler(
  (r) =>
    new URL(r.url).pathname.startsWith('/api/') ? api.fetch(r) : site.fetch(r),
  { origin: `http://127.0.0.1:${port}` },
);
const server = createServer(
  { maxHeaderSize: 8192, highWaterMark: 16384 },
  (req, res) => {
    void handler(req, res);
  },
);
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, '127.0.0.1', () =>
  console.log(`PRISM Node: http://127.0.0.1:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.closeAllConnections();
    server.close();
  });
