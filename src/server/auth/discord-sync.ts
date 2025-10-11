import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// Discord role IDs
const DISCORD_ROLES = {
  admin: '451380371284557824',
  staff: '756285704061059213',
  moderator: '756178968901582859',
  brackeys: '491536338525356042',
};

export const syncDiscordRoles = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    try {
      // This would need Clerk SDK server-side
      // For now, returning a placeholder
      // TODO: Implement with Clerk server SDK
      return {
        success: true,
        message: 'Discord role sync not yet implemented in TanStack Start',
      };
    } catch (error) {
      console.error('Error syncing Discord roles:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
