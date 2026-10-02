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

const DOMAIN = "jams.team";

/** Mail stays on the old domain until jams.team has MX, SPF, DKIM and DMARC. */
const MAIL_DOMAIN = "brackeys.community";

/**
 * The site's own identity. Every hard-coded mention of the production
 * domain or name reads from here, so a domain move is an edit to this file.
 * Service images copy it, so it must stay import-free.
 */
export const SITE = {
  name: "Brackeys Community",
  /** The wordmark beside the mark, the email sender name, the manifest `short_name`. */
  shortName: "Brackeys",
  /** The header and footer wordmark: `lead` plain, `accent` in the brand gradient. */
  wordmark: { lead: "Brackeys", accent: "Community" },
  domain: DOMAIN,
  url: `https://${DOMAIN}`,
  discord: "https://discord.gg/brackeys",
} as const;

export const CONTACT = {
  privacy: `privacy@${MAIL_DOMAIN}`,
  legal: `legal@${MAIL_DOMAIN}`,
  /** Reports, appeals, and copyright notices. */
  abuse: `abuse@${MAIL_DOMAIN}`,
  /** Sender address only; nothing reads mail sent to it. */
  noreply: `noreply@${MAIL_DOMAIN}`,
} as const;

/** The date the current version takes effect, as published. */
export const EFFECTIVE_DATE = "17 August 2026";

/** Bumped whenever a section changes in substance, not in wording. */
export const LAST_UPDATED = "17 August 2026";
