import { Button } from "@/components/ui/button";
import { Link as TextLink, Text } from "@/components/ui/typography";
import { signInWithDiscord } from "@/lib/auth-client";

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  discord_dm: "Discord DM",
  discord_server: "Discord Server",
  email: "Email",
  other: "Other",
};

export type PostContact = { contactType: string | null; contactMethod: string | null };

/**
 * Turn a contact spec into something clickable where that's meaningful: an
 * email opens the composer, a Discord server invite (or any `other` value the
 * author wrote as a URL) opens the link. A `discord_dm` handle is a username,
 * not an address, so it stays plain text.
 */
function contactHref(contact: PostContact): string | null {
  const value = contact.contactMethod?.trim();
  if (!value) return null;

  if (contact.contactType === "email") {
    return value.includes("@") ? `mailto:${value}` : null;
  }
  if (contact.contactType === "discord_server" || contact.contactType === "other") {
    return /^https?:\/\//i.test(value) ? value : null;
  }
  return null;
}

/**
 * The CONTACT row's value, gated. Contact details are community-scoped, not
 * public: they never leave `getPost` (anonymous and edge-cached), so this
 * renders whatever the viewer has earned — the details for a signed-in guild
 * member, a way in for everyone else.
 */
export function ContactValue({
  contact,
  isSignedIn,
}: {
  contact: PostContact | null;
  isSignedIn: boolean;
}) {
  if (!contact) {
    return isSignedIn ? (
      <Text as="span" size="sm" variant="muted">
        Join the Brackeys Discord to view
      </Text>
    ) : (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0"
        onClick={() => {
          void signInWithDiscord();
        }}
      >
        Sign in to view
      </Button>
    );
  }

  const label = contact.contactType
    ? (CONTACT_TYPE_LABELS[contact.contactType] ?? contact.contactType)
    : null;
  const href = contactHref(contact);
  const method = contact.contactMethod?.trim() || null;

  if (!label && !method) return <>—</>;

  return (
    <>
      {label}
      {label && method ? " · " : null}
      {method && href ? (
        <TextLink href={href} target="_blank" rel="noopener noreferrer">
          {method}
        </TextLink>
      ) : (
        method
      )}
    </>
  );
}
