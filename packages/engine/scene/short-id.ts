/** How many characters of a release or scene version id a short id keeps. */
export const SHORT_ID_LENGTH = 6;

/** An id's first characters, for a line that names a release or version: `3fa9c2…`. */
export const shortId = (id: string): string => `${id.slice(0, SHORT_ID_LENGTH)}…`;
