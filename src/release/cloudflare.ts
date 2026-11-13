import { z } from 'zod';
import {
  RELEASE,
  ReleaseError,
  safeJson,
  readJson,
  neuronEstimate,
  interrupted,
} from './contract';
import {
  SYSTEM_POLICY,
  TOOL_CONTRACTS,
  candidateSchema,
  decisionSchema,
} from '../server/agent/protocol';

interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}
interface State {
  storage: Storage;
}
export interface NativeAi {
  run(
    model: string,
    input: unknown,
    options: { returnRawResponse: true; signal: AbortSignal },
  ): Promise<Response>;
}
export interface RelayEnvironment {
  AI: NativeAi;
  RELAY_SECRET: string;
  REVIEW_BUDGET: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}
interface Grant {
  expires: number;
  turn: number;
  kind: 'agent' | 'deterministic';
  uncertain?: boolean;
}
interface Counters {
  day: string;
  calls: number;
  neurons: number;
  reviews: number[];
  logins: number[];
  grants: Record<string, Grant>;
}
const empty = (): Counters => ({
  day: '',
  calls: 0,
  neurons: 0,
  reviews: [],
  logins: [],
  grants: {},
});
const principal = z.string().regex(/^[a-f0-9]{64}$/);
const grantId = z.string().uuid();
const requestSchema = z
  .object({
    protocolVersion: z.literal(1),
    system: z.literal(SYSTEM_POLICY),
    tools: z
      .array(z.object({ name: z.string(), contract: z.string() }).strict())
      .length(5),
    factCards: z.array(candidateSchema).max(100),
    untrusted: z
      .object({
        label: z.literal('UNTRUSTED_REPOSITORY_DATA'),
        observations: z
          .array(
            z.object({ tool: z.string().max(40), data: z.unknown() }).strict(),
          )
          .max(3),
      })
      .strict(),
    remaining: z
      .object({
        steps: z.number().int().min(0).max(16),
        toolCalls: z.number().int().min(0).max(12),
        modelCalls: z.number().int().min(0).max(16),
      })
      .strict(),
  })
  .strict();
