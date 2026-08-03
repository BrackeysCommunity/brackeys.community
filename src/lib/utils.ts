import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Elides the middle of a string so both ends stay readable —
 * `truncateMiddle("ludicrously_long_handle", 16)` → `"ludicro…_handle"`.
 *
 * Use where the head and the tail both carry identity (usernames, slugs);
 * a plain `truncate` drops the tail, which is often the distinguishing part.
 *
 * @param value - String to elide.
 * @param max - Maximum length of the result, ellipsis included.
 */
export function truncateMiddle(value: string, max = 24) {
  if (max < 2 || value.length <= max) return value;
  const keep = max - 1; // one char goes to the ellipsis
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${value.slice(0, head)}…${tail > 0 ? value.slice(value.length - tail) : ""}`;
}

/**
 * Reads a CSS custom property from the document root.
 *
 * Accepts either a bare name or one already prefixed with `--` and always
 * resolves to the `--`-prefixed variable. For example, both `"color-blue-500"`
 * and `"--color-blue-500"` return the value of `--color-blue-500`.
 *
 * @param varName - CSS custom property name, with or without a leading `--`.
 * @returns The property's computed value, or an empty string if unset.
 *
 * @example
 * ```ts
 * getStyle("color-blue-500"); // "#3b82f6"
 * getStyle("--color-blue-500"); // "#3b82f6"
 * ```
 */
export function getStyle(varName: string) {
  const normalized = varName.startsWith("--") ? varName : `--${varName}`;
  const doc = getComputedStyle(document.documentElement);
  return doc.getPropertyValue(normalized);
}
