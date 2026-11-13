import { vi } from 'vitest';
import { ReviewBudget, type RelayEnvironment } from '../src/release/cloudflare';
import { PrivateRelay } from '../src/server/release/relay';
import type { ModelRequest } from '../src/server/agent/protocol';
import { oneFindingModel } from './agent-fixtures';
export const SERVER_SECRET = 'a'.repeat(64);
export function releaseFixture(script = oneFindingModel()) {
  const values = new Map<string, unknown>();
  const storage = {
    async get<T>(key: string) {
      return structuredClone(values.get(key)) as T | undefined;
    },
    async put(key: string, value: unknown) {
      values.set(key, structuredClone(value));
    },
  };
  const run = vi.fn(async (_model: string, input: unknown) => {
    const messages = (input as { messages: { content: string }[] }).messages;
    const request = JSON.parse(messages[1].content) as ModelRequest;
    return Response.json({
      object: 'chat.completion',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: await script.next(request, new AbortController().signal),
          },
        },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    });
  });
  const env = {
    AI: { run },
    RELAY_SECRET: SERVER_SECRET,
  } as unknown as RelayEnvironment;
  let coordinator = new ReviewBudget({ storage }, env);
  const transport = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) =>
      coordinator.fetch(new Request(input, init)),
  );
  const relay = new PrivateRelay(
    'https://prism-ai-review.example.workers.dev',
    SERVER_SECRET,
    transport as typeof fetch,
  );
  return {
    relay,
    run,
    transport,
    storage,
    restart: () => {
      coordinator = new ReviewBudget({ storage }, env);
    },
    config: {
      accessCode: 'b'.repeat(64),
      sessionSecret: 'c'.repeat(64),
      relay,
    },
  };
}
export const post = (
  path: string,
  body: unknown,
  cookie = '',
  signal?: AbortSignal,
) =>
  new Request(`https://prism.example${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
