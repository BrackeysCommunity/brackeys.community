import { CONTACT, OPERATOR, SITE } from "./legal-meta";
import { LegalDocument, type LegalSection } from "./LegalDocument";

/**
 * The Privacy Policy. Every claim here is meant to be checkable against the
 * running code — the fields listed are the columns we actually write, the
 * processors listed are the ones a request actually reaches. Changing what
 * the app collects, stores, or sends means changing this file in the same
 * commit.
 */

const A = "text-accent underline underline-offset-2 hover:text-accent/80";

const SECTIONS: LegalSection[] = [
  {
    id: "scope",
    heading: "Scope of this notice",
    body: (
      <>
        <p>
          This Privacy Policy explains how {OPERATOR.legalName} ("{SITE.name}", "we", "us", or
          "our") collects, uses, discloses, and retains personal information in connection with{" "}
          {SITE.domain} and the features offered on it (the "Service"). For the purposes of the
          General Data Protection Regulation and the UK GDPR, we are the controller of that
          information.
        </p>
        <p>
          This notice does not cover the Brackeys Discord server, which is operated on Discord's
          platform under Discord's own privacy policy, nor GitHub, itch.io, or any other site the
          Service links to. Reading their notices is worthwhile: much of what appears on your
          profile here originates there.
        </p>
      </>
    ),
  },
  {
    id: "what-we-collect",
    heading: "Information we collect",
    body: (
      <>
        <p>
          <strong>a. Information from your Discord sign-in.</strong> Signing in is only possible
          through Discord. When you do, we receive and store your Discord account identifier,
          username, display name, avatar, and email address, together with your membership details
          in the Brackeys server — your nickname there, your assigned roles, and the date you
          joined. Roles and nickname are refreshed each time you sign in, so that staff permissions
          and displayed names stay current.
        </p>
        <p>
          <strong>b. Information from accounts you choose to connect.</strong> If you connect a
          GitHub account, we receive your username, display name, avatar, biography, profile
          address, and public contribution activity. If you connect an itch.io account, we receive
          your account profile and the list of games on it, so that you may import them as project
          entries. For each connection we also store the access credential the provider issues,
          encrypted at rest, so that the connection can be refreshed without asking you to
          re-authorize it. We retain the provider's response as returned, for audit and for
          re-importing.
        </p>
        <p>
          <strong>c. Information you provide.</strong> Your biography, tagline, links, availability
          and rate range, what you are looking for, your collaboration preferences, your time zone
          and a free-text location, your stated skills and roles, your project entries and their
          cover images, your collaboration posts and responses, teams you create or join, comments
          and replies, notes left on member profiles, reports you file, and any correspondence you
          send us.
        </p>
        <p>
          <strong>d. Information collected automatically.</strong> Each sign-in creates a session
          record holding your Internet Protocol address, your browser's user-agent string, and the
          times the session was created and expires. Our servers keep short-lived operational
          records: counters that enforce rate limits, a transient note of whether you have the site
          open — held for about a minute at a time, and used to avoid emailing you about something
          you are already watching happen — and a short-lived cache of your Discord roles. We also
          collect usage analytics and error reports, described in their own section below.
        </p>
        <p>
          <strong>e. Information from public sources.</strong> The Service maintains a catalogue of
          game jams collected from publicly available pages on itch.io. That catalogue includes jam
          titles, descriptions, dates, and results, and the titles, cover images, author names, and
          author profile addresses of submitted entries. Some of that information relates to people
          who have no account here. We collect it only as it is publicly posted, and any person
          named in it may ask us to remove it as described in the section on your rights.
        </p>
        <p>
          We do not collect payment information, government identifiers, or precise geolocation, and
          we do not ask for special categories of personal data. Please do not put such information
          into free-text fields.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use",
    heading: "How we use information, and on what basis",
    body: (
      <>
        <p>We use personal information for the following purposes:</p>
        <ol>
          <li>
            <strong>To provide the Service</strong> — creating and maintaining your account,
            rendering your profile and the member directory, running the collaboration board and
            teams, importing and displaying projects, delivering notifications, and keeping you
            signed in. Where you are in the EEA or the UK, our basis is performance of our contract
            with you.
          </li>
          <li>
            <strong>To keep the Service safe and working</strong> — authenticating requests,
            enforcing rate limits, screening submitted text, investigating reports, applying
            moderation decisions, preventing ban evasion and abuse, and diagnosing errors. Our basis
            is our legitimate interest in a functioning and safe community, and, for the record of
            moderation decisions, our legitimate interest in the integrity of those decisions.
          </li>
          <li>
            <strong>To understand how the Service is used</strong> — measuring which pages and
            features are opened so that we can decide what to build, and staging new features to a
            subset of members. Our basis is our legitimate interest in improving the Service; you
            may object at any time by switching analytics off, as described below.
          </li>
          <li>
            <strong>To communicate with you</strong> — sending notification and digest email you
            have asked for, and account or security messages such as confirming a deletion request.
            Our basis is performance of our contract with you and, for messages you have opted into,
            your consent.
          </li>
          <li>
            <strong>To comply with law</strong> — responding to lawful requests and enforcing our{" "}
            <a href="/terms" className={A}>
              Terms of Service
            </a>
            . Our basis is compliance with a legal obligation and our legitimate interest in
            establishing or defending legal claims.
          </li>
        </ol>
        <p>
          Where we rely on legitimate interests, we have considered whether those interests are
          overridden by your rights, and you may object as set out below.
        </p>
        <p>
          We do not make decisions producing legal or similarly significant effects about you by
          automated means alone. Automated screening of submitted text may hold or reject a
          submission, but a moderator's decision is what suspends or removes an account, and you may
          appeal it.
        </p>
      </>
    ),
  },
  {
    id: "public",
    heading: "What other people can see",
    body: (
      <>
        <p>
          Much of the Service is public by design. The following are visible to anyone on the
          internet, whether or not they hold an account: your display name and avatar, your profile
          address, your biography, tagline, links, stated skills and roles, availability and rate
          range, time zone and location as you have written it, your project entries, your entry in
          the member directory, your collaboration posts, your teams and their pages, your comments,
          and notes left on your profile.
        </p>
        <p>
          The following are not public: your email address, your session records, the credentials
          for your connected accounts, your notification preferences and blocked-member list, your
          responses to another member's collaboration post — visible to that member and to
          moderators — and reports you file, which are visible to moderators.
        </p>
        <p>
          You have direct control over several of these. The note wall on your profile can be turned
          off in Settings, which hides existing notes from visitors without deleting them. Blocking
          a member hides each of you from the other's comments and stops notifications passing
          between you. Project entries can be deleted individually, and connected accounts can be
          disconnected.
        </p>
        <p>
          Please treat anything you post publicly as public permanently. Others may read it, quote
          it, screenshot it, or archive it, and search engines may index it. Removing something here
          does not remove copies made elsewhere.
        </p>
      </>
    ),
  },
  {
    id: "cookies-analytics",
    heading: "Cookies, analytics, and information stored in your browser",
    body: (
      <>
        <p>
          <strong>Cookies.</strong> We set only cookies that are strictly necessary to operate the
          Service: one that keeps you signed in after you authenticate, and short-lived ones set
          during sign-in to verify that the request completing it is the same one that began it. We
          set no advertising cookies and no cross-site tracking cookies, and no third party sets a
          cookie through the Service for its own purposes; our network provider may set a strictly
          necessary cookie to tell automated traffic from human traffic. That is why you are not
          shown a cookie banner.
        </p>
        <p>
          <strong>Analytics.</strong> We use PostHog, hosted on servers in the European Union, to
          measure how the Service is used, to record errors, and to control the staged release of
          new features. It is configured to run without cookies: nothing is written to your browser
          to identify you, no device fingerprint is taken, and you are not tracked across other
          websites. Anonymous visitors are counted using an identifier PostHog derives on its own
          servers and rotates every day, which means a returning visitor is counted afresh the next
          day and visitor totals should be read as approximate. When you are signed in, we attach
          your account identifier, display name, and email address to your events so that we can
          answer support questions and connect an error report to the account that hit it. That
          attachment lasts only as long as the page is open and is dropped when you sign out.
        </p>
        <p>
          <strong>Error reporting.</strong> When something goes wrong, we record the error message,
          the technical trace, the page it happened on, and the version of the Service you were
          running. Errors raised by our servers are recorded without being attributed to a person.
        </p>
        <p>
          <strong>Turning analytics off.</strong> Settings → Privacy has a single switch. Turning it
          off stops all of the above before anything is sent — the analytics software is not loaded
          at all — and the choice is remembered in your browser. Because staged feature releases
          travel over the same connection, features still under staged release stay off for you
          while analytics is off. The switch is available whether or not you are signed in, and must
          be set separately in each browser you use.
        </p>
        <p>
          <strong>Global Privacy Control.</strong> If your browser or an extension sends a Global
          Privacy Control signal, we treat it as an opt-out and analytics starts switched off,
          without your having to do anything. Setting the switch in Settings → Privacy yourself
          overrides the signal in either direction, because a choice you make here is the more
          specific instruction from the same person.
        </p>
        <p>
          <strong>Other information stored in your browser.</strong> The Service stores some
          settings on your device rather than on our servers, including your analytics choice, your
          chosen theme, your reduced-motion and sound preferences, the layout you last used on the
          jam calendar, cues you have dismissed, and any unsent draft of a collaboration post. This
          information stays on your device, is not sent to us, and is cleared when you clear your
          browser's site data.
        </p>
        <p>
          <strong>Images.</strong> Cover images hosted on itch.io are delivered through Cloudflare's
          image service so that they load at a sensible size. Your browser's request for those
          images reaches Cloudflare, which processes it as our service provider.
        </p>
      </>
    ),
  },
  {
    id: "email",
    heading: "Email and notifications",
    body: (
      <>
        <p>
          We send three kinds of email, and they are treated differently. Notification email tells
          you about activity involving you — a response to your collaboration post, a team
          invitation, a reply to your comment, a jam you are watching. Digest email collects that
          activity into a periodic summary. Account and security email confirms actions on your
          account, such as verifying your address or confirming an account deletion.
        </p>
        <p>
          Notification and digest email are governed by your notification settings, where each type
          can be switched on or off per channel, and by a single switch that turns off all email of
          both kinds at once. Every such message also carries a one-click unsubscribe link and the
          corresponding mail headers, so your mail client can unsubscribe you without your opening
          the message. Account and security email cannot be switched off while your account exists,
          because it is how we confirm that a request came from you.
        </p>
        <p>
          Email is delivered by Resend, which processes the recipient address, the message, and
          delivery metadata on our behalf. Where you have the site open at the moment an event
          occurs, we may suppress the corresponding email, on the basis that you have already seen
          it.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    heading: "When we share information",
    body: (
      <>
        <p>
          We do not sell personal information, and we do not share it for cross-context behavioral
          advertising, as those terms are used in United States state privacy laws. We have not done
          so in the preceding twelve months. We disclose personal information only as follows.
        </p>
        <p>
          <strong>a. Publicly, as you direct.</strong> The material described under "What other
          people can see" is published on the Service.
        </p>
        <p>
          <strong>b. To service providers acting on our instructions.</strong> Each is bound to use
          the information only to provide its service to us:
        </p>
        <ul>
          <li>
            <strong>Railway</strong> — hosting for the application, its database, its cache, and its
            file storage.
          </li>
          <li>
            <strong>PostHog</strong> — product analytics, error reporting, and feature releases,
            processed on servers in the European Union.
          </li>
          <li>
            <strong>Resend</strong> — delivery of the email described above.
          </li>
          <li>
            <strong>Cloudflare</strong> — network delivery and image processing.
          </li>
          <li>
            <strong>Discord, GitHub, and itch.io</strong> — the accounts you connect. Information
            flows chiefly from them to us; we send only what is needed to identify your account when
            asking for it.
          </li>
        </ul>
        <p>
          <strong>c. To moderators.</strong> Members holding moderator or administrator roles in the
          Brackeys Discord server can see reports, moderation history, and the profile information
          needed to act on them.
        </p>
        <p>
          <strong>d. For legal reasons.</strong> Where we believe in good faith that disclosure is
          required by law or legal process, or is necessary to protect the rights, property, or
          safety of our members, the public, or us — including to investigate fraud or a security
          incident. Where we may lawfully do so, we will try to notify you first.
        </p>
        <p>
          <strong>e. On a change of control.</strong> If the Service is transferred to another
          operator, information may transfer with it, subject to this notice or a successor notice
          that is no less protective. We will give notice on the Service before that happens.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    heading: "Where information is processed",
    body: (
      <p>
        We operate from the United States, and our infrastructure providers process information in
        the United States and, for analytics, in the European Union. If you are located in the EEA,
        the UK, or Switzerland, your personal information may therefore be transferred to a country
        whose data-protection law differs from your own. Where such a transfer occurs, we rely on
        the European Commission's Standard Contractual Clauses, and the UK Addendum where relevant,
        as incorporated into our agreements with the providers named above. You may request a copy
        of the relevant safeguards by writing to{" "}
        <a href={`mailto:${CONTACT.privacy}`} className={A}>
          {CONTACT.privacy}
        </a>
        .
      </p>
    ),
  },
  {
    id: "retention",
    heading: "How long we keep information",
    body: (
      <>
        <p>
          We keep personal information for as long as your account is open, and thereafter only as
          described here.
        </p>
        <ul>
          <li>
            <strong>Session records</strong> — until the session expires or you sign out.
          </li>
          <li>
            <strong>Operational records</strong> — rate-limit counters, the note that you have the
            site open, and the cache of your Discord roles expire on their own within minutes.
          </li>
          <li>
            <strong>Analytics and error reports</strong> — retained under the retention settings
            configured for our project with our analytics provider, and no longer than is necessary
            for the purposes described above.
          </li>
          <li>
            <strong>Your profile and content</strong> — until you delete it or close your account.
          </li>
          <li>
            <strong>Backups</strong> — copies persist in routine backups for a short period after
            deletion and are overwritten in the ordinary course.
          </li>
        </ul>
        <p>
          <strong>What closing your account does.</strong> Deletion is confirmed by a link emailed
          to you. On confirmation we delete your account record, your sessions, your connected
          accounts and their stored credentials, your profile and everything hanging from it — your
          skills, roles, profile address, project entries, and uploaded images — your notifications
          and preferences, and your collaboration posts and responses. Comments you have written are
          redacted rather than erased, so that replies beneath them remain readable.
        </p>
        <p>
          <strong>What survives, and why.</strong> A credit naming you as a contributor to a project
          remains on that project's page as a matter of record; the link to your account is severed,
          leaving the name under which you were credited. Where a moderation record exists —
          warnings, removals, suspensions, or a ban — we retain it and reduce your profile to an
          identifier skeleton rather than deleting it outright, clearing every personal field but
          keeping the reference those records depend on. Without this, closing and reopening an
          account would erase the history that gives a ban effect. Deletion of your account is
          recorded in our analytics as an event; erasing the corresponding analytics profile is a
          separate step, which we will carry out on request.
        </p>
      </>
    ),
  },
  {
    id: "security",
    heading: "How we protect information",
    body: (
      <p>
        We use technical and organizational measures appropriate to the risk, including encryption
        in transit, encryption at rest for the credentials issued by connected accounts, access
        controls that limit administrative surfaces to members holding staff roles, rate limiting,
        and separation of the publicly cacheable parts of the Service from those that read your
        session. No method of transmission or storage is completely secure, and we cannot guarantee
        absolute security. If you believe your account has been compromised, or you have found a
        vulnerability, write to{" "}
        <a href={`mailto:${CONTACT.privacy}`} className={A}>
          {CONTACT.privacy}
        </a>{" "}
        and we will respond promptly. Please do not test vulnerabilities against other members'
        accounts or data.
      </p>
    ),
  },
  {
    id: "your-rights",
    heading: "Your rights and choices",
    body: (
      <>
        <p>
          Whoever and wherever you are, you may edit or delete most of your information directly in
          the Service, disconnect a connected account, turn analytics off, adjust or silence
          notification email, hide your profile's note wall, block another member, and close your
          account entirely.
        </p>
        <p>
          <strong>If you are in the EEA, the UK, or Switzerland</strong>, you additionally have the
          right to request access to your personal information; to have inaccurate information
          corrected; to have information erased; to restrict or object to processing, including
          processing based on legitimate interests; to receive information you provided in a
          portable form; and, where processing rests on consent, to withdraw that consent at any
          time without affecting processing already carried out. You also have the right to lodge a
          complaint with your local supervisory authority, though we would appreciate the chance to
          address your concern first.
        </p>
        <p>
          <strong>
            If you are a resident of California, Colorado, Connecticut, Virginia, or another United
            States state with a comprehensive privacy law
          </strong>
          , you have the right to know what personal information we collect and disclose, to obtain
          a copy of it, to correct it, to delete it, and not to be discriminated against for
          exercising any of these rights. As stated above, we do not sell personal information, do
          not share it for cross-context behavioral advertising, and do not use it for profiling
          that produces legal or similarly significant effects, so there is nothing to opt out of on
          those grounds. Where your state provides an appeal from our decision on a request, you may
          appeal by replying to our response.
        </p>
        <p>
          <strong>If you appear in our jam catalogue but have no account here</strong>, you may ask
          us to remove the entry or the author details associated with it, and we will do so.
        </p>
        <p>
          <strong>Making a request.</strong> Write to{" "}
          <a href={`mailto:${CONTACT.privacy}`} className={A}>
            {CONTACT.privacy}
          </a>{" "}
          from the address associated with your account, or tell us enough to locate your account.
          We will verify a request by a means proportionate to its sensitivity, and we will respond
          within 30 days, or within 45 days where a United States state law permits and the request
          is complex, in which case we will tell you before the first period expires. There is no
          charge unless a request is manifestly unfounded or excessive. An authorized agent may act
          for you where your state's law allows, on proof of authority.
        </p>
      </>
    ),
  },
  {
    id: "children",
    heading: "Children's privacy",
    body: (
      <p>
        The Service is not intended for children under 13, and in the EEA, the UK, and Switzerland
        not for anyone under 16. We do not knowingly collect personal information from anyone below
        the applicable age. If you believe a child below that age has provided information to us,
        write to{" "}
        <a href={`mailto:${CONTACT.privacy}`} className={A}>
          {CONTACT.privacy}
        </a>{" "}
        and we will close the account and delete the information. Note that signing in requires a
        Discord account, which carries its own minimum age.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to this notice",
    body: (
      <p>
        We may update this notice as the Service changes. The date at the top of this page shows
        when the current version took effect. Where a change materially affects how we handle
        personal information, we will give notice on the Service, by email, or in the Brackeys
        Discord server before it takes effect, and where the law requires consent for the change we
        will ask for it.
      </p>
    ),
  },
  {
    id: "contact",
    heading: "How to contact us",
    body: (
      <>
        <p>
          Privacy questions and requests go to{" "}
          <a href={`mailto:${CONTACT.privacy}`} className={A}>
            {CONTACT.privacy}
          </a>
          . Reports of abuse go to{" "}
          <a href={`mailto:${CONTACT.abuse}`} className={A}>
            {CONTACT.abuse}
          </a>
          , and other legal notices to{" "}
          <a href={`mailto:${CONTACT.legal}`} className={A}>
            {CONTACT.legal}
          </a>
          .
        </p>
        <p>
          For anything informal, ask in the{" "}
          <a href={SITE.discord} target="_blank" rel="noopener noreferrer" className={A}>
            Brackeys Discord server
          </a>
          . Formal requests should be made in writing to the addresses above so that we have a
          record of them.
        </p>
      </>
    ),
  },
];

export function PrivacyDocument() {
  return (
    <LegalDocument
      marker="§ Legal / Privacy"
      title="Privacy Policy"
      summary={`What ${SITE.domain} collects about you, where it comes from, who can see it, how long it is kept, and how to have it corrected or removed.`}
      atAGlance={
        <>
          Signing in brings across your Discord identity; connecting GitHub or itch.io brings across
          what you approve. Your profile, posts, and projects are public — your email address,
          sessions, and connected credentials are not. Analytics runs without cookies, is hosted in
          the EU, and has a single off switch in Settings → Privacy. We never sell your information.
          Closing your account removes it, except for credits on shared projects and the moderation
          record, which is kept so that a ban cannot be erased by starting over.
        </>
      }
      sections={SECTIONS}
    />
  );
}