const nativeResponse = z
  .object({
    object: z.literal('chat.completion'),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.literal('stop'),
            message: z
              .object({
                role: z.literal('assistant'),
                content: z.string().min(1).max(RELEASE.outputBytes),
                tool_calls: z.null().optional(),
                reasoning_content: z.string().max(0).nullish(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .length(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative(),
        completion_tokens: z
          .number()
          .int()
          .min(0)
          .max(RELEASE.completionTokens),
        completion_tokens_details: z
          .object({ reasoning_tokens: z.literal(0).optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Single global coordinator. Durable storage contains admission counters only.
 * Drafts remain in RAM, bounded and expiring; eviction means approval is unavailable. */
export class ReviewBudget {
  private queue = Promise.resolve();
  private drafts = new Map<
    string,
    { principal: string; digest: string; result: unknown; expires: number }
  >();
  constructor(
    private state: State,
    private env: RelayEnvironment,
  ) {}
  private async atomic<T>(fn: (c: Counters) => T): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const c = (await this.state.storage.get<Counters>('counters')) ?? empty();
      const now = Date.now(),
        day = new Date(now).toISOString().slice(0, 10);
      if (c.day !== day) {
        c.day = day;
        c.calls = 0;
        c.neurons = 0;
      }
      c.reviews = c.reviews.filter((t) => t > now - 3600000);
      c.logins = c.logins.filter((t) => t > now - 3600000);
      for (const [id, g] of Object.entries(c.grants))
        if (g.expires <= now) delete c.grants[id];
      const result = fn(c);
      await this.state.storage.put('counters', c); // Persist reservation BEFORE dispatch; no retry after unknown outcome.
      return result;
    } finally {
      release();
    }
  }
  async fetch(request: Request): Promise<Response> {
    try {
      if (
        !this.env.RELAY_SECRET ||
        this.env.RELAY_SECRET.length < 32 ||
        request.headers.get('Authorization') !==
          `Bearer ${this.env.RELAY_SECRET}`
      )
        throw new ReleaseError('UNAUTHORIZED', 401);
      const url = new URL(request.url);
      if (
        request.method !== 'POST' ||
        url.search ||
        request.headers.has('Origin')
      )
        throw new ReleaseError('REJECTED_ROUTE', 404);
      const body = await readJson(request, RELEASE.relayBytes);
      if (url.pathname === '/login') {
        z.object({}).strict().parse(body);
        await this.atomic((c) => {
          const now = Date.now();
          if (
            c.logins.length >= 30 ||
            c.logins.filter((t) => t > now - 60000).length >= 6
          )
            throw new ReleaseError('LOGIN_LIMIT', 429);
          c.logins.push(now);
        });
        return safeJson({ ok: true });
      }
      if (url.pathname === '/status') {
        z.object({}).strict().parse(body);
        return safeJson(
          await this.atomic((c) => ({
            calls: c.calls,
            reservedNeurons: c.neurons,
            reviews: c.reviews.length,
            limits: RELEASE,
          })),
        );
      }
      if (url.pathname === '/admit') {
        const input = z
          .object({ principal, kind: z.enum(['agent', 'deterministic']) })
          .strict()
          .parse(body);
        return safeJson(
          await this.atomic((c) => {
            if (
              c.reviews.length >= RELEASE.reviewsPerHour ||
              Object.keys(c.grants).length
            )
              throw new ReleaseError('REVIEW_LIMIT', 429);
            if (
              input.kind === 'agent' &&
              (c.calls >= RELEASE.callsPerDay ||
                c.neurons >= RELEASE.neuronsPerDay)
            )
              throw new ReleaseError('AI_QUOTA', 429);
            const grant = crypto.randomUUID();
            c.grants[grant] = {
              kind: input.kind,
              turn: 0,
              expires: Date.now() + RELEASE.reviewMs,
            };
            c.reviews.push(Date.now());
            return { grant };
          }),
        );
      }
      if (url.pathname === '/finish') {
        const { grant } = z.object({ grant: grantId }).strict().parse(body);
        await this.atomic((c) => {
          if (!c.grants[grant]?.uncertain) delete c.grants[grant];
        });
        return safeJson({ ok: true });
      }
      if (url.pathname === '/decide') {
        const input = z
          .object({
            grant: grantId,
            turn: z.number().int().min(0).max(15),
            request: requestSchema,
          })
          .strict()
          .parse(body);
        if (
          JSON.stringify(input.request.tools) !== JSON.stringify(TOOL_CONTRACTS)
        )
          throw new ReleaseError('INVALID_CONTRACT', 400);
        const text = JSON.stringify(input.request),
          bytes = new TextEncoder().encode(text).length;
        if (bytes > RELEASE.inputBytes)
          throw new ReleaseError('MODEL_INPUT_LIMIT', 413);
        const inputBound =
          bytes + new TextEncoder().encode(SYSTEM_POLICY).length + 1024;
        const reserved = neuronEstimate(inputBound, RELEASE.completionTokens);
        const reservedDay = new Date().toISOString().slice(0, 10);
        if (request.signal.aborted)
          throw new ReleaseError('PROVIDER_TIMEOUT', 502);
        const expires = await this.atomic((c) => {
          const g = c.grants[input.grant];
          if (
            !g ||
            g.kind !== 'agent' ||
            g.turn !== input.turn ||
            c.calls >= RELEASE.callsPerDay ||
            c.neurons + reserved > RELEASE.neuronsPerDay
          )
            throw new ReleaseError('AI_QUOTA', 429);
          g.turn++;
          g.uncertain = true;
          c.calls++;
          c.neurons += reserved;
          return g.expires;
        });
        const signal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            Math.max(1, Math.min(RELEASE.modelTimeoutMs, expires - Date.now())),
          ),
        ]);
        let response: Response;
        try {
          if (signal.aborted) throw new ReleaseError('PROVIDER_TIMEOUT', 502);
          response = await interrupted(
            this.env.AI.run(
              RELEASE.model,
              {
                messages: [
                  { role: 'system', content: SYSTEM_POLICY },
                  { role: 'user', content: text },
                ],
                max_completion_tokens: RELEASE.completionTokens,
                chat_template_kwargs: { enable_thinking: false },
                stream: false,
                n: 1,
                temperature: 0,
              },
              { returnRawResponse: true, signal },
            ),
            signal,
          );
        } catch {
          throw new ReleaseError(
            signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
            502,
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ReleaseError(
            response.status === 429 ? 'PROVIDER_QUOTA' : 'PROVIDER_ERROR',
            502,
          );
        }
        const output = nativeResponse.safeParse(
          await readJson(response, 64 * 1024, signal),
        );
        if (!output.success) throw new ReleaseError('PROVIDER_SHAPE', 502);
        const { prompt_tokens: prompt, completion_tokens: completion } =
          output.data.usage;
        // A cap violation fails closed and retains the full conservative reservation.
        if (prompt > inputBound)
          throw new ReleaseError('PROVIDER_TOKEN_BOUND', 502);
        let raw: unknown;
        try {
          const content = output.data.choices[0].message.content;
          if (new TextEncoder().encode(content).length > RELEASE.outputBytes)
            throw new Error();
          raw = JSON.parse(content);
        } catch {
          throw new ReleaseError('INVALID_MODEL_RESPONSE', 502);
        }
        const decision = decisionSchema.safeParse(raw);
        if (!decision.success)
          throw new ReleaseError('INVALID_MODEL_RESPONSE', 502);
        await this.atomic((c) => {
          if (c.grants[input.grant]) c.grants[input.grant].uncertain = false;
          if (c.day === reservedDay)
            c.neurons = Math.max(
              0,
              c.neurons - reserved + neuronEstimate(prompt, completion),
            );
        });
        return safeJson({ decision: decision.data, bindingResponse: true });
      }
      for (const [id, draft] of this.drafts)
        if (draft.expires <= Date.now()) this.drafts.delete(id);
      if (url.pathname === '/draft') {
        const input = z
          .object({
            principal,
            runId: z.string().uuid(),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            result: z.unknown(),
          })
          .strict()
          .parse(body);
        if (this.drafts.size >= 4) throw new ReleaseError('DRAFT_LIMIT', 429);
        this.drafts.set(input.runId, {
          principal: input.principal,
          digest: input.digest,
          result: input.result,
          expires: Date.now() + RELEASE.draftMs,
        });
        return safeJson({ ok: true });
      }
      if (url.pathname === '/approve') {
        const input = z
          .object({
            principal,
            runId: z.string().uuid(),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .parse(body);
        const draft = this.drafts.get(input.runId);
        if (
          !draft ||
          draft.principal !== input.principal ||
          draft.digest !== input.digest
        )
          throw new ReleaseError('DRAFT_EXPIRED', 410);
        this.drafts.delete(input.runId); // One use, even across Node instances.
        return safeJson({ result: draft.result });
      }
      throw new ReleaseError('NOT_FOUND', 404);
    } catch (error) {
      return safeJson(
        {
          error: {
            code:
              error instanceof ReleaseError ? error.code : 'INVALID_REQUEST',
          },
        },
        error instanceof ReleaseError ? error.status : 400,
      );
    }
  }
}
export default {
  async fetch(request: Request, env: RelayEnvironment) {
    if (
      !env.RELAY_SECRET ||
      env.RELAY_SECRET.length < 32 ||
      request.headers.get('Authorization') !== `Bearer ${env.RELAY_SECRET}` ||
      request.headers.has('Origin')
    )
      return safeJson({ error: { code: 'UNAUTHORIZED' } }, 401);
    return env.REVIEW_BUDGET.get(
      env.REVIEW_BUDGET.idFromName('prism-global-v1'),
    ).fetch(request);
  },
};
