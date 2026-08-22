/**
 * The env-parsing scaffold every Bun service's `config.ts` repeats: parse
 * `process.env` against the service's own schema, failing fast at boot.
 *
 * Typed structurally (anything with `parse`) rather than against zod,
 * because each service resolves its own zod from its own `node_modules` —
 * a nominal `ZodType` bound to the root's copy would reject the service's
 * schemas as a different module identity. Import-graph neutral — services
 * reach it by relative path and their Dockerfiles COPY it.
 */
export function parseServiceConfig<T>(schema: { parse: (data: unknown) => T }): T {
  return schema.parse(process.env);
}
