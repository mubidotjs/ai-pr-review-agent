import { LIMITS } from '../shared/types';
import { ReviewError } from '../shared/errors';
export function decodeSnapshotWire(buffer: ArrayBuffer): unknown {
  const invalid = () =>
    new ReviewError(
      'INVALID_SNAPSHOT',
      'Review input framing is malformed, oversized, or inconsistent.',
    );
  if (buffer.byteLength < 4 || buffer.byteLength > LIMITS.snapshotBytes)
    throw invalid();
  const bytes = new Uint8Array(buffer),
    length = new DataView(buffer).getUint32(0);
  if (length > bytes.byteLength - 4) throw invalid();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const value = JSON.parse(decoder.decode(bytes.subarray(4, 4 + length)));
  if (
    !value ||
    !Array.isArray(value.files) ||
    value.files.length > LIMITS.files
  )
    throw invalid();
  let offset = 4 + length,
    contexts = 0;
  for (const file of value.files) {
    if (!file || typeof file !== 'object') throw invalid();
    if (!file.context) continue;
    const { bytes: count, ...descriptor } = file.context;
    if (
      ++contexts > LIMITS.contextFiles ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > LIMITS.sourceBytes ||
      offset + count > bytes.byteLength ||
      'text' in descriptor
    )
      throw invalid();
    file.context = {
      ...descriptor,
      text: decoder.decode(bytes.subarray(offset, offset + count)),
    };
    offset += count;
  }
  if (offset !== bytes.byteLength) throw invalid();
  return value;
}
