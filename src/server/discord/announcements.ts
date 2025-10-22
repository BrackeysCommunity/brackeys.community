import { clerkClient } from '@clerk/clerk-sdk-node';
import * as Sentry from '@sentry/tanstackstart-react';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DISCORD_ANNOUNCEMENTS_CHANNEL_ID =
  process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID;

type DiscordMessage = {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar: string | null;
  };
  timestamp: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
    image?: {
      url: string;
      width?: number;
      height?: number;
    };
  }>;
};

type Announcement = {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar: string | null;
  };
  timestamp: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
    image?: {
      url: string;
      width?: number;
      height?: number;
    };
  }>;
};

export const getLatestAnnouncement = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    return Sentry.startSpan(
      { name: 'Fetching latest Discord announcement' },
      async () => {
        if (!CLERK_SECRET_KEY) {
          console.error(
            'CLERK_SECRET_KEY is not set. Cannot fetch user Discord token.',
          );
          return null;
        }

        if (!DISCORD_ANNOUNCEMENTS_CHANNEL_ID) {
          console.warn(
            'Discord announcements channel ID not configured. Skipping announcement fetch.',
          );
          return null;
        }

        try {
          const { userId } = data;

          // Get the user's Discord OAuth access token from Clerk
          const tokenResponse = await clerkClient.users.getUserOauthAccessToken(
            userId,
            'oauth_discord',
          );
          const accessToken = tokenResponse.data[0]?.token;

          console.log(tokenResponse.data.toString());

          if (!accessToken) {
            console.log(
              `No Discord access token found for user: ${userId}. User needs to connect Discord.`,
            );
            return null;
          }
          console.log(accessToken);

          // Use the user's Discord token to fetch announcements
          const response = await fetch(
            `https://discord.com/api/v10/channels/${DISCORD_ANNOUNCEMENTS_CHANNEL_ID}/messages?limit=1`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          );

          if (!response.ok) {
            // If user doesn't have access to the channel, return null gracefully
            if (response.status === 403 || response.status === 404) {
              console.log(
                `User ${userId} doesn't have access to announcements channel or channel not found.`,
              );
              return null;
            }

            throw new Error(
              `Discord API error: ${response.status} ${response.statusText}`,
            );
          }

          const messages = (await response.json()) as DiscordMessage[];

          if (!messages || messages.length === 0) {
            return null;
          }

          const latestMessage = messages[0];

          const announcement: Announcement = {
            id: latestMessage.id,
            content: latestMessage.content,
            author: {
              id: latestMessage.author.id,
              username: latestMessage.author.username,
              avatar: latestMessage.author.avatar,
            },
            timestamp: latestMessage.timestamp,
            embeds: latestMessage.embeds,
          };

          return announcement;
        } catch (error) {
          console.error('Error fetching Discord announcement:', error);
          Sentry.captureException(error, {
            tags: { operation: 'fetch-discord-announcements' },
          });
          // Don't throw - just return null so the UI can handle gracefully
          return null;
        }
      },
    );
  });
