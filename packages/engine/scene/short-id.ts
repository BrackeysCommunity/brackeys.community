/** How many characters of a release or scene version id a short id keeps. */
export const SHORT_ID_LENGTH = 6;

/** An id's first characters, for a line that names a release or version: `3fa9c2…`. */
export const shortId = (id: string): string => `${id.slice(0, SHORT_ID_LENGTH)}…`;

/**
 * How many characters of a version hash an issue keeps when no number names
 * the version: enough to find it among a project's stored versions.
 */
export const HASH_ID_LENGTH = 12;

/** A version hash's first characters, for an issue that has no number to name it by: `3fa9c2d81b07`. */
export const hashId = (id: string): string => id.slice(0, HASH_ID_LENGTH);
