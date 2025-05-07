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
