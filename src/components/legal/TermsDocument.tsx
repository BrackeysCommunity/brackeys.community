import { CONTACT, OPERATOR, SITE } from "@/lib/legal-meta";

import { LegalDocument, type LegalSection } from "./LegalDocument";

/**
 * The Terms of Service. American spelling and drafting conventions
 * throughout, because the governing law clause is a US one.
 *
 * Anything a reader could check against the running site — what sign-in
 * requires, what a linked account authorizes, what survives deletion — is
 * written to match the code, not to be maximally protective. Where the two
 * ever diverge, the code is the bug.
 */

const A = "text-accent underline underline-offset-2 hover:text-accent/80";

const SECTIONS: LegalSection[] = [
  {
    id: "acceptance",
    heading: "Acceptance of these Terms",
    body: (
      <>
        <p>
          These Terms of Service (the "Terms") form a binding agreement between you and{" "}
          {OPERATOR.legalName} ("{SITE.name}", "we", "us", or "our") and govern your access to and
          use of {SITE.domain}, together with every page, feature, and service offered on it (the
          "Service").
        </p>
        <p>
          By creating an account, signing in, or otherwise using the Service, you acknowledge that
          you have read and understood these Terms and agree to be bound by them, together with our{" "}
          <a href="/privacy" className={A}>
            Privacy Policy
          </a>
          , which is incorporated into these Terms by reference. If you do not agree, you must not
          use the Service.
        </p>
        <p>
          If you are accepting these Terms on behalf of a company, studio, team, or other
          organization, you represent that you have authority to bind that organization, and "you"
          refers to both you and that organization.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    heading: "Eligibility",
    body: (
      <>
        <p>You may use the Service only if all of the following are true:</p>
        <ol>
          <li>
            You are at least 13 years of age, or at least 16 years of age if you reside in the
            European Economic Area, the United Kingdom, or Switzerland. Where the law of your
            country of residence sets a higher minimum age for consent to online services, that
            higher age applies to you.
          </li>
          <li>
            You hold a Discord account in good standing, which is presently the only means of
            signing in to the Service, and you are not barred from using Discord under its own
            terms.
          </li>
          <li>
            You have not previously been suspended, removed, or banned from the Service or from the
            Brackeys Discord server, unless that decision has since been reversed on appeal.
          </li>
          <li>
            You are not barred from receiving the Service under the laws of the United States or of
            any other jurisdiction that applies to you, including applicable trade sanctions and
            export-control laws.
          </li>
        </ol>
        <p>
          The Service is not directed to children under 13, and we do not knowingly collect personal
          information from them. If we learn that an account belongs to a person below the
          applicable minimum age, we will close it and delete the associated information as
          described in the{" "}
          <a href="/privacy" className={A}>
            Privacy Policy
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    heading: "Accounts and sign-in",
    body: (
      <>
        <p>
          Accounts on the Service are created by signing in through Discord. We do not issue or
          store a password for your account, and we do not offer any other method of sign-in. Your
          continued access therefore depends on your Discord account remaining available to you;
          securing that account, including any second factor on it, is your responsibility.
        </p>
        <p>
          You agree to provide accurate information in your profile, to keep it reasonably current,
          and not to impersonate any other person, member, moderator, or organization. You are
          responsible for all activity that occurs under your account.
        </p>
        <p>
          You may hold only one account at a time. Creating an additional account in order to evade
          a suspension, a ban, a block placed by another member, or any other moderation decision is
          a material breach of these Terms, and we may close every account we reasonably associate
          with the evasion.
        </p>
        <p>
          Certain areas of the Service, including moderation tools and administrative pages, are
          available only to members holding designated roles in the Brackeys Discord server. Those
          roles are granted, changed, and withdrawn in the Discord server at the discretion of its
          staff, and confer no rights under these Terms.
        </p>
        <p>
          You may close your account at any time from your account settings. Closure is confirmed by
          a link sent to your email address, and its effects on your information are described in
          the{" "}
          <a href="/privacy" className={A}>
            Privacy Policy
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    heading: "Your Content and the license you grant",
    body: (
      <>
        <p>
          "Your Content" means anything you submit to, upload to, or display on the Service,
          including your profile text and images, collaboration posts and responses, team pages and
          invitations, project entries and cover images, comments, and notes left on member
          profiles.
        </p>
        <p>
          As between you and us, you retain all ownership rights in Your Content. We claim no
          ownership in it.
        </p>
        <p>
          You grant us a worldwide, non-exclusive, royalty-free, fully paid, transferable, and
          sublicensable license to host, store, reproduce, adapt for display, publish, and
          distribute Your Content, solely for the purposes of operating, providing, securing,
          moderating, and promoting the Service. This license exists so that the Service can
          function as intended — a profile that cannot be shown to visitors is not a profile — and
          it ends when Your Content is removed from the Service, except that (i) copies retained in
          routine backups persist until those backups are overwritten in the ordinary course, and
          (ii) the exceptions in the paragraph on deletion below continue to apply.
        </p>
        <p>You represent and warrant that, for all of Your Content:</p>
        <ol>
          <li>
            you own it or otherwise hold all rights necessary to grant the license above, including
            the rights of every collaborator credited in it;
          </li>
          <li>
            it does not infringe or misappropriate any copyright, trademark, trade secret, privacy,
            publicity, or other right of any third party; and
          </li>
          <li>it does not violate these Terms or any applicable law.</li>
        </ol>
        <p>
          <strong>Deletion and what survives it.</strong> When you delete an item, or close your
          account, we remove Your Content from the Service, with three deliberate exceptions. First,
          comments you have written are redacted rather than erased, so that the replies beneath
          them remain readable. Second, a credit naming you as a contributor to a project survives
          on that project's page, because the project belongs to everyone credited on it and a
          shipped credit is a matter of record. Third, moderation records are retained as described
          in the section on moderation. Where a record is retained, it is retained in the most
          limited form that serves its purpose.
        </p>
        <p>
          You are solely responsible for keeping your own copies of Your Content. The Service is not
          a backup service, and we do not undertake to preserve or return Your Content.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    heading: "Acceptable use",
    body: (
      <>
        <p>
          The rules of the Brackeys Discord server apply on the Service in full and are incorporated
          into these Terms by reference. They are published in the{" "}
          <a href={SITE.discord} target="_blank" rel="noopener noreferrer" className={A}>
            Discord server
          </a>{" "}
          and may be updated there from time to time. Where a rule and these Terms address the same
          conduct, the stricter of the two applies.
        </p>
        <p>In addition, and without limiting those rules, you must not:</p>
        <ol>
          <li>
            harass, threaten, defame, stalk, or incite violence against any person, or post content
            that is hateful or discriminatory on the basis of race, ethnicity, national origin,
            religion, disability, age, sex, gender identity, or sexual orientation;
          </li>
          <li>
            post sexually explicit material, material that sexualizes minors, or material depicting
            gratuitous violence;
          </li>
          <li>
            post unsolicited advertising, chain messages, referral or affiliate schemes, paid
            promotion that is not disclosed, or repetitive content posted to gain visibility;
          </li>
          <li>
            misrepresent a collaboration opportunity, including its compensation, its scope, or the
            identity or experience of the party offering it;
          </li>
          <li>
            post another person's private information, including a home address, telephone number,
            workplace, or government identifier, without that person's consent;
          </li>
          <li>
            upload malware, or post links intended to defraud, phish for credentials, or otherwise
            compromise another member;
          </li>
          <li>
            probe, scan, or test the vulnerability of the Service, breach or circumvent any security
            or authentication measure, access any account or data you are not authorized to access,
            or interfere with the Service's operation or with any other member's use of it;
          </li>
          <li>
            use automated means to access the Service, extract data from it in bulk, or place
            unreasonable load on it, except that a well-behaved search-engine crawler may index
            pages that are publicly reachable;
          </li>
          <li>
            circumvent, disable, or defeat any rate limit, content filter, block, or other technical
            measure the Service applies; or
          </li>
          <li>
            use the Service for any unlawful purpose, or encourage or enable any third party to do
            any of the above.
          </li>
        </ol>
        <p>
          We apply automated screening to certain submitted text and may reject or hold content on
          that basis. Automated screening is an imperfect first pass and neither approves content
          nor limits what may later be removed on review.
        </p>
      </>
    ),
  },
  {
    id: "connected-accounts",
    heading: "Connected third-party accounts",
    body: (
      <>
        <p>
          Signing in through Discord, and optionally connecting a GitHub or itch.io account,
          authorizes us to access certain information from those services on your behalf. What each
          connection permits is set out below and is limited to the permissions you approve at the
          time of connecting.
        </p>
        <ol>
          <li>
            <strong>Discord (required).</strong> Your account identity and avatar, the servers you
            belong to, and your membership details in the Brackeys server, including your nickname
            there, your roles, and the date you joined. Roles determine whether staff features are
            available to you, so this information is refreshed each time you sign in.
          </li>
          <li>
            <strong>GitHub (optional).</strong> Your public profile — username, display name,
            avatar, biography, profile address — and your public contribution activity, which is
            displayed on your profile.
          </li>
          <li>
            <strong>itch.io (optional).</strong> Your account profile and the list of games on it,
            which you may import into your profile as project entries. Where a jam entry on itch.io
            matches your connected account, the Service may associate the two.
          </li>
        </ol>
        <p>
          You may disconnect an optional account at any time from your profile, which revokes our
          further access and removes the stored authorization. You may also revoke access from the
          provider's own settings, in which case the connection will stop working here.
          Disconnecting does not by itself delete entries you have already imported and chosen to
          display; you may delete those separately.
        </p>
        <p>
          Your use of Discord, GitHub, and itch.io is governed by those services' own terms and
          privacy policies, not by these Terms. We are not responsible for their availability, their
          content, or their acts and omissions, and nothing on the Service should be taken as a
          statement made by them.
        </p>
      </>
    ),
  },
  {
    id: "collaboration",
    heading: "Collaboration, teams, and dealings between members",
    body: (
      <>
        <p>
          The Service provides a venue in which members may describe projects, state their
          availability, post and answer collaboration opportunities, form teams, and credit one
          another. It is a listing and introduction venue and nothing more.
        </p>
        <p>
          <strong>We are not a party to your arrangements.</strong> Any agreement you reach with
          another member — paid or unpaid, written or informal, concerning work, revenue share,
          credit, ownership of intellectual property, or anything else — is solely between you and
          that member. We are not a party to it, do not supervise it, do not hold or transmit funds,
          do not act as an employer, employment agency, staffing agency, escrow agent, or broker,
          and do not guarantee that anyone will perform.
        </p>
        <p>
          <strong>Listings are not offers, and we do not verify them.</strong> Compensation figures,
          rates, availability, skills, credits, past projects, and every other statement a member
          makes on the Service are that member's own representations. We do not verify identity,
          qualifications, or the accuracy of any listing, and we do not screen members for
          suitability. You are responsible for your own diligence before entering into any
          arrangement, and for complying with the tax, employment, and other laws that apply to it.
        </p>
        <p>
          <strong>Teams.</strong> A member who creates a team may invite others, remove members,
          transfer or relinquish ownership, and edit what the team displays. Teams that go inactive
          may be archived automatically after notice. Membership of a team on the Service creates no
          partnership, joint venture, or legal entity of any kind between its members, and confers
          no ownership in anything.
        </p>
        <p>
          You agree that any dispute arising from your dealings with another member is between you
          and that member, and you release us from all claims, demands, and damages of every kind
          arising out of or connected with such disputes. You may still report conduct that breaches
          these Terms, and we may act on it, but doing so is a moderation decision and not the
          resolution of your dispute.
        </p>
      </>
    ),
  },
  {
    id: "jams",
    heading: "Game jams and third-party listings",
    body: (
      <>
        <p>
          The Service lists game jams, their submissions, and their results. That information is
          collected from publicly available pages on itch.io, where the jams themselves are hosted
          and run. We do not host, organize, judge, or administer those jams, we do not control
          their rules or their outcomes, and we do not accept submissions.
        </p>
        <p>
          Jam listings are provided for information only. They may be incomplete, out of date, or
          inaccurate, and a jam's own page on itch.io always prevails over what is shown here. Dates
          and countdowns are presented in Coordinated Universal Time. To enter a jam, follow its own
          submission process on itch.io and comply with the terms of that platform and of the jam's
          organizer.
        </p>
        <p>
          Titles, cover images, descriptions, ratings, and author names shown in jam listings remain
          the property of their respective owners and are displayed as a reference to publicly
          posted material. If you are an author and would prefer that a listing not appear, write to{" "}
          <a href={`mailto:${CONTACT.abuse}`} className={A}>
            {CONTACT.abuse}
          </a>{" "}
          and we will remove it.
        </p>
        <p>
          We are not affiliated with, endorsed by, or sponsored by itch.io, Discord, GitHub, or any
          jam organizer.
        </p>
      </>
    ),
  },
  {
    id: "our-ip",
    heading: "Our intellectual property; feedback",
    body: (
      <>
        <p>
          The Service itself — including its software, design, layout, text, graphics, and the
          arrangement and selection of the material on it, but excluding Your Content and other
          members' content — is owned by us or our licensors and is protected by copyright,
          trademark, and other laws. Subject to your compliance with these Terms, we grant you a
          personal, non-exclusive, non-transferable, revocable license to access and use the Service
          for its intended purpose. No other rights are granted, whether by implication or
          otherwise.
        </p>
        <p>
          The name Brackeys, the Brackeys logo, and associated marks may not be used without prior
          written permission, except to refer accurately to the community or the Service.
        </p>
        <p>
          If you send us suggestions, feature requests, or other feedback, you grant us an
          unrestricted, irrevocable, perpetual, royalty-free right to use it for any purpose without
          obligation, attribution, or compensation to you. Please do not send us anything you regard
          as confidential.
        </p>
      </>
    ),
  },
  {
    id: "moderation",
    heading: "Moderation, suspension, and termination",
    body: (
      <>
        <p>
          We may remove, hide, edit, or restrict access to any content, and may warn, restrict,
          suspend, or permanently ban any account, where we reasonably believe these Terms or the
          community rules have been breached, where required by law, or where necessary to protect
          members, the public, or the Service.
        </p>
        <p>
          We aim to act proportionately and, where circumstances permit, to give notice of the
          reason. We may act without prior notice where the breach is serious, ongoing, or urgent.
          We are not obliged to monitor content, and the fact that content remains available is not
          an endorsement of it or a decision that it complies with these Terms.
        </p>
        <p>
          <strong>Reporting.</strong> Members may report collaboration posts and comments from the
          Service, and may block another member, which hides each from the other and stops
          notifications passing between them. Reports of urgent harm should go to the Brackeys
          Discord moderators or to{" "}
          <a href={`mailto:${CONTACT.abuse}`} className={A}>
            {CONTACT.abuse}
          </a>
          . Reports made in bad faith, or in volume, may themselves be treated as a breach.
        </p>
        <p>
          <strong>Appeals.</strong> If you believe a decision was mistaken, you may appeal to{" "}
          <a href={`mailto:${CONTACT.abuse}`} className={A}>
            {CONTACT.abuse}
          </a>{" "}
          within 30 days. Set out the account concerned and why the decision was wrong. Appeals are
          reviewed, where practicable, by a moderator who was not involved in the original decision,
          and the outcome is final.
        </p>
        <p>
          <strong>Retention of moderation records.</strong> Records of warnings, removals,
          suspensions, and bans are retained even after an account is closed, and are not erased by
          deleting your account. This is deliberate and necessary: without it, closing and reopening
          an account would erase the history that makes a ban meaningful. Retained records are kept
          in a minimized form, as described in the{" "}
          <a href="/privacy" className={A}>
            Privacy Policy
          </a>
          .
        </p>
        <p>
          You may stop using the Service at any time. Sections that by their nature should survive
          termination — including those on Your Content, our intellectual property, disclaimers,
          limitation of liability, indemnification, and governing law — survive it.
        </p>
      </>
    ),
  },
  {
    id: "copyright",
    heading: "Copyright complaints",
    body: (
      <>
        <p>
          We respond to notices of alleged copyright infringement in accordance with the Digital
          Millennium Copyright Act, 17 U.S.C. § 512, and will terminate the accounts of repeat
          infringers in appropriate circumstances.
        </p>
        <p>
          To submit a notice, write to our designated agent at{" "}
          <a href={`mailto:${CONTACT.legal}`} className={A}>
            {CONTACT.legal}
          </a>
          , which is the address for notices under this section, and include:
        </p>
        <ol>
          <li>your physical or electronic signature;</li>
          <li>identification of the copyrighted work you claim has been infringed;</li>
          <li>
            identification of the material you claim is infringing, with enough detail for us to
            locate it, such as the address of the page it appears on;
          </li>
          <li>your name, address, telephone number, and email address;</li>
          <li>
            a statement that you have a good-faith belief that the use is not authorized by the
            copyright owner, its agent, or the law; and
          </li>
          <li>
            a statement, made under penalty of perjury, that the information in your notice is
            accurate and that you are the copyright owner or authorized to act on the owner's
            behalf.
          </li>
        </ol>
        <p>
          If your material was removed and you believe that removal was mistaken, you may send a
          counter-notice to the same address containing the elements required by 17 U.S.C. §
          512(g)(3). Knowingly making a material misrepresentation in a notice or counter-notice may
          expose you to liability for damages under 17 U.S.C. § 512(f).
        </p>
      </>
    ),
  },
  {
    id: "availability",
    heading: "Availability and changes to the Service",
    body: (
      <>
        <p>
          The Service is provided by volunteers of the Brackeys community. We may change, suspend,
          limit, or discontinue the Service or any part of it at any time, and we do not guarantee
          that it will be available without interruption or free of error. Features may be tested
          with a subset of members before wider release, or withdrawn.
        </p>
        <p>
          The Service is presently offered at no charge. If we introduce paid features, we will
          publish their terms and prices before you can incur any charge, and no charge will apply
          to anything you use today.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    heading: "Disclaimers",
    body: (
      <>
        <p>
          THE SERVICE AND ALL CONTENT ON IT ARE PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT
          WARRANTY OF ANY KIND. TO THE FULLEST EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES,
          EXPRESS, IMPLIED, OR STATUTORY, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT, AND ANY WARRANTY ARISING
          FROM COURSE OF DEALING OR USAGE OF TRADE.
        </p>
        <p>
          WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, THAT
          DEFECTS WILL BE CORRECTED, THAT ANY CONTENT OR LISTING IS ACCURATE OR COMPLETE, OR THAT
          THE SERVICE IS FREE OF HARMFUL COMPONENTS. YOU USE THE SERVICE AT YOUR OWN RISK.
        </p>
        <p>
          WE MAKE NO WARRANTY REGARDING ANY MEMBER, ANY CONTENT A MEMBER POSTS, OR ANY TRANSACTION
          OR COLLABORATION YOU ENTER INTO THROUGH THE SERVICE, AND NO WARRANTY REGARDING ANY
          THIRD-PARTY SERVICE, INCLUDING DISCORD, GITHUB, AND ITCH.IO.
        </p>
        <p>
          Some jurisdictions do not allow the exclusion of implied warranties, so parts of this
          section may not apply to you. Nothing in these Terms excludes liability that cannot be
          excluded under the law that applies to you.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    heading: "Limitation of liability",
    body: (
      <>
        <p>
          TO THE FULLEST EXTENT PERMITTED BY LAW, NEITHER WE NOR OUR MODERATORS, CONTRIBUTORS,
          OFFICERS, OR AGENTS WILL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
          EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, GOODWILL, DATA, OR
          BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE, WHETHER IN
          CONTRACT, TORT, OR ON ANY OTHER BASIS, AND WHETHER OR NOT WE HAVE BEEN ADVISED OF THE
          POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p>
          TO THE FULLEST EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR
          RELATING TO THESE TERMS OR THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE TOTAL AMOUNT
          YOU PAID US FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE EVENT GIVING RISE TO THE
          CLAIM, AND (B) ONE HUNDRED UNITED STATES DOLLARS (US$100).
        </p>
        <p>
          These limits apply even if a limited remedy fails of its essential purpose. Some
          jurisdictions do not allow certain limitations, so parts of this section may not apply to
          you.
        </p>
      </>
    ),
  },
  {
    id: "indemnification",
    heading: "Indemnification",
    body: (
      <p>
        You agree to indemnify, defend, and hold harmless {OPERATOR.legalName} and its moderators,
        contributors, officers, and agents from and against any claim, demand, loss, liability, or
        expense, including reasonable legal fees, arising out of or relating to (i) Your Content,
        (ii) your use of the Service, (iii) your breach of these Terms or of any applicable law, or
        (iv) your dealings or disputes with any other member or third party. We may assume the
        exclusive defense of any matter subject to indemnification by you, in which case you agree
        to cooperate with us.
      </p>
    ),
  },
  {
    id: "governing-law",
    heading: "Governing law and disputes",
    body: (
      <>
        <p>
          The Service is operated from the United States. These Terms and any dispute arising out of
          or relating to them or to the Service are governed by the federal laws of the United
          States and, to the extent applicable, by the law of the state from which the Service is
          operated, in each case without regard to conflict-of-laws principles. The United Nations
          Convention on Contracts for the International Sale of Goods does not apply.
        </p>
        <p>
          Before filing a claim, you agree to try to resolve the dispute informally by writing to{" "}
          <a href={`mailto:${CONTACT.legal}`} className={A}>
            {CONTACT.legal}
          </a>{" "}
          and allowing 30 days for a response. Most disagreements are settled this way.
        </p>
        <p>
          If a dispute is not resolved informally, you and we agree to submit it to the state and
          federal courts of the United States having jurisdiction over the operator of the Service.
          Nothing in this section prevents either party from seeking injunctive relief in any court
          of competent jurisdiction to protect intellectual property or confidential information.
        </p>
        <p>
          If you reside in the European Economic Area, the United Kingdom, or Switzerland, or in
          another jurisdiction whose law grants you the right to bring proceedings in your local
          courts or to the benefit of mandatory local consumer protections, this section does not
          deprive you of those rights.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    heading: "Changes to these Terms",
    body: (
      <p>
        We may revise these Terms from time to time. The date at the top of this page shows when the
        current version took effect. Where a revision materially reduces your rights or increases
        your obligations, we will give reasonable advance notice — by a notice on the Service, by
        email, or in the Brackeys Discord server — before it takes effect. Continuing to use the
        Service after a revision takes effect constitutes acceptance of it. If you do not accept a
        revision, your remedy is to stop using the Service and close your account.
      </p>
    ),
  },
  {
    id: "general",
    heading: "General provisions",
    body: (
      <ol>
        <li>
          <strong>Entire agreement.</strong> These Terms, together with the Privacy Policy and the
          community rules incorporated above, are the entire agreement between you and us regarding
          the Service and supersede any prior understanding on the subject.
        </li>
        <li>
          <strong>Severability.</strong> If any provision is held unenforceable, it will be limited
          or severed to the minimum extent necessary, and the remaining provisions remain in full
          force.
        </li>
        <li>
          <strong>No waiver.</strong> Our failure to enforce a provision is not a waiver of it, and
          any waiver must be in writing to be effective.
        </li>
        <li>
          <strong>Assignment.</strong> You may not assign or transfer these Terms without our prior
          written consent. We may assign them to an affiliate or in connection with a merger,
          acquisition, or transfer of the Service, on notice to you.
        </li>
        <li>
          <strong>No third-party beneficiaries.</strong> These Terms confer no rights on anyone who
          is not a party to them.
        </li>
        <li>
          <strong>Notices.</strong> We may give you notice by email to the address associated with
          your account, by a notice on the Service, or in the Brackeys Discord server. You give us
          notice at the addresses in the final section.
        </li>
        <li>
          <strong>Force majeure.</strong> Neither party is liable for a failure to perform caused by
          circumstances beyond its reasonable control, including outages at a third-party provider
          the Service depends on.
        </li>
        <li>
          <strong>Language.</strong> These Terms are drafted in English. Any translation is provided
          for convenience, and the English version governs.
        </li>
      </ol>
    ),
  },
  {
    id: "contact",
    heading: "How to contact us",
    body: (
      <>
        <p>Written notices under these Terms should be sent to:</p>
        <ul>
          <li>
            General and legal notices —{" "}
            <a href={`mailto:${CONTACT.legal}`} className={A}>
              {CONTACT.legal}
            </a>
          </li>
          <li>
            Reports, appeals, and copyright notices —{" "}
            <a href={`mailto:${CONTACT.abuse}`} className={A}>
              {CONTACT.abuse}
            </a>
          </li>
          <li>
            Privacy requests —{" "}
            <a href={`mailto:${CONTACT.privacy}`} className={A}>
              {CONTACT.privacy}
            </a>
          </li>
        </ul>
        <p>
          For anything that is not a formal notice, the{" "}
          <a href={SITE.discord} target="_blank" rel="noopener noreferrer" className={A}>
            Brackeys Discord server
          </a>{" "}
          is the faster route and a moderator will usually answer the same day.
        </p>
      </>
    ),
  },
];

export function TermsDocument() {
  return (
    <LegalDocument
      marker="§ Legal / Terms"
      title="Terms of Service"
      summary={`The agreement between you and ${SITE.name} covering who may use the site, what you may post, what we may moderate, and where the limits of our responsibility lie.`}
      atAGlance={
        <>
          You keep everything you post here and simply give us permission to display it. You must be
          13 or older, follow the Brackeys community rules, and treat other members decently. Deals
          you strike with other members are yours alone — we run the noticeboard, not the
          negotiation. Jams are hosted on itch.io, not here. Moderators may remove content and close
          accounts, and you may appeal. The site is run by volunteers and comes with no warranty.
        </>
      }
      sections={SECTIONS}
    />
  );
}
