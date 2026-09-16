/**
 * What a member's own site *is*. The LINKED row used to hardcode
 * PORTFOLIO, which is wrong for the people whose link is a blog or a plain
 * homepage — the label is the member's to pick.
 *
 * Ordered most-to-least common so the select reads the same way everywhere,
 * and `null` (every row predating the column) renders as PORTFOLIO, which is
 * what those rows already said.
 */

export const WEBSITE_LINK_TYPES = ["portfolio", "website", "blog"] as const;
export type WebsiteLinkType = (typeof WEBSITE_LINK_TYPES)[number];

export const DEFAULT_WEBSITE_LINK_TYPE: WebsiteLinkType = "portfolio";

/** The LINKED row's uppercase label and the monogram in its leading well,
 *  plus the sentence-case spelling the editor's select reads in. */
const TYPES: Record<WebsiteLinkType, { label: string; option: string; monogram: string }> = {
  portfolio: { label: "PORTFOLIO", option: "Portfolio", monogram: "PF" },
  website: { label: "WEBSITE", option: "Website", monogram: "WE" },
  blog: { label: "BLOG", option: "Blog", monogram: "BL" },
};

export const WEBSITE_LINK_TYPE_OPTIONS: { value: WebsiteLinkType; label: string }[] =
  WEBSITE_LINK_TYPES.map((value) => ({ value, label: TYPES[value].option }));

function resolve(value: string | null | undefined) {
  return TYPES[(value ?? "") as WebsiteLinkType] ?? TYPES[DEFAULT_WEBSITE_LINK_TYPE];
}

export function websiteLinkLabel(value: string | null | undefined): string {
  return resolve(value).label;
}

export function websiteLinkMonogram(value: string | null | undefined): string {
  return resolve(value).monogram;
}

/** Whether a LINKED row already occupies the member's-own-site slot — a
 *  connected provider that calls itself one of these wins, and the row
 *  synthesized from `websiteUrl` stands down. */
export function isWebsiteLinkLabel(label: string): boolean {
  return WEBSITE_LINK_TYPES.some((type) => TYPES[type].label === label);
}
