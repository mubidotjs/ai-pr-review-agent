// Exact wire vocabulary. Never reflect arbitrary error messages, schema issues,
// provider bodies, or even unrecognized uppercase strings into agent results.
export const RELAY_ERROR_CODES = [
  'UNAUTHORIZED',
  'REJECTED_ROUTE',
  'INVALID_BODY',
  'BODY_LIMIT',
  'TIMEOUT',
  'INVALID_REQUEST',
  'INVALID_CONTRACT',
  'MODEL_INPUT_LIMIT',
  'AI_QUOTA',
  'REVIEW_LIMIT',
  'LOGIN_LIMIT',
  'DRAFT_LIMIT',
  'DRAFT_EXPIRED',
  'NOT_FOUND',
  'PROVIDER_TIMEOUT',
  'NODE_RELAY_DEADLINE',
  'NATIVE_INVOCATION_DEADLINE',
  'REVIEW_GRANT_EXPIRED',
  'REVIEW_DEADLINE',
  'RESPONSE_VALIDATION_TIMEOUT',
  'PROVIDER_QUOTA',
  'PROVIDER_ERROR',
  'PROVIDER_SHAPE',
  'PROVIDER_TOKEN_BOUND',
  'INVALID_MODEL_RESPONSE',
  'MODEL_JSON_INVALID',
  'MODEL_ACTION_UNSUPPORTED',
  'MODEL_SCHEMA_INVALID',
  'MODEL_OUTPUT_LIMIT',
  'RELAY_UNAVAILABLE',
  'RELAY_RESPONSE_INVALID',
  'RELAY_ROUTE',
] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];
const known: ReadonlySet<string> = new Set(RELAY_ERROR_CODES);
export function relayErrorCode(value: unknown): RelayErrorCode | undefined {
  return typeof value === 'string' && known.has(value)
    ? (value as RelayErrorCode)
    : undefined;
}
