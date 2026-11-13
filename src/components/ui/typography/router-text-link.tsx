import { createLink } from "@tanstack/react-router";

import { Link } from "./link";

/**
 * The typography link as a typed router link: `to`, `params` and `search` are checked
 * against the route tree. Kept out of the barrel so importing typography doesn't call
 * `createLink` at load time.
 */
export const RouterTextLink = createLink(Link);
