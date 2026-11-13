import { PROBE_INPUT } from '../tests/provider-probe-worker';

type Schema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  additionalProperties?: boolean;
  description?: string;
};
// The native contract's used subset only. No schema-driven execution or codegen.
function matches(value: unknown, schema: Schema): boolean {
  if (schema.anyOf && !schema.anyOf.some((s) => matches(value, s)))
    return false;
  if (
    schema.oneOf &&
    schema.oneOf.filter((s) => matches(value, s)).length !== 1
  )
    return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if ('const' in schema && value !== schema.const) return false;
  if (schema.type === 'null' && value !== null) return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (
    schema.type === 'string' &&
    (typeof value !== 'string' || value.length < (schema.minLength ?? 0))
  )
    return false;
  if (
    schema.type === 'integer' &&
    (typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity))
  )
    return false;
  if (
    schema.type === 'array' &&
    (!Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? Infinity) ||
      (schema.items && !value.every((x) => matches(x, schema.items!))))
  )
    return false;
  if (schema.type === 'object' || schema.properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const object = value as Record<string, unknown>;
    if (schema.required?.some((key) => !(key in object))) return false;
    if (schema.properties)
      for (const [key, entry] of Object.entries(object)) {
        if (!schema.properties[key] || !matches(entry, schema.properties[key]))
          return false;
      }
  }
  return true;
}
export function verifyProbeContract(contract: unknown) {
  const schema = contract as { input?: Schema };
  const messages = schema.input?.anyOf
    ?.flatMap((s) => s.oneOf ?? [])
    .find((s) => s.properties?.messages);
  const props = messages?.properties;
  if (
    !schema.input ||
    !messages?.required?.includes('messages') ||
    !props?.max_completion_tokens?.anyOf?.some((s) => s.type === 'integer') ||
    props.chat_template_kwargs?.properties?.enable_thinking?.type !==
      'boolean' ||
    !matches(PROBE_INPUT, schema.input)
  )
    throw new Error('Fixed request does not match account-native schema');
  return {
    requestValidated: true,
    completionCap: 32,
    reasoningEnabled: false,
    promptUtf8Bytes: new TextEncoder().encode(PROBE_INPUT.messages[0].content)
      .byteLength,
    request: PROBE_INPUT,
  };
}
