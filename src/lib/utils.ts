import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
