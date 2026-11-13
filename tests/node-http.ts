import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createNodeHandler,
  type NodeFetch,
  type NodeAdapterOptions,
} from '../src/server/node-adapter';

export async function localNodeRoute(
  fetchApp: NodeFetch,
  options: Partial<NodeAdapterOptions> = {},
) {
  const server = createServer(
    { highWaterMark: 16384, maxHeaderSize: 8192 },
    (request, response) => {
      void handler(request, response);
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const handler = createNodeHandler(fetchApp, { origin, ...options });
  return {
    server,
    origin,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
