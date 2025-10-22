import { useSuspenseQuery } from '@tanstack/react-query';
import { LogIn, Megaphone } from 'lucide-react';
import { getLatestAnnouncement } from '../../server/discord/announcements';
import { useActiveUser } from '../../store';
import { LoginButton } from '../auth/LoginButton';

type AnnouncementData = Awaited<ReturnType<typeof getLatestAnnouncement>>;

const ANNOUNCEMENT_CONTENT = {
  title: 'Latest Announcement',
  noAnnouncements: 'No announcements yet. Check back soon!',
  loginRequired:
    'Sign in to view the latest announcements from our Discord community.',
};

const PLACEHOLDER_ANNOUNCEMENT: NonNullable<AnnouncementData> = {
  id: 'placeholder',
  content:
    'Hey everyone, new video out about some of the best games from the two Brackeys Game Jams of 2025 🔥\n\n✨ Watch it here: https://youtu.be/1un4Tu2f-L4\n\nTruly some amazing games! 🤯',
  author: {
    id: 'brackeys',
    username: 'Brackeys',
    avatar: null,
  },
  timestamp: '2025-10-05T13:01:00.000Z',
  embeds: [
    {
      color: 0xd6492c,
      fields: [],
      image: {
        url: '/png/jam-14.png',
        width: 1920,
        height: 1080,
      },
    },
  ],
};

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function parseContentWithLinks(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  let linkCount = 0;
  let textCount = 0;

  return parts.map((part) => {
    if (part.match(urlRegex)) {
      linkCount++;
      return (
        <a
          key={`link-${part.substring(0, 50)}-${linkCount}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brackeys-green-400 hover:text-brackeys-green-300 underline pointer-events-auto"
        >
          {part}
        </a>
      );
    }
    textCount++;
    return (
      <span key={`text-${part.substring(0, 50)}-${textCount}`}>{part}</span>
    );
  });
}

type AnnouncementContentProps = {
  announcement: AnnouncementData;
};

const AnnouncementContent = ({ announcement }: AnnouncementContentProps) => {
  // Use placeholder if no real announcement is available
  const displayAnnouncement = announcement || PLACEHOLDER_ANNOUNCEMENT;
  const { content, author, timestamp, embeds } = displayAnnouncement;

  // Extract all images from embeds
  const images = embeds
    ?.map((embed) => embed.image)
    .filter((image): image is NonNullable<typeof image> => !!image);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          {author.avatar ? (
            <img
              src={`https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png`}
              alt={author.username}
              className="w-10 h-10 rounded-full"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-brackeys-purple-900 flex items-center justify-center p-1.5 relative overflow-hidden">
              <div
                className="absolute inset-0 bg-gradient-to-br from-yellow-400 via-pink-500 to-purple-600"
                style={{
                  maskImage: 'url(/svg/brackeys-logo.svg)',
                  maskSize: '100%',
                  maskPosition: 'center',
                  maskRepeat: 'no-repeat',
                  WebkitMaskImage: 'url(/svg/brackeys-logo.svg)',
                  WebkitMaskSize: '100%',
                  WebkitMaskPosition: 'center',
                  WebkitMaskRepeat: 'no-repeat',
                }}
              />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-semibold text-white">{author.username}</p>
            <span className="text-sm text-gray-400">
              {formatTimestamp(timestamp)}
            </span>
          </div>
          {content && (
            <p className="text-gray-300 whitespace-pre-wrap break-words">
              {parseContentWithLinks(content)}
            </p>
          )}
        </div>
      </div>

      {embeds && embeds.length > 0 && (
        <div className="space-y-3">
          {embeds.map((embed) => {
            const hasContent =
              embed.title ||
              embed.description ||
              (embed.fields && embed.fields.length > 0);

            if (!hasContent) return null;

            return (
              <div
                key={`${embed.title}-${embed.description?.substring(0, 20)}`}
                className="border-l-4 pl-4 py-2 bg-gray-800/50 rounded-r"
                style={{
                  borderColor: embed.color
                    ? `#${embed.color.toString(16).padStart(6, '0')}`
                    : '#7c3aed',
                }}
              >
                {embed.title && (
                  <h4 className="font-bold text-white mb-2">{embed.title}</h4>
                )}
                {embed.description && (
                  <p className="text-gray-300 text-sm whitespace-pre-wrap">
                    {embed.description}
                  </p>
                )}
                {embed.fields && embed.fields.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {embed.fields.map((field) => (
                      <div
                        key={`${field.name}-${field.value.substring(0, 20)}`}
                      >
                        <p className="font-semibold text-white text-sm">
                          {field.name}
                        </p>
                        <p className="text-gray-300 text-sm">{field.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {images && images.length > 0 && (
        <div className="space-y-3">
          {images.map((image, index) => (
            <img
              key={`${image.url}-${index}`}
              src={image.url}
              alt="Announcement"
              className="w-full h-auto rounded-lg"
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const AnnouncementCard = () => {
  const { user } = useActiveUser();
  const isAuthenticated = !!user;

  const { data: announcement } = useSuspenseQuery({
    queryKey: ['discord-announcement', user?.id],
    queryFn: () =>
      user?.id ? getLatestAnnouncement({ data: { userId: user.id } }) : null,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return (
    <div>
      {!isAuthenticated ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <LogIn className="h-12 w-12 text-gray-600 mb-4" />
          <p className="text-gray-400 mb-4">
            {ANNOUNCEMENT_CONTENT.loginRequired}
          </p>
          <LoginButton className="pointer-events-auto" />
        </div>
      ) : (
        <AnnouncementContent announcement={announcement} />
      )}
    </div>
  );
};
