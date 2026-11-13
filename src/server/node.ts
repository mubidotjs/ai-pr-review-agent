import { createApp } from './index';
import type { Transport } from './github';
import { createNodeHandler, type NodeAdapterOptions } from './node-adapter';

export function createNodeReviewHandler(
  options: NodeAdapterOptions,
  transport?: Transport,
) {
  const app = createApp(transport, 'node');
  return createNodeHandler((request) => app.fetch(request), options);
}
