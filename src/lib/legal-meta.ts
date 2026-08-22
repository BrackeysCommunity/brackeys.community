/**
 * Single source of truth for the details both legal documents repeat:
 * operator identity, contact addresses, and dates.
 *
 * No registered address, governing state, or venue is named, because no
 * legal entity stands behind the Service yet. The documents are written to
 * read correctly without them — governing law is stated in general United
 * States terms and every notice route is an email address. When an entity
 * is formed, add the state and venue here and tighten the "Governing law
 * and disputes" section in `TermsDocument`; nothing else needs to move.
 */

export const OPERATOR = {
  /**
   * How the operator is named in the documents. Not an incorporated entity
   * — it is the community that runs the Service, named so that the
   * agreement has an identifiable counterparty.
   */
  legalName: "Brackeys Community",
} as const;

export const SITE = {
  name: "Brackeys Community",
  domain: "brackeys.community",
  url: "https://brackeys.community",
  discord: "https://discord.gg/brackeys",
} as const;

export const CONTACT = {
  privacy: "privacy@brackeys.community",
  legal: "legal@brackeys.community",
  /** Reports, appeals, and copyright notices. */
  abuse: "abuse@brackeys.community",
} as const;

/** The date the current version takes effect, as published. */
export const EFFECTIVE_DATE = "17 August 2026";

/** Bumped whenever a section changes in substance, not in wording. */
export const LAST_UPDATED = "17 August 2026";
