/**
 * Serializes an object containing BigInt values to a JSON-compatible object
 * by converting BigInt values to strings
 */
export const serializeBigInt = <T extends Record<string, unknown>>(
  data: T
): Record<string, unknown> => {
  return Object.entries(data).reduce(
    (acc, [key, value]) => {
      if (typeof value === 'bigint') {
        acc[key] = value.toString();
      } else if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) {
        acc[key] = serializeBigInt(value as Record<string, unknown>);
      } else {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, unknown>
  );
};

export const deserializeEFDateBlob = (blob: Buffer): Date => {
  if (!blob || blob.length < 8) {
    throw new Error('We need at least 8 bytes for deserialization');
  }

  const rawTicks = blob.readBigInt64BE(0);
  const ticks = rawTicks & 0x3FFFFFFFFFFFFFFFn;

  // dotnet ticks are from year 1?? this is wild
  // https://learn.microsoft.com/en-us/dotnet/api/system.datetime.ticks?view=net-9.0
  const TICKS_PER_MILLISECOND = 10000n;
  const TICKS_AT_UNIX_EPOCH = 621355968000000000n;
  const jsMillis = Number((ticks - TICKS_AT_UNIX_EPOCH) / TICKS_PER_MILLISECOND);

  return new Date(jsMillis);
};