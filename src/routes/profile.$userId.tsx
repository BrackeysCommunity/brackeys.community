import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { ProfilePage } from "@/components/profile/ProfilePage";
import { adaptProfile, type RpcProfile } from "@/components/profile/ProfilePage/profile-adapter";
import { ProfilePageSkeleton } from "@/components/profile/ProfilePage/ProfilePageSkeleton";
import { useProfileOwnerOverlay } from "@/components/profile/use-profile-owner-overlay";
import { siteUrl } from "@/env";
import { authClient } from "@/lib/auth-client";
import { memberName } from "@/lib/member-name";
import { censorText } from "@/lib/profanity";
import { profileSlug } from "@/lib/profile-links";
import { breadcrumbNode, buildMeta, jsonLd, NOT_FOUND_OG_CARD, ogCardPath } from "@/lib/site-meta";
import { STORED_IMAGE_ROUTE_PREFIX } from "@/lib/stored-image-urls";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

/**
 * The loader is what puts content and meta in the document and turns an
 * unmatched handle into a real 404 rather than a 200 shell.
 */
export const Route = createFileRoute("/profile/$userId")({
  loader: async ({ context: { queryClient }, params }) => {
    const data = await queryClient.ensureQueryData(
      orpc.getProfile.queryOptions({ input: { userId: params.userId } }),
    );
    if (!data) throw notFound();
    // The claimed handle is the canonical URL; a raw-id (or oddly cased)
    // link hops there so shares and crawlers converge on one address.
    const canonical = profileSlug({ id: data.profile.id, urlStub: data.urlStub });
    if (params.userId !== canonical) {
      throw redirect({
        to: "/profile/$userId",
        params: { userId: canonical },
        statusCode: 301,
      });
    }
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return buildMeta({
        title: "Profile not found",
        path: "/members",
        card: NOT_FOUND_OG_CARD,
        noindexNofollow: true,
        canonical: false,
      });
    }
    const { profile, roles, skills } = loaderData;
    const name = memberName(profile, "A Brackeys member");
    const craft = roles
      .map((role) => role.name)
      .slice(0, 3)
      .join(", ");
    // No viewer preference on the server, so meta follows the email rule
    // and censors unconditionally.
    const tagline = censorText(profile.tagline?.trim() || null);
    const description =
      tagline ||
      censorText(profile.bio?.trim().slice(0, 180) || null) ||
      [craft && `${craft}.`, skills.length > 0 && `Works in ${skills[0]!.name}.`]
        .filter(Boolean)
        .join(" ") ||
      `${name} on the Brackeys community directory — jams entered, projects shipped, and what they're up for next.`;

    const path = `/profile/${profileSlug({ id: profile.id, urlStub: loaderData.urlStub })}`;
    const sameAs = [profile.githubUrl, profile.twitterUrl, profile.websiteUrl].filter(
      (url): url is string => Boolean(url),
    );
    // Uploaded avatars live under `/images/`, which robots.txt disallows —
    // no image beats an image Google is told not to fetch.
    const avatar =
      profile.avatarUrl && !profile.avatarUrl.startsWith(STORED_IMAGE_ROUTE_PREFIX)
        ? siteUrl(profile.avatarUrl)
        : null;

    return {
      ...buildMeta({
        title: name,
        description,
        path,
        card: ogCardPath("profile", profileSlug({ id: profile.id, urlStub: loaderData.urlStub })),
        imageAlt: `${name} on Brackeys Community`,
        type: "profile",
      }),
      scripts: jsonLd([
        {
          "@context": "https://schema.org",
          "@type": "Person",
          name,
          url: siteUrl(path),
          ...(avatar ? { image: avatar } : {}),
          ...(tagline ? { description: tagline } : {}),
          ...(craft ? { jobTitle: craft } : {}),
          ...(profile.location ? { homeLocation: profile.location } : {}),
          ...(skills.length > 0 ? { knowsAbout: skills.map((skill) => skill.name) } : {}),
          ...(sameAs.length > 0 ? { sameAs } : {}),
        },
        {
          "@context": "https://schema.org",
          ...breadcrumbNode([
            { name: "Members", path: "/members" },
            { name: name, path },
          ]),
        },
      ]),
    };
  },
  component: ProfileById,
  pendingComponent: ProfilePageSkeleton,
  notFoundComponent: ProfileNotFoundState,
});

/**
 * Renders the redesigned profile page for a specific user. The
 * route param accepts both the raw `developer_profiles.id` and the
 * URL-stub form (resolution happens server-side in `getProfile`).
 *
 * The oRPC response shape is mapped to the page's typed view model
 * via `adaptProfile` so the UI is decoupled from the database
 * schema's evolution.
 */
function ProfileById() {
  const { userId } = Route.useParams();
  const { data: session } = authClient.useSession();
  const queryOptions = orpc.getProfile.queryOptions({ input: { userId } });
  // Served from the loader's cache entry; still a `useQuery` so an edit's
  // `invalidateQueries` has a subscriber.
  const { data, isLoading } = useQuery({
    ...queryOptions,
    staleTime: STALE.listing,
  });

  // Ownership follows the *resolved* profile id, not the route param — the
  // param is a vanity stub as often as an id, and comparing the session
  // against a stub never matches.
  const { isOwner, overlay } = useProfileOwnerOverlay({
    profileId: data?.profile.id,
    currentUserId: session?.user?.id,
    profileQueryKey: queryOptions.queryKey,
  });

  if (isLoading) return <ProfilePageSkeleton />;
  if (!data) return <ProfileNotFoundState />;

  // The anonymous core, plus what only the owner may see. Until the overlay
  // lands the page renders the public view of your own profile, which is
  // the correct intermediate state rather than a flash of missing sections.
  const profile = adaptProfile({
    ...data,
    isOwner,
    pendingSkillRequests: overlay?.pendingSkillRequests ?? [],
    projects: overlay?.projects ?? data.projects,
    linkedAccounts: overlay?.linkedAccounts ?? data.linkedAccounts,
  } as unknown as RpcProfile);

  return <ProfilePage profile={profile} isOwner={isOwner} queryKey={queryOptions.queryKey} />;
}

function ProfileNotFoundState() {
  return (
    <NotFoundPage
      subject="Profile"
      message="The handle you're looking for doesn't match any profile."
    />
  );
}
