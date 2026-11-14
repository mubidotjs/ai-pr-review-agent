import { z } from 'zod';

/** Closed vocabulary only. Never use provider values, error text or Zod issue paths. */
export const providerDiagnosticSchema = z
  .object({
    version: z.literal(1),
    stage: z.enum(['return', 'body', 'envelope', 'field']),
    field: z.enum([
      'return',
      'body',
      'envelope',
      'object',
      'choices',
      'choice',
      'finish_reason',
      'message',
      'message.role',
      'message.content',
      'message.refusal',
      'message.reasoning_content',
      'message.function_call',
      'message.tool_calls',
      'tool_call',
      'tool_call.id',
      'tool_call.type',
      'tool_call.function',
      'tool_call.function.name',
      'tool_call.function.arguments',
      'usage',
      'usage.prompt_tokens',
      'usage.completion_tokens',
      'usage.completion_tokens_details',
      'usage.completion_tokens_details.reasoning_tokens',
    ]),
    issue: z.enum([
      'missing',
      'type',
      'count',
      'value',
      'limit',
      'media-type',
      'used',
      'read',
      'invalid-utf8',
      'invalid-json',
    ]),
    received: z.enum([
      'undefined',
      'null',
      'array',
      'object',
      'string',
      'number',
      'boolean',
      'function',
      'symbol',
      'bigint',
      'response',
      'stream',
    ]),
    httpStatus: z.number().int().min(100).max(599).optional(),
    bodyBytes: z.number().int().min(0).max(65537).optional(),
  })
  .strict();
export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>;
export function safeProviderDiagnostic(value: unknown) {
  const parsed = providerDiagnosticSchema.safeParse(value);
  return parsed.success ? Object.freeze(parsed.data) : undefined;
}
